'use client';

import useSWR from 'swr';
import { Skeleton } from 'antd';
import { fetcher } from '@/lib/api';
import type { ParticipationTicket } from '@/lib/ticket-types';
import { EventParticipationCard } from './EventParticipationCard';
import { ToastNotice } from './ToastNotice';

export function IssuedParticipationTicket({ code }: { code: string }) {
  const { data: ticket, error } = useSWR<ParticipationTicket>(
    `/participant-auth/tickets/${encodeURIComponent(code)}`,
    fetcher,
    { refreshInterval: 30_000 },
  );
  if (error) return <ToastNotice type="warning" message="Không thể tải thẻ. Vui lòng mở lại thẻ để thử lại." />;
  if (!ticket) return <Skeleton active />;
  if (!ticket.isValid) return <ToastNotice type="info" message="Hồ sơ chưa đủ điều kiện phát hành thẻ." />;
  return <EventParticipationCard ticket={ticket} />;
}
