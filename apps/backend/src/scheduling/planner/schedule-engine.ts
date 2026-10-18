import {
  Interval, PlannerAssignment, PlannerInput, PlannerMatch, PlannerReservation,
  PlannerResult, PlannerViolation,
} from './schedule-types';
import { contentConflicts, participantContentSpans } from './participant-content';

const intersects = (left: Interval, right: Interval) => left.start < right.end && right.start < left.end;
const shares = (left: string[], right: string[]) => left.some((id) => right.includes(id));
const groupKey = (match: Pick<PlannerMatch, 'categoryId' | 'drawId' | 'stageKey'>) =>
  JSON.stringify([match.categoryId, match.drawId, match.stageKey]);

/** Pure, deterministic scheduling of a validated semantic graph. No database writes. */
export function planSchedule(input: PlannerInput): PlannerResult {
  const proposal = scheduleWithContentRules(input);
  const conflict = proposal.violations.find((item) => item.code === 'PIN_CONFLICT' && item.targetMatchId);
  if (conflict) {
    const notBefore = conflict.earliestStart ?? conflict.requestedStart;
    const unpinned = scheduleWithContentRules({ ...input, pinnedStarts: input.pinnedStarts.filter((pin) => pin.matchId !== conflict.targetMatchId),
      earliestStarts: notBefore == null ? input.earliestStarts : [...input.earliestStarts, { target: { matchId: conflict.targetMatchId! }, notBefore }] });
    const suggestion = unpinned.assignments.find((item) => item.matchId === conflict.targetMatchId);
    if (suggestion) conflict.suggestedStart = suggestion.start;
  }
  return proposal;
}

function scheduleWithContentRules(input: PlannerInput): PlannerResult {
  const byId = new Map(input.matches.map((match) => [match.id, match]));
  const outside = participantContentSpans(input.reservations.filter((item) => !item.matchId || !byId.has(item.matchId)));
  const notBefore = new Map<string, number>();
  const waits = new Map<string, PlannerViolation>();
  // Each pass advances at least one participant beyond an existing content's end.
  // No existing plan is moved, and the whole proposal is recomputed atomically.
  for (let attempt = 0; attempt <= outside.length; attempt += 1) {
    const proposal = schedulePass(input, notBefore);
    const own = participantContentSpans(proposal.assignments.map((item) => ({ ...item, ...byId.get(item.matchId)!,
      matchId: item.matchId, end: byId.get(item.matchId)!.actualEnd ?? item.end })));
    const conflicts = contentConflicts(own, outside);
    if (!conflicts.length) {
      proposal.violations.push(...[...waits.values()].map((item) => ({ ...item,
        severity: proposal.canApply ? 'INFO' as const : 'ERROR' as const,
        message: proposal.canApply ? 'Đã dời nội dung để VĐV hoàn tất nội dung trước và đủ thời gian nghỉ.'
          : 'Chưa thể xếp đủ lịch: VĐV phải hoàn tất nội dung trước và đủ thời gian nghỉ.' })));
      return proposal;
    }
    for (const { left, right } of conflicts) {
      const violation: PlannerViolation = { code: 'PARTICIPANT_CONTENT_IN_PROGRESS', severity: 'ERROR',
        message: 'VĐV chưa thể chuyển nội dung: phải thi đấu xong hoặc bị loại khỏi nội dung trước.',
        participantIds: [left.participantId], matchIds: [...left.matchIds, ...right.matchIds], relatedPlanIds: right.planIds };
      waits.set(JSON.stringify([left.contentKey, right.contentKey, left.participantId]), violation);
      if (left.matchIds.some((id) => byId.get(id)?.immutable) || attempt === outside.length) {
        proposal.violations.push(...waits.values()); proposal.canApply = false; return proposal;
      }
      const minimum = right.end + Math.max(left.minRestSeconds, right.minRestSeconds) * 1000;
      left.matchIds.forEach((id) => notBefore.set(id, Math.max(notBefore.get(id) ?? -Infinity, minimum)));
    }
  }
  throw new Error('Không thể xác định thứ tự hoàn tất nội dung.');
}

function schedulePass(input: PlannerInput, contentNotBefore: Map<string, number>): PlannerResult {
  const violations: PlannerViolation[] = [];
  const assignments: PlannerAssignment[] = [];
  const idleSegments: PlannerResult['idleSegments'] = [];
  let orderedMatches = input.matches;
  const error = (code: string, message: string, matchIds: string[] = [], windowId?: string) => {
    violations.push({ code, message, matchIds, windowId, severity: 'ERROR' });
  };
  const result = (code = 'INVALID_INPUT'): PlannerResult => ({
    assignments, idleSegments, violations,
    unscheduled: orderedMatches.filter((match) => !assignments.some((item) => item.matchId === match.id))
      .map((match) => ({ matchId: match.id, code })),
    canApply: assignments.length === input.matches.length && assignments.length > 0
      && !violations.some((item) => item.severity === 'ERROR'),
  });
  const byId = new Map(input.matches.map((match) => [match.id, match]));
  if (byId.size !== input.matches.length) error('MATCH_ALREADY_ASSIGNED', 'Một trận xuất hiện nhiều lần trong lịch.');
  if (!input.matches.length) error('DRAW_NOT_READY', 'Không có trận đấu hợp lệ để xếp lịch.');
  const validInterval = (interval: Interval) => Number.isFinite(interval.start)
    && Number.isFinite(interval.end) && interval.start < interval.end;
  const windows = input.windows.filter((window) => window.enabled).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  if (!windows.length) error('INVALID_WINDOW', 'Cần ít nhất một ngày/giờ/thảm được bật.');
  if (new Set(input.windows.map((window) => window.id)).size !== input.windows.length) {
    error('INVALID_WINDOW', 'Các cửa sổ thi đấu phải có mã riêng biệt.');
  }
  for (const [index, window] of windows.entries()) {
    if (!validInterval(window) || !window.fopId || window.breaks.some((pause) =>
      !validInterval(pause) || pause.start < window.start || pause.end > window.end)
      || (index > 0 && windows[index - 1].end > window.start)) {
      error('INVALID_WINDOW', 'Khung giờ hoặc khoảng nghỉ không hợp lệ, hoặc các khung giờ chồng nhau.', [], window.id);
    }
  }
  for (const match of input.matches) {
    if (!Number.isFinite(match.durationSeconds) || match.durationSeconds <= 0
      || !Number.isFinite(match.turnaroundSeconds) || match.turnaroundSeconds < 0
      || !Number.isFinite(match.minRestSeconds) || match.minRestSeconds < 0
      || !Number.isFinite(match.weightOrder) || !Number.isFinite(match.stageOrder)
      || !Number.isFinite(match.blockOrder) || !Number.isFinite(match.bracketPosition)) {
      error('INVALID_INPUT', 'Thiếu thời lượng, thứ tự vòng hoặc thứ tự hạng đã xác thực.', [match.id]);
    }
    if (match.immutable && (!match.current || !validInterval(match.current))) {
      error('IMMUTABLE_MATCH', 'Trận được bảo vệ chưa có khoảng thời gian hợp lệ; cần xử lý lịch hiện hành.', [match.id]);
    }
    for (const predecessorId of match.predecessorIds) {
      if (!byId.has(predecessorId) && !input.reservations.some((item) => item.matchId === predecessorId && validInterval(item))) {
        error('PREDECESSOR_NOT_AVAILABLE', 'Không có trận nguồn hoặc lịch hợp lệ của trận nguồn.', [match.id, predecessorId]);
      }
    }
  }
  for (const reservation of input.reservations) {
    if (!validInterval(reservation) || !Number.isFinite(reservation.turnaroundSeconds)
      || reservation.turnaroundSeconds < 0 || !Number.isFinite(reservation.minRestSeconds) || reservation.minRestSeconds < 0) {
      error('INVALID_INPUT', 'Khoảng thời gian của lịch hiện hành không hợp lệ.', reservation.matchId ? [reservation.matchId] : []);
    }
  }

  const customOrder = new Map<string, number>();
  const seenGroups = new Set<string>();
  for (const order of input.matchOrders) {
    const key = groupKey(order);
    const group = input.matches.filter((match) => groupKey(match) === key);
    if (seenGroups.has(key) || !group.length || order.orderedMatchIds.length !== group.length
      || new Set(order.orderedMatchIds).size !== group.length
      || order.orderedMatchIds.some((id) => !group.some((match) => match.id === id))) {
      error('INVALID_MATCH_ORDER', 'Thứ tự phải chứa đủ mỗi trận đúng một lần trong cùng hạng, vòng và nhánh.', order.orderedMatchIds);
    } else {
      const original = [...group].sort((a, b) => (a.current?.chainSequence ?? a.bracketPosition)
        - (b.current?.chainSequence ?? b.bracketPosition) || a.id.localeCompare(b.id));
      // Reordering across a protected match would change the meaning of the prefix.
      original.forEach((match, index) => {
        if (match.immutable && (order.orderedMatchIds[index] !== match.id
          || order.orderedMatchIds.slice(0, index).some((id) => !original.slice(0, index).some((item) => item.id === id)))) {
          error('IMMUTABLE_MATCH', 'Không thể đổi thứ tự qua trận đã đấu hoặc đã khóa.', [match.id]);
        }
      });
      order.orderedMatchIds.forEach((id, index) => customOrder.set(id, index));
    }
    seenGroups.add(key);
  }
  const ordered = [...input.matches].sort((a, b) => a.blockOrder - b.blockOrder
    || a.stageOrder - b.stageOrder || a.weightOrder - b.weightOrder
    || a.categoryId.localeCompare(b.categoryId) || a.drawId.localeCompare(b.drawId)
    || (customOrder.get(a.id) ?? a.bracketPosition) - (customOrder.get(b.id) ?? b.bracketPosition)
    || a.id.localeCompare(b.id));
  orderedMatches = ordered;

  // Kahn's algorithm detects cycles independently of the requested strict order.
  const incoming = new Map(input.matches.map((match) => [match.id, new Set(match.predecessorIds.filter((id) => byId.has(id))).size]));
  const outgoing = new Map<string, string[]>();
  input.matches.forEach((match) => new Set(match.predecessorIds).forEach((id) => {
    if (byId.has(id)) outgoing.set(id, [...(outgoing.get(id) || []), match.id]);
  }));
  const ready = input.matches.filter((match) => incoming.get(match.id) === 0).map((match) => match.id);
  let visited = 0;
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    visited += 1;
    for (const id of outgoing.get(ready[cursor]) || []) {
      incoming.set(id, incoming.get(id)! - 1);
      if (incoming.get(id) === 0) ready.push(id);
    }
  }
  if (visited !== input.matches.length) error('DEPENDENCY_CYCLE', 'Quan hệ trận nguồn tạo thành chu trình.',
    input.matches.filter((match) => incoming.get(match.id)! > 0).map((match) => match.id));
  const positions = new Map(ordered.map((match, index) => [match.id, index]));
  ordered.forEach((match, index) => {
    const invalid = match.predecessorIds.filter((id) => positions.has(id) && positions.get(id)! >= index);
    if (invalid.length) error('INVALID_MATCH_ORDER', 'Thứ tự vòng/nhánh đặt trận trước trận nguồn.', [match.id, ...invalid]);
  });
  const earliest = new Map<string, number>();
  for (const marker of input.earliestStarts) {
    const target = marker.target;
    const matches = ordered.filter((match) => 'matchId' in target ? match.id === target.matchId
      : match.blockId === target.blockId && match.stageKey === target.stageKey);
    if (!matches.length || !Number.isFinite(marker.notBefore)
      || !windows.some((window) => marker.notBefore >= window.start && marker.notBefore < window.end)) {
      error('INVALID_WINDOW', 'Mốc tiếp tục phải trỏ đến trận/vòng và khung giờ đang bật.', matches.map((match) => match.id));
    }
    matches.forEach((match) => earliest.set(match.id, Math.max(earliest.get(match.id) ?? -Infinity, marker.notBefore)));
  }
  const pins = new Map<string, number>();
  for (const pin of input.pinnedStarts) {
    if (pins.has(pin.matchId) || !byId.has(pin.matchId) || !Number.isFinite(pin.startTime)
      || !windows.some((window) => pin.startTime >= window.start && pin.startTime < window.end)) {
      error('PIN_CONFLICT', 'Mốc cố định bị trùng hoặc nằm ngoài cửa sổ đã cho phép.', [pin.matchId]);
    }
    pins.set(pin.matchId, pin.startTime);
  }
  if (violations.length) return result();

  const reservations = input.reservations.map((item) => ({ ...item }));
  const completed = new Map(reservations.filter((item) => item.matchId).map((item) => [item.matchId!, item]));
  let windowIndex = 0;
  let cursor = windows[0].start;
  for (const match of ordered) {
    const duration = match.durationSeconds * 1000;
    const previous = assignments.at(-1);
    const previousReservation = previous ? completed.get(previous.matchId) : undefined;
    const fixed = match.immutable ? match.current!.start : pins.get(match.id);
    const requested = fixed ?? earliest.get(match.id);
    // An explicit start may shorten the default transition buffer within this
    // proposal. Match duration, protected reservations and participant rest stay hard.
    const overridesTransition = requested !== undefined && previous && requested < cursor
      && (fixed !== undefined || requested >= Math.max(previous.end, previousReservation!.end));
    const sequenceMinimum = overridesTransition ? Math.max(previous.end, previousReservation!.end) : cursor;
    const dependencyEnd = Math.max(-Infinity, ...match.predecessorIds.map((id) => completed.get(id)!.end + match.minRestSeconds * 1000));
    const minimum = Math.max(sequenceMinimum, dependencyEnd, earliest.get(match.id) ?? -Infinity, contentNotBefore.get(match.id) ?? -Infinity);
    const idleReasons = new Set<string>();
    if (dependencyEnd > cursor) idleReasons.add('Chờ trận nguồn kết thúc và đủ thời gian nghỉ');
    if ((earliest.get(match.id) ?? -Infinity) > cursor) idleReasons.add('Chờ mốc không bắt đầu trước');
    if ((contentNotBefore.get(match.id) ?? -Infinity) > cursor) idleReasons.add('Chờ VĐV hoàn tất nội dung trước và đủ thời gian nghỉ');
    if (match.immutable && pins.has(match.id) && pins.get(match.id) !== fixed) {
      error('IMMUTABLE_MATCH', 'Mốc cố định thay đổi giờ của trận đã được bảo vệ.', [match.id]);
      return result('IMMUTABLE_MATCH');
    }
    if (fixed !== undefined && (fixed < minimum || (match.immutable && match.current!.end - fixed !== duration))) {
      const reasons: string[] = [];
      const relatedIds: string[] = [];
      if (previous && minimum === sequenceMinimum) {
        const preceding = byId.get(previous.matchId)!;
        reasons.push(`Phải chờ ${preceding.matchNumber ? `trận #${preceding.matchNumber}` : 'trận trước'} kết thúc${overridesTransition ? '' : ` và thêm ${preceding.turnaroundSeconds / 60} phút chuyển trận`}`);
        relatedIds.push(previous.matchId);
      }
      if (minimum === dependencyEnd) {
        reasons.push(`Phải chờ trận nguồn kết thúc và nghỉ đủ ${match.minRestSeconds / 60} phút`);
        relatedIds.push(...match.predecessorIds);
      }
      if (minimum === earliest.get(match.id)) reasons.push('Trận/vòng này có mốc không bắt đầu trước đã được đặt');
      if (minimum === contentNotBefore.get(match.id)) reasons.push('VĐV phải hoàn tất nội dung trước và đủ thời gian nghỉ');
      violations.push({ code: match.immutable ? 'IMMUTABLE_MATCH' : 'PIN_CONFLICT', severity: 'ERROR',
        message: match.immutable ? 'Giờ hoặc thời lượng của trận đã đấu/đã khóa không thể thay đổi.' : 'Giờ cố định sớm hơn thời điểm trận có thể bắt đầu.',
        matchIds: [match.id, ...new Set(relatedIds)], targetMatchId: match.id, requestedStart: fixed,
        earliestStart: minimum, description: reasons.join('. ') });
      return result(match.immutable ? 'IMMUTABLE_MATCH' : 'PIN_CONFLICT');
    }
    let chosen: PlannerAssignment | undefined;
    const blockers = new Set<PlannerReservation>();
    let attemptedIndex = windowIndex;
    // A deliberate marker can move into a later window with autoContinue off.
    const explicitStart = Math.max(earliest.get(match.id) ?? -Infinity, fixed ?? -Infinity);
    if (explicitStart >= windows[attemptedIndex].end) {
      const targetIndex = windows.findIndex((window) => explicitStart >= window.start && explicitStart < window.end);
      if (targetIndex >= 0) attemptedIndex = targetIndex;
    }
    for (; attemptedIndex < windows.length; attemptedIndex += 1) {
      const window = { ...windows[attemptedIndex], fopId: match.fopId || windows[attemptedIndex].fopId };
      const bound = match.windowBounds?.[window.id] || window;
      if (bound.start > window.start) idleReasons.add('Chờ giờ thi đấu theo quy định nội dung');
      let start = Math.max(minimum, window.start, bound.start, fixed ?? -Infinity);
      if (fixed !== undefined && (start !== fixed || (match.immutable && match.current!.fopId !== window.fopId))) {
        if (fixed >= window.end && input.autoContinue) continue;
        break;
      }
      while (start + duration <= Math.min(window.end, bound.end)) {
        const interval = { start, end: start + duration };
        let shifted = start;
        for (const pause of window.breaks) if (intersects(interval, pause)) { shifted = Math.max(shifted, pause.end); idleReasons.add('Khoảng nghỉ trong ngày'); }
        for (const reservation of reservations) {
          if (reservation.matchId === match.id) continue;
          const transition = overridesTransition && reservation.matchId === previous.matchId ? 0 : reservation.turnaroundSeconds;
          const changingMat = match.fopId && match.fopId !== match.current?.fopId;
          const plannedFop = reservation.fopInterval || reservation;
          const fopStart = changingMat ? Math.min(reservation.start, plannedFop.start) : plannedFop.start;
          const fopEnd = changingMat ? Math.max(reservation.end, plannedFop.end) : plannedFop.end;
          if (reservation.fopId === window.fopId
            && start < fopEnd + transition * 1000
            && interval.end + match.turnaroundSeconds * 1000 > fopStart) {
            shifted = Math.max(shifted, fopEnd + transition * 1000);
            blockers.add(reservation);
            idleReasons.add('Chờ thảm trống và thời gian chuyển trận');
          }
          const rest = Math.max(match.minRestSeconds, reservation.minRestSeconds) * 1000;
          if (shares(match.participantIds, reservation.participantIds)
            && start < reservation.end + rest && interval.end + rest > reservation.start) {
            shifted = Math.max(shifted, reservation.end + rest);
            blockers.add(reservation);
            idleReasons.add('Chờ VĐV/đội đủ thời gian nghỉ');
          }
        }
        if (shifted > start) {
          if (fixed !== undefined) break;
          start = shifted;
          continue;
        }
        chosen = { matchId: match.id, categoryId: match.categoryId, drawId: match.drawId,
          blockId: match.blockId, stageKey: match.stageKey, chainSequence: assignments.length + 1,
          windowId: window.id, localDate: window.localDate, fopId: window.fopId,
          durationSeconds: match.durationSeconds, turnaroundSeconds: match.turnaroundSeconds, ...interval };
        break;
      }
      if (chosen || fixed !== undefined || !input.autoContinue) break;
    }
    if (!chosen) {
      const code = fixed !== undefined ? match.immutable ? 'IMMUTABLE_MATCH' : 'PIN_CONFLICT'
        : input.autoContinue ? 'EVENT_CAPACITY_EXCEEDED' : 'DAY_CAPACITY_EXCEEDED';
      violations.push({ code, severity: 'ERROR', message: fixed !== undefined ? 'Giờ cố định xung đột lịch hiện hành, khoảng nghỉ hoặc cửa sổ thi đấu.'
        : 'Không còn khoảng liên tục đủ dài; các trận phía sau chưa được xếp.',
        matchIds: [...new Set([match.id, ...[...blockers].flatMap((item) => item.matchId ? [item.matchId] : [])])],
        targetMatchId: match.id, requestedStart: fixed, description: [...idleReasons].join('. '),
        relatedPlanIds: [...new Set([...blockers].flatMap((item) => item.planId ? [item.planId] : []))],
        windowId: windows[Math.min(attemptedIndex, windows.length - 1)].id });
      return result(code);
    }
    const window = windows[attemptedIndex];
    if (chosen.start > Math.max(cursor, window.start)) idleSegments.push({
      start: Math.max(cursor, window.start), end: chosen.start, beforeMatchId: match.id, windowId: window.id,
      reasons: idleReasons.size ? [...idleReasons] : ['Chờ giờ cố định'],
    });
    if (overridesTransition && chosen.start < cursor) {
      previous.turnaroundSeconds = Math.floor((chosen.start - previous.end) / 1000);
      reservations.filter((item) => item.matchId === previous.matchId).forEach((item) => {
        item.turnaroundSeconds = Math.min(item.turnaroundSeconds, previous.turnaroundSeconds);
      });
    }
    assignments.push(chosen);
    const reservation: PlannerReservation = { ...chosen, id: match.id,
      contentKey: match.contentKey,
      end: match.actualEnd ?? chosen.end,
      fopInterval: match.actualEnd == null ? undefined : { start: chosen.start, end: chosen.end },
      participantIds: match.participantIds, candidateParticipantIds: match.candidateParticipantIds,
      minRestSeconds: match.minRestSeconds };
    completed.set(match.id, reservation);
    reservations.push(reservation);
    cursor = chosen.end + match.turnaroundSeconds * 1000;
    windowIndex = attemptedIndex;
  }
  return result();
}
