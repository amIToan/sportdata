import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from './matches.service';
import { QueryMatchDto } from './dto/query-match.dto';

const statusLabels: Record<string, string> = { SCHEDULED: 'Sắp diễn ra', RUNNING: 'Đang thi đấu', FINISHED: 'Đã hoàn thành', CANCELLED: 'Đã hủy' };
const dateText = (value: Date | string, time = false) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', ...(time ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }
    : { day: '2-digit', month: '2-digit', year: 'numeric' }),
}).format(new Date(value));
const scoreText = (value: unknown) => {
  const score = Number(value || 0);
  return Number.isInteger(score) ? String(score) : score.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
};
const participant = (match: any, side: 1 | 2) => {
  const team = match[`team${side}`];
  if (team) return team.members?.map((member: any) => member.athlete.fullName).join(' / ') || team.name;
  const athlete = match[`athlete${side}`];
  if (!athlete) return 'Chờ xác định';
  return athlete.fullName + (match.status === 'FINISHED' && match.winnerId && match.winnerId === athlete.id ? ' Thắng' : '');
};
const csvCell = (value: unknown) => {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

@Injectable()
export class MatchExportService {
  constructor(private readonly prisma: PrismaService, private readonly matches: MatchesService) {}

  async csv(eventId: string, query: QueryMatchDto) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện.');
    // All pages, with the same filters, ordering, columns and display values as the CMS table.
    const result = await this.matches.findAll({ ...query, eventId, pagination: 'page', scheduleOrder: query.scheduleOrder || 'asc', page: 1 }, true, true);
    const header = ['Thứ tự thi đấu', 'Hạng đấu', '#', 'Vòng', 'Ngày / giờ', 'VĐV 1', 'VĐV 2', 'Điểm', 'Sân', 'Trạng thái'];
    const rows = result.items.map((match: any) => [
      match.scheduleOrder ?? 'Chưa xếp giờ', match.category?.name || '—', match.matchNumber, match.round,
      match.startTime ? `${dateText(match.startTime, true)} ${dateText(match.startTime)}` : `${dateText(match.matchDate)} · Chưa xếp giờ`,
      participant(match, 1), participant(match, 2),
      match.athlete1 && match.athlete2 ? `${scoreText(match.athlete1Score)} – ${scoreText(match.athlete2Score)}` : '—',
      match.fopRecord?.name || match.fop || 'Chưa chọn sân', statusLabels[match.status] || match.status,
    ]);
    return Buffer.from('\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
  }
}
