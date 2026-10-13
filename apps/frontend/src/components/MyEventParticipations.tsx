'use client';

import Link from 'next/link';
import { Button, Card, Empty, Spin, Tag } from 'antd';
import { ParticipationTicketActions } from './ParticipationTicketActions';
import { IssuedParticipationTicket } from './IssuedParticipationTicket';
import { eventRoleLabel, participationStatusLabels, type EventParticipation } from '@/lib/event-participation';

export function MyEventParticipations({ participations: data, isLoading, error, onRetry, hideWhenEmpty = false }: {
  participations: EventParticipation[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  hideWhenEmpty?: boolean;
}) {
  if (hideWhenEmpty && !isLoading && !error && !data.length) return null;
  return (
    <Card title={`Thẻ tham gia theo vai trò (${data.length})`}>
      {isLoading ? <Spin /> : error ? <div className="space-y-3"><p>Không thể tải hồ sơ tham gia. Vui lòng thử lại.</p><Button onClick={onRetry}>Thử lại</Button></div> : data.length ? <div className="space-y-6">{data.map((item) => (
        <div key={item.id} className="rounded-xl border border-white/10 p-4">
          <Link className="font-semibold text-sky-400" href={`/events/${item.event.id}/register?role=${item.role}`}>{item.event.name}</Link>
          <div className="mt-2 flex flex-wrap gap-2"><Tag color="blue">{eventRoleLabel(item.role)}</Tag><Tag color={item.status === 'CONFIRMED' ? 'success' : item.status === 'REJECTED' ? 'error' : 'default'}>{participationStatusLabels[item.status]}</Tag></div>
          <p className="mt-2 text-sm text-slate-400">Mã thẻ / hồ sơ: {item.referenceCode}{item.federation ? ` · Đơn vị / CLB: ${item.federation.name}` : ''}</p>
          {item.statusReason && <p className="mt-1 text-sm text-slate-400">{item.statusReason}</p>}
          {item.status === 'CONFIRMED'
            ? <div className="my-5"><IssuedParticipationTicket code={item.referenceCode} /></div>
            : <p className="mt-3 text-sm text-slate-500">Thẻ được phát hành sau khi hồ sơ tham gia sự kiện được duyệt.</p>}
          <div className="mt-3"><ParticipationTicketActions code={item.referenceCode} status={item.status} /></div>
        </div>
      ))}</div> : <Empty description="Chưa có hồ sơ tham gia sự kiện với vai trò ngoài VĐV" />}
    </Card>
  );
}
