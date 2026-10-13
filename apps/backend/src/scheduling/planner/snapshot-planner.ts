import { categoryWeight, contentGroupKey, isAutomaticScheduleBye, normalizeMainTree, ScheduleGraphError, scheduleParticipantIds } from './main-tree';
import { assertScheduleConfig, eventDays, localDay, localInstant, ScheduleConfig } from './schedule-config';
import { planSchedule } from './schedule-engine';
import { PlannerInput, PlannerMatch, PlannerReservation, PlannerViolation } from './schedule-types';
import { contentConflicts, participantContentSpans, participantResolver } from './participant-content';

export function describeScheduleViolations(snapshot: ScheduleSnapshot, violations: PlannerViolation[], timezone: string) {
  const names = new Map<string, string>();
  for (const entry of snapshot.entries) if (entry.athlete?.fullName) names.set(`athlete:${entry.athleteId}`, entry.athlete.fullName);
  for (const team of snapshot.teams) {
    names.set(`team:${team.id}`, team.name);
    for (const member of team.members) if (member.athlete?.fullName) names.set(`athlete:${member.athleteId}`, member.athlete.fullName);
  }
  for (const match of snapshot.matches) for (const side of [1, 2]) if (match[`athlete${side}`]?.fullName) names.set(`athlete:${match[`athlete${side}Id`]}`, match[`athlete${side}`].fullName);
  const time = (value: any) => new Intl.DateTimeFormat('vi-VN', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  return violations.map((violation) => {
    if (violation.code === 'PIN_CONFLICT' && violation.requestedStart != null && violation.targetMatchId) {
      const target = snapshot.matches.find((match) => match.id === violation.targetMatchId);
      const minimum = violation.suggestedStart ?? violation.earliestStart;
      return { ...violation, message: `${target?.matchNumber ? `Trận #${target.matchNumber}` : 'Trận này'} đang cố định lúc ${time(violation.requestedStart)}.${minimum != null ? ` Có thể xếp sớm nhất lúc ${time(minimum)}.` : ' Không tìm được giờ trống trong các ngày/thảm đang chọn.'}`,
        description: [violation.description, 'Chọn giờ được đề xuất, đổi giờ cố định hoặc dùng “Dời từ đây” để hệ thống tự xếp từ mốc bạn chọn.'].filter(Boolean).join('. ') };
    }
    const participants = [...new Set((violation.participantIds || []).map((id) => names.get(id) || 'VĐV/đội trong nhánh đấu'))];
    const matches = violation.matchIds.map((id) => snapshot.matches.find((match) => match.id === id)).filter(Boolean);
    const categories = [...new Set(matches.map((match) => match.categoryId))].map((id) => {
      const category = snapshot.event.categories.find((category) => category.id === id);
      const discipline = category?.discipline === 'NEWAZA' ? category.uniform === 'NO_GI' ? 'No-GI' : 'GI' : category?.discipline;
      const rows = matches.filter((match) => match.categoryId === id);
      const scheduled = rows.filter((match) => match.startTime && match.endTime);
      return `${discipline || 'Nội dung'} · ${category?.name || 'hạng đấu'}: trận ${rows.map((match) => `#${match.matchNumber || match.id}`).join(', ')}${scheduled.length ? ` (lịch dự kiến ${time(Math.min(...scheduled.map((match) => +new Date(match.startTime))))} – ${time(Math.max(...scheduled.map((match) => +new Date(match.endTime))))})` : ''}`;
    });
    if (!participants.length) return categories.length ? { ...violation, description: [categories.join('; '), violation.description].filter(Boolean).join('. ') } : violation;
    return { ...violation, description: `${participants.join(', ')}. ${categories.join('; ')}. ${['PARTICIPANT_CONTENT_IN_PROGRESS', 'CONTENT_COMPLETION_UNKNOWN'].includes(violation.code)
      ? 'VĐV chỉ được chuyển nội dung sau khi bị loại hoàn toàn (kể cả nhánh vớt/nhánh thua) hoặc hoàn tất trận cuối, rồi nghỉ đủ theo quy định. Nếu chưa xếp được, hãy đổi giờ/ngày hoặc mở rộng cửa sổ thi đấu.'
      : 'Ứng viên chưa được xác định bởi kết quả trận nguồn. Hãy tăng khoảng nghỉ hoặc dời giờ hai trận để bảo đảm đủ thời gian nghỉ.'}` };
  });
}

// This adapter accepts Prisma snapshots; the public API never accepts these rows
// from clients. Keep all loading in the service so the pure engine remains testable.
export type ScheduleSnapshot = {
  event: any; matches: any[]; draws: any[]; teams: any[]; entries: any[];
  rules: any[]; slots: any[]; owners: any[]; plans: any[]; heats: any[]; groups: any[];
};

/** Recheck resolved participants against the live schedule without moving it. */
export function liveScheduleViolations(snapshot: ScheduleSnapshot, planId: string, now: number): PlannerViolation[] {
  const teams = new Map<string, string[]>(snapshot.teams.map((team) => [team.id, team.members.map((member) => member.athleteId)]));
  const violations: PlannerViolation[] = [];
  const rows = snapshot.matches.filter((match) => match.startTime && match.endTime && match.status !== 'CANCELLED' && !isAutomaticScheduleBye(match));
  const keys = new Map<string, string[]>();
  for (const match of rows) {
    try { keys.set(match.id, scheduleParticipantIds(match, teams)); }
    catch { keys.set(match.id, []); }
  }
  const interval = (match: any) => ({ start: match.resultData?.scoreboard?.startedAt ? Date.parse(match.resultData.scoreboard.startedAt) : +new Date(match.startTime),
    end: match.status === 'FINISHED' && match.resultData?.scoreboard?.finishedAt ? Date.parse(match.resultData.scoreboard.finishedAt)
      : match.status === 'RUNNING' ? Math.max(now, +new Date(match.endTime)) : +new Date(match.endTime) });
  const rest = (match: any) => (snapshot.rules.find((rule) => rule.sportId === snapshot.event.categories.find((category) => category.id === match.categoryId)?.sportId)?.minRestMinutes ?? 60) * 60000;
  const checked = new Set<string>();
  const resolve = participantResolver(snapshot.matches, teams, snapshot.draws);
  const contentRows = rows.map((match) => ({ ...interval(match), matchId: match.id, planId: match.schedulePlanId,
    contentKey: contentGroupKey(snapshot.event.categories.find((category) => category.id === match.categoryId)),
    participantIds: keys.get(match.id)!, candidateParticipantIds: resolve(match.id), minRestSeconds: rest(match) / 1000 }));
  const ownSpans = participantContentSpans(contentRows.filter((row) => row.planId === planId));
  const otherSpans = participantContentSpans(contentRows.filter((row) => row.planId !== planId));
  for (const { left, right } of contentConflicts(ownSpans, otherSpans)) {
    violations.push({ code: 'PARTICIPANT_CONTENT_IN_PROGRESS', severity: 'ERROR',
      message: 'Lịch hiện tại xen kẽ hai nội dung của cùng VĐV. Cần tính lại lịch trước khi thi đấu.',
      participantIds: [left.participantId], matchIds: [...left.matchIds, ...right.matchIds], relatedPlanIds: right.planIds });
  }
  for (const match of rows.filter((item) => item.schedulePlanId === planId && item.status !== 'FINISHED')) {
    if (match.status === 'RUNNING' && now > +new Date(match.endTime)) violations.push({ code: 'RUNNING_OVERDUE', severity: 'WARNING',
      message: 'Trận đang thi đấu đã vượt giờ dự kiến. Kiểm tra lại phần lịch phía sau.', matchIds: [match.id] });
    for (const other of rows) {
      const pair = [match.id, other.id].sort().join(':');
      if (other.id === match.id || checked.has(pair)) continue;
      checked.add(pair);
      const a = interval(match); const b = interval(other);
      const gap = Math.max(rest(match), rest(other));
      if (keys.get(match.id)!.some((id) => keys.get(other.id)!.includes(id)) && a.start < b.end + gap && a.end + gap > b.start) {
        violations.push({ code: 'RESOLVED_PARTICIPANT_CONFLICT', severity: 'ERROR',
          message: 'VĐV/đội đã xác định bị trùng giờ hoặc thiếu thời gian nghỉ. Mở bản nháp để tính lại lịch trước khi thi đấu.',
          matchIds: [match.id, other.id], relatedPlanIds: other.schedulePlanId && other.schedulePlanId !== planId ? [other.schedulePlanId] : [] });
      }
    }
  }
  return describeScheduleViolations(snapshot, violations, snapshot.event.fops[0]?.venue?.timezone || 'Asia/Ho_Chi_Minh');
}

export function semanticStages(snapshot: ScheduleSnapshot, categoryId: string) {
  const matches = snapshot.matches.filter((match) => match.categoryId === categoryId);
  const ids = new Set(matches.map((match) => match.id));
  const invalidSources = matches.filter((match) => [match.winnerToMatchId, match.loserToMatchId].some((id) => id && !ids.has(id)));
  if (invalidSources.length) throw new ScheduleGraphError('PREDECESSOR_NOT_AVAILABLE', 'Đường tiến trình trỏ ra ngoài hạng đấu hoặc tới trận không tồn tại.', invalidSources.map((match) => match.id));
  const draws = snapshot.draws.filter((draw) => draw.categoryId === categoryId);
  const stages = new Map<string, { stageKey: string; stageOrder: number; drawId: string }>();
  for (const draw of draws.filter((item) => ['MAIN_TREE', 'POOL_WINNER_TREE'].includes(item.type))) {
    for (const [id, stage] of normalizeMainTree(draw, matches.filter((match) => match.drawId === draw.id))) {
      stages.set(id, { ...stage, stageOrder: stage.stageOrder * 10, drawId: draw.id });
    }
  }
  for (const draw of draws.filter((item) => ['REPECHAGE', 'REPECHAGE_ROUND_OF_16', 'DOUBLE_ELIMINATION'].includes(item.type))) {
    const secondary = matches.filter((match) => match.drawId === draw.id);
    const sourceDraws = draws.filter((item) => item.type === 'MAIN_TREE' && matches.some((match) =>
      match.drawId === item.id && secondary.some((target) => target.id === match.loserToMatchId)));
    if (sourceDraws.length !== 1) throw new ScheduleGraphError('UNSUPPORTED_DRAW_TYPE', 'Không xác định được nhánh chính của nhánh phụ.');
    const size = sourceDraws[0].bracketSize;
    const repechage = draw.type === 'REPECHAGE' || draw.type === 'REPECHAGE_ROUND_OF_16';
    const repechageSize = draw.type === 'REPECHAGE_ROUND_OF_16' ? 16 : 32;
    const effectiveSize = repechage ? Math.min(repechageSize, size) : size;
    const rounds = Math.log2(effectiveSize) * 2 - (repechage ? 4 : 2);
    if (!Number.isInteger(rounds) || rounds < 1) throw new ScheduleGraphError('UNSUPPORTED_DRAW_TYPE', 'Khung nhánh phụ chưa được hỗ trợ.');
    for (let round = 1; round <= rounds + (repechage ? 0 : 1); round += 1) {
      const group = secondary.filter((match) => match.round === round);
      const grandFinal = !repechage && round === rounds + 1;
      const expected = grandFinal ? 1 : effectiveSize / 2 / 2 ** Math.ceil(round / 2);
      if (group.length !== expected || new Set(group.map((match) => match.bracketPosition)).size !== expected
        || group.some((match) => !Number.isInteger(match.bracketPosition) || match.bracketPosition < 0 || match.bracketPosition >= expected)) {
        throw new ScheduleGraphError('UNSUPPORTED_DRAW_TYPE', 'Topology nhánh phụ không khớp bảng giai đoạn đã duyệt.', group.map((match) => match.id));
      }
      const remaining = effectiveSize / 2 ** Math.floor(round / 2);
      const bronze = repechage && round === rounds;
      const stageKey = grandFinal ? 'GRAND_FINAL' : bronze ? 'BRONZE'
        : `${repechage ? 'REP' : 'LOWER'}_${remaining}_${round % 2 ? 'CONSOLIDATE' : 'JOIN'}`;
      const stageOrder = grandFinal ? 0 : -Math.log2(remaining) * 10 + (round % 2 ? 2 : 1);
      group.forEach((match) => stages.set(match.id, { stageKey, stageOrder, drawId: draw.id }));
    }
    if (secondary.some((match) => !stages.has(match.id))) throw new ScheduleGraphError('UNSUPPORTED_DRAW_TYPE', 'Nhánh phụ có vòng ngoài mapping được hỗ trợ.');
    const main = matches.filter((match) => match.drawId === sourceDraws[0].id);
    const mainRounds = [...new Set<number>(main.map((match) => match.round))].sort((a, b) => a - b)
      .map((round) => main.filter((match) => match.round === round).sort((a, b) => a.bracketPosition - b.bracketPosition));
    const eligible = repechage ? mainRounds.slice(-Math.log2(repechageSize)) : mainRounds;
    const lower = Array.from({ length: rounds }, (_, index) => secondary.filter((match) => match.round === index + 1)
      .sort((a, b) => a.bracketPosition - b.bracketPosition));
    const expected = new Map<string, string[]>();
    const edge = (source: any, target: any, path: 'winner' | 'loser', side: string) => {
      if (!target || source[`${path}ToMatchId`] !== target.id || source[`${path}ToSide`] !== side) {
        throw new ScheduleGraphError('UNSUPPORTED_DRAW_TYPE', 'Đường đi thắng/thua không khớp topology nhánh phụ đã duyệt.', [source.id]);
      }
      expected.set(target.id, [...(expected.get(target.id) || []), `${source.id}:${path}:${side}`]);
    };
    eligible[0].forEach((match, position) => edge(match, lower[0][Math.floor(position / 2)], 'loser', position % 2 ? 'ATHLETE2' : 'ATHLETE1'));
    lower.forEach((group, index) => {
      const stage = index + 1;
      const next = lower[index + 1];
      group.forEach((match, position) => {
        if (match.loserToMatchId) throw new ScheduleGraphError('UNSUPPORTED_DRAW_TYPE', 'Nhánh phụ có đường thua ngoài topology được hỗ trợ.', [match.id]);
        if (next) edge(match, next[stage % 2 ? position : Math.floor(position / 2)], 'winner', stage % 2 || position % 2 === 0 ? 'ATHLETE1' : 'ATHLETE2');
        else if (repechage && match.winnerToMatchId) throw new ScheduleGraphError('UNSUPPORTED_DRAW_TYPE', 'Trận HCĐ có đường tiến trình ngoài topology được hỗ trợ.', [match.id]);
      });
      if (stage % 2 === 0) eligible[stage / 2].forEach((match, position) => edge(match,
        group[repechage && stage === rounds ? position ^ 1 : position], 'loser', 'ATHLETE2'));
    });
    if (!repechage) {
      const final = secondary.find((match) => match.round === rounds + 1);
      edge(mainRounds.at(-1)![0], final, 'winner', 'ATHLETE1');
      edge(lower.at(-1)![0], final, 'winner', 'ATHLETE2');
      if (final.winnerToMatchId || final.loserToMatchId) throw new ScheduleGraphError('UNSUPPORTED_DRAW_TYPE', 'Không hỗ trợ reset final ngoài topology hiện có.', [final.id]);
    }
    for (const target of secondary) {
      const incoming = snapshot.matches.flatMap((source) => (['winner', 'loser'] as const).filter((path) => source[`${path}ToMatchId`] === target.id)
        .map((path) => `${source.id}:${path}:${source[`${path}ToSide`]}`)).sort();
      if (JSON.stringify(incoming) !== JSON.stringify((expected.get(target.id) || []).sort())) {
        throw new ScheduleGraphError('UNSUPPORTED_DRAW_TYPE', 'Trận nhánh phụ có nguồn thiếu hoặc không hợp lệ.', [target.id]);
      }
    }
  }
  for (const match of matches) {
    if (stages.has(match.id)) continue;
    const draw = draws.find((item) => item.id === match.drawId);
    const heat = snapshot.heats.find((item) => item.matchId === match.id);
    if (heat && Number.isInteger(heat.round) && heat.round > 0) {
      stages.set(match.id, { stageKey: `HEAT_${heat.round}`, stageOrder: -1000 + heat.round, drawId: `heat:${categoryId}` });
    } else if ((draw?.type === 'ROUND_ROBIN_POOL' || match.roundRobinGroupId)
      && Number.isInteger(match.round) && match.round > 0) {
      stages.set(match.id, { stageKey: `POOL_${match.round}`, stageOrder: -1000 + match.round,
        drawId: draw?.id || `pool:${match.roundRobinGroupId}` });
    } else throw new ScheduleGraphError('UNSUPPORTED_DRAW_TYPE', 'Chưa hỗ trợ tự xếp loại nhánh/lượt này hoặc chưa có nhánh hợp lệ.', [match.id]);
  }
  if (!matches.length) throw new ScheduleGraphError('DRAW_NOT_READY', 'Hạng đấu chưa có nhánh/lượt thi đấu.');
  return stages;
}

export function previewSnapshot(snapshot: ScheduleSnapshot, config: ScheduleConfig, planId: string) {
  assertScheduleConfig(config);
  const categories = snapshot.event.categories;
  const selected = config.blocks.flatMap((block) => block.categoryIds);
  const errors: PlannerViolation[] = [];
  const fail = (code: string, message: string, matchIds: string[] = []) => errors.push({ code, message, matchIds, severity: 'ERROR' });
  const allowedDays = eventDays(snapshot.event.startDate, snapshot.event.endDate, config.timezone);
  const rules = new Map<string, any>(snapshot.rules.map((rule) => [rule.sportId, rule]));
  const teams = new Map<string, string[]>(snapshot.teams.map((team) => [team.id, team.members.map((member) => member.athleteId)]));
  const byId = new Map<string, any>(snapshot.matches.map((match) => [match.id, match]));
  const byes = new Set(snapshot.matches.filter(isAutomaticScheduleBye).map((match) => match.id));
  const input: PlannerInput = { matches: [], windows: [], reservations: [], autoContinue: config.autoContinue,
    matchOrders: config.matchOrders, pinnedStarts: config.pinnedStarts.map((pin) => ({ ...pin, startTime: Date.parse(pin.startTime) })),
    earliestStarts: config.earliestStarts.map((marker) => ({ ...marker, notBefore: Date.parse(marker.notBefore) })) };
  if (new Set(selected).size !== selected.length) fail('CATEGORY_ALREADY_ASSIGNED', 'Một hạng được chọn nhiều lần trong cùng lịch.');
  const removed = snapshot.matches.filter((match) => match.schedulePlanId === planId && !selected.includes(match.categoryId));
  if (removed.some((match) => match.scheduleLocked || ['RUNNING', 'FINISHED'].includes(match.status)
    || snapshot.slots.some((slot) => slot.match?.id === match.id && (slot.isLocked || slot.session.status === 'LOCKED')))) {
    fail('IMMUTABLE_MATCH', 'Không thể bỏ nội dung có trận đã đấu hoặc đã khóa khỏi lịch.', removed.map((match) => match.id));
  }
  for (const window of config.windows) {
    const fop = snapshot.event.fops.find((item) => item.id === window.fopId);
    if (!fop || !allowedDays.includes(window.localDate) || fop.venue?.isActive === false
      || config.timezone !== (fop.venue?.timezone || 'Asia/Ho_Chi_Minh')) {
      fail('OUTSIDE_EVENT', 'Ngày/thảm/múi giờ không thuộc cửa sổ hợp lệ của sự kiện.');
      continue;
    }
    input.windows.push({ ...window, start: localInstant(window.localDate, window.startLocalTime, config.timezone),
      end: localInstant(window.localDate, window.endLocalTime, config.timezone),
      breaks: window.breaks.map((pause) => ({ start: localInstant(window.localDate, pause.startLocalTime, config.timezone),
        end: localInstant(window.localDate, pause.endLocalTime, config.timezone) })) });
  }
  const sources = new Map<string, string[]>();
  for (const match of snapshot.matches) for (const target of [match.winnerToMatchId, match.loserToMatchId].filter(Boolean)) {
    sources.set(target, [...(sources.get(target) || []), match.id]);
  }
  const candidates = participantResolver(snapshot.matches, teams, snapshot.draws);
  const predecessors = (id: string, visiting = new Set<string>()): string[] => {
    if (visiting.has(id)) throw new ScheduleGraphError('DEPENDENCY_CYCLE', 'Quan hệ miễn đấu tạo thành chu trình.', [id]);
    return (sources.get(id) || []).flatMap((source) => byes.has(source) ? predecessors(source, new Set([...visiting, id])) : [source]);
  };
  config.blocks.forEach((block, blockOrder) => {
    const weighted: Array<{ category: any; kind: number; value: number }> = [];
    for (const id of block.categoryIds) {
      const category = categories.find((item) => item.id === id);
      if (!category || contentGroupKey(category) !== block.groupKey) { fail('INVALID_INPUT', 'Hạng không thuộc sự kiện hoặc nhóm nội dung đã chọn.'); continue; }
      const owner = snapshot.owners.find((item) => item.categoryId === id && item.planId !== planId);
      if (owner) { fail('CATEGORY_ALREADY_ASSIGNED', `Hạng ${category.name} đang thuộc lịch ${owner.planId}.`); continue; }
      try { weighted.push({ category, ...categoryWeight(category) }); }
      catch (error: any) { fail(error.code || 'INVALID_INPUT', `${category.name}: ${error.message}`); }
    }
    weighted.sort((a, b) => a.kind - b.kind || a.value - b.value || a.category.id.localeCompare(b.category.id));
    weighted.forEach(({ category }, weightOrder) => {
      try {
        const stages = semanticStages(snapshot, category.id);
        const rule = rules.get(category.sportId);
        const categoryMatches = snapshot.matches.filter((match) => match.categoryId === category.id && !byes.has(match.id));
        if (categoryMatches.some((match) => match.status === 'CANCELLED')) throw new ScheduleGraphError('DRAW_NOT_READY', 'Nhánh có trận đã hủy; cần xử lý sơ đồ trước khi xếp.');
        for (const match of categoryMatches) {
          if (match.startTime && match.schedulePlanId !== planId) throw new ScheduleGraphError('MATCH_ALREADY_ASSIGNED', 'Trận đã có lịch hiện hành; không tự nhập hoặc ghi đè lịch cũ.', [match.id]);
          const stage = stages.get(match.id)!;
          const known = scheduleParticipantIds(match, teams);
          const teamIds = [match.team1Id, match.team2Id, ...match.participants.map((item) => item.teamId)].filter(Boolean);
          const athleteIds = [match.athlete1Id, match.athlete2Id, ...match.participants.map((item) => item.athleteId)].filter(Boolean);
          const activeEntries = snapshot.entries.filter((entry) => entry.categoryId === category.id && ['REGISTERED', 'VERIFIED'].includes(entry.status));
          if (teamIds.some((id) => !activeEntries.some((entry) => entry.teamId === id))
            || athleteIds.some((id) => !activeEntries.some((entry) => entry.athleteId === id))) {
            throw new ScheduleGraphError('PARTICIPANT_NOT_REGISTERED', 'VĐV/đội chưa đăng ký hoặc đã rút khỏi hạng đấu.', [match.id]);
          }
          if (['DUO', 'SHOW'].includes(category.discipline) && (!known.some((id) => id.startsWith('team:'))
            || snapshot.entries.some((entry) => entry.categoryId === category.id && entry.type === 'INDIVIDUAL'))) {
            throw new ScheduleGraphError('TEAM_ROSTER_REQUIRED', 'Duo/Show cần entry đội và danh sách thành viên thật.', [match.id]);
          }
          const durationSeconds = block.estimatedDurationSeconds ?? (rule ? rule.matchDurationMinutes * 60 : category.matchDurationSeconds || 600);
          const poolSources = snapshot.draws.find((draw) => draw.id === match.drawId)?.type === 'POOL_WINNER_TREE'
            && match.round === 1 ? categoryMatches.filter((item) => stages.get(item.id)?.stageKey.startsWith('POOL_')).map((item) => item.id) : [];
          const normalized: PlannerMatch = { id: match.id, categoryId: category.id, contentKey: contentGroupKey(category), ...stage,
            blockId: block.id, blockOrder, weightOrder, bracketPosition: match.bracketPosition
              ?? snapshot.heats.find((heat) => heat.matchId === match.id)?.sequence ?? match.matchNumber ?? 0,
            matchNumber: match.matchNumber, predecessorIds: [...new Set([...predecessors(match.id), ...poolSources])], participantIds: known,
            candidateParticipantIds: candidates(match.id).filter((id) => !known.includes(id)),
            durationSeconds, turnaroundSeconds: block.turnaroundSeconds ?? (rule?.turnaroundMinutes ?? 5) * 60,
            minRestSeconds: (rule?.minRestMinutes ?? 60) * 60,
            actualEnd: match.status === 'FINISHED' && match.resultData?.scoreboard?.finishedAt
              ? Date.parse(match.resultData.scoreboard.finishedAt) : undefined,
            windowBounds: Object.fromEntries(input.windows.map((window) => [window.id, {
              start: Math.max(window.start, localInstant(window.localDate, rule?.earliestStart || '08:00', config.timezone)),
              end: Math.min(window.end, localInstant(window.localDate, rule?.latestEnd || '22:00', config.timezone)),
            }])),
            immutable: match.scheduleLocked || ['RUNNING', 'FINISHED'].includes(match.status),
            current: match.startTime && match.endTime ? { start: +new Date(match.startTime), end: +new Date(match.endTime), fopId: match.fopId, chainSequence: match.scheduleSequence } : undefined };
          input.matches.push(normalized);
        }
      } catch (error: any) { fail(error.code || 'INVALID_INPUT', `${category.name}: ${error.message}`, error.matchIds || []); }
    });
  });
  // A partially scheduled content has no reliable completion boundary. Do not
  // silently squeeze another content into that participant's unknown future.
  for (const category of categories.filter((category) => !selected.includes(category.id))) {
    const rows = snapshot.matches.filter((match) => match.categoryId === category.id && match.status !== 'CANCELLED' && !byes.has(match.id));
    if (!rows.some((match) => match.startTime || ['RUNNING', 'FINISHED'].includes(match.status))) continue;
    for (const pending of rows.filter((match) => match.status !== 'FINISHED' && (!match.startTime || !match.endTime))) {
      try {
        const unfinished = candidates(pending.id);
        const affected = input.matches.filter((match) => match.contentKey !== contentGroupKey(category)
          && [...match.participantIds, ...match.candidateParticipantIds].some((id) => unfinished.includes(id)));
        if (affected.length) errors.push({ code: 'CONTENT_COMPLETION_UNKNOWN', severity: 'ERROR',
          message: `Chưa xác định được giờ kết thúc nội dung ${category.name}. Cần xếp đủ các trận còn lại trước khi xếp nội dung tiếp theo cho VĐV chung.`,
          participantIds: [...new Set(affected.flatMap((match) => [...match.participantIds, ...match.candidateParticipantIds].filter((id) => unfinished.includes(id))))],
          matchIds: [...affected.map((match) => match.id), pending.id] });
      } catch (error: any) { fail(error.code || 'INVALID_INPUT', error.message, [pending.id]); }
    }
  }
  for (const match of snapshot.matches) {
    if (byes.has(match.id) || match.status === 'CANCELLED' || !match.startTime
      || (match.schedulePlanId === planId && !match.scheduleLocked && !['RUNNING', 'FINISHED'].includes(match.status))) continue;
    const category = categories.find((item) => item.id === match.categoryId);
    const rule = rules.get(category?.sportId);
    if (!match.endTime || !match.fopId) { fail('INVALID_INPUT', 'Lịch hiện có thiếu giờ kết thúc hoặc sân; cần sửa trước khi lập lịch mới.', [match.id]); continue; }
    try {
      const plan = snapshot.plans.find((item) => item.id === match.schedulePlanId);
      const item = plan?.applied?.items?.find((item) => item.matchId === match.id);
      const known = scheduleParticipantIds(match, teams);
      const clock = match.resultData?.scoreboard;
      input.reservations.push({ id: match.id, matchId: match.id, planId: match.schedulePlanId, fopId: match.fopId,
        contentKey: category ? contentGroupKey(category) : undefined,
        start: clock?.startedAt ? Date.parse(clock.startedAt) : +new Date(match.startTime),
        end: match.status === 'FINISHED' && clock?.finishedAt ? Date.parse(clock.finishedAt) : +new Date(match.endTime),
        turnaroundSeconds: item?.turnaroundSeconds ?? (rule?.turnaroundMinutes ?? 5) * 60,
        minRestSeconds: (rule?.minRestMinutes ?? 60) * 60,
        participantIds: known, candidateParticipantIds: candidates(match.id).filter((id) => !known.includes(id)) });
    } catch (error: any) { fail(error.code || 'INVALID_INPUT', error.message, [match.id]); }
  }
  for (const slot of snapshot.slots) {
    if (!slot.isLocked && slot.session.status !== 'LOCKED') continue;
    // A protected match may keep its own locked slot; other assignments cannot use it.
    input.reservations.push({ id: slot.id, matchId: slot.match?.id, fopId: slot.fopId,
      start: +new Date(slot.startTime), end: +new Date(slot.endTime), turnaroundSeconds: 0, minRestSeconds: 0,
      participantIds: [], candidateParticipantIds: [] });
    const planned = input.matches.find((match) => match.id === slot.match?.id);
    if (planned) planned.immutable = true;
  }
  let proposal = errors.length ? { assignments: [], unscheduled: snapshot.matches.filter((match) => selected.includes(match.categoryId) && !byes.has(match.id)).map((match) => ({ matchId: match.id, code: 'INVALID_INPUT' })),
    violations: errors, idleSegments: [], canApply: false } : planSchedule(input);
  // Rule operating hours are hard constraints even when a user supplies a wider window.
  for (const item of proposal.assignments) {
    const category = categories.find((category) => category.id === item.categoryId);
    const rule = rules.get(category?.sportId);
    if (item.start < localInstant(item.localDate, rule?.earliestStart || '08:00', config.timezone)
      || item.end > localInstant(item.localDate, rule?.latestEnd || '22:00', config.timezone)) {
      proposal.violations.push({ code: 'INVALID_WINDOW', severity: 'ERROR', message: 'Trận nằm ngoài giờ thi đấu theo quy định nội dung.', matchIds: [item.matchId] });
      proposal.canApply = false;
    }
  }
  const diff = [...proposal.assignments.map((item) => {
    const match = byId.get(item.matchId);
    const before = match.startTime ? { start: +new Date(match.startTime), end: +new Date(match.endTime), fopId: match.fopId } : null;
    return { matchId: item.matchId, before, after: { start: item.start, end: item.end, fopId: item.fopId },
      kind: !before ? 'ADDED' : before.start === item.start && before.end === item.end && before.fopId === item.fopId ? 'UNCHANGED' : 'CHANGED' };
  }), ...removed.map((match) => ({ matchId: match.id, before: { start: +new Date(match.startTime), end: +new Date(match.endTime), fopId: match.fopId }, after: null, kind: 'REMOVED' }))];
  const segments = [...new Set(proposal.assignments.map((item) => item.windowId))].map((windowId) => {
    const items = proposal.assignments.filter((item) => item.windowId === windowId);
    return { windowId, localDate: items[0].localDate, fopId: items[0].fopId, matchCount: items.length,
      start: items[0].start, end: items.at(-1)!.end, continuation: items[0].chainSequence > 1 };
  });
  const requestedStarts = input.earliestStarts.map((marker) => {
    const target = marker.target;
    const item = proposal.assignments.find((item) => 'matchId' in target ? item.matchId === target.matchId
      : item.blockId === target.blockId && item.stageKey === target.stageKey);
    return { target, requested: marker.notBefore, actual: item?.start ?? null, matchId: item?.matchId ?? null };
  });
  const changed = diff.filter((item) => item.before && item.after && item.kind === 'CHANGED');
  const diffSummary = { affectedDays: [...new Set(diff.filter((item) => item.kind !== 'UNCHANGED').flatMap((item) =>
    [item.before, item.after].filter(Boolean).map((interval) => localDay(new Date(interval!.start), config.timezone))))].sort(),
    movedDay: changed.filter((item) => localDay(new Date(item.before!.start), config.timezone) !== localDay(new Date(item.after!.start), config.timezone)).length,
    movedFop: changed.filter((item) => item.before!.fopId !== item.after!.fopId).length,
    timeShift: changed.filter((item) => item.before!.start !== item.after!.start || item.before!.end !== item.after!.end).length };
  proposal.violations = describeScheduleViolations({ ...snapshot, matches: snapshot.matches.map((match) => {
    const assignment = proposal.assignments.find((item) => item.matchId === match.id);
    return assignment ? { ...match, startTime: new Date(assignment.start), endTime: new Date(assignment.end) } : match;
  }) }, proposal.violations, config.timezone);
  return { ...proposal, diff, diffSummary, segments, requestedStarts, fops: snapshot.event.fops.map((fop) => ({ id: fop.id, name: fop.name })),
    byesExcluded: snapshot.matches.filter((match) => selected.includes(match.categoryId) && byes.has(match.id)).map((match) => match.id),
    totalMatches: snapshot.matches.filter((match) => selected.includes(match.categoryId) && !byes.has(match.id)).length,
    warningsRequiringAcknowledgement: proposal.violations.filter((item) => item.severity === 'WARNING'),
    matchDetails: input.matches.map((match) => { const raw = byId.get(match.id); return { id: match.id, matchNumber: raw.matchNumber,
      categoryId: match.categoryId, categoryName: categories.find((item) => item.id === match.categoryId)?.name,
      drawId: match.drawId, stageKey: match.stageKey, round: raw.round, blockId: match.blockId, immutable: match.immutable, status: raw.status,
      canScore: ['SCHEDULED', 'RUNNING'].includes(raw.status) && Boolean(raw.athlete1Id && raw.athlete2Id),
      participants: [raw.athlete1?.fullName || raw.team1?.name, raw.athlete2?.fullName || raw.team2?.name].filter(Boolean),
      sources: (sources.get(match.id) || []).map((id) => { const source = byId.get(id); return `${source.winnerToMatchId === match.id ? 'Thắng' : 'Thua'} trận #${source.matchNumber || id}`; }) }; }) };
}
