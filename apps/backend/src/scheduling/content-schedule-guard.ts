import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { contentGroupKey, isAutomaticScheduleBye, scheduleParticipantIds } from './planner/main-tree';
import { contentConflicts, participantContentSpans, participantResolver } from './planner/participant-content';

/** Run after legacy schedule writes inside the same event-locked transaction. */
export async function assertContentSchedule(db: Prisma.TransactionClient, eventId: string, changedIds: string[]) {
  const [matches, teams, rules] = await Promise.all([
    db.match.findMany({ where: { eventId }, include: { category: true, draw: true, participants: true,
      athlete1: { select: { fullName: true } }, athlete2: { select: { fullName: true } } } }),
    db.team.findMany({ where: { eventId }, include: { members: true } }),
    db.sportSchedulingRule.findMany({ where: { eventId } }),
  ]);
  const members = new Map(teams.map((team) => [team.id, team.members.map((member) => member.athleteId)]));
  const resolve = participantResolver(matches, members);
  const spans = participantContentSpans(matches.filter((match) => match.startTime && match.endTime && match.status !== 'CANCELLED'
    && !isAutomaticScheduleBye(match)).map((match) => ({ matchId: match.id, planId: match.schedulePlanId,
    contentKey: contentGroupKey(match.category), start: match.startTime.getTime(),
    end: match.status === 'FINISHED' && (match.resultData as any)?.scoreboard?.finishedAt ? Date.parse((match.resultData as any).scoreboard.finishedAt) : match.endTime.getTime(),
    participantIds: scheduleParticipantIds(match, members), candidateParticipantIds: resolve(match.id),
    minRestSeconds: (rules.find((rule) => rule.sportId === match.category.sportId)?.minRestMinutes ?? 60) * 60 })));
  const conflict = contentConflicts(spans.filter((span) => span.matchIds.some((id) => changedIds.includes(id))), spans)[0];
  if (!conflict) return;
  const first = matches.find((match) => conflict.left.matchIds.includes(match.id));
  const other = matches.find((match) => conflict.right.matchIds.includes(match.id));
  throw new ConflictException({ code: 'PARTICIPANT_CONTENT_IN_PROGRESS',
    message: `Không thể xen kẽ ${first.category.name} và ${other.category.name}: VĐV chung phải hoàn tất hoặc bị loại khỏi một nội dung trước khi chuyển nội dung. Mở Sắp xếp trận đấu để tính lại lịch.`,
    matchIds: [...conflict.left.matchIds, ...conflict.right.matchIds] });
}
