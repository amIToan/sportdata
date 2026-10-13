'use client';

import { ToastNotice } from '@/components/ToastNotice';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { Button, Card, Descriptions, Result, Skeleton, Statistic, Tag } from 'antd';
import { ArrowLeft, CheckCircle2, FileCheck2, Medal, Printer, ShieldCheck, Swords, Trophy } from 'lucide-react';
import { EventParticipationCard } from '@/components/EventParticipationCard';
import { PaymentCheckout } from '@/components/PaymentCheckout';
import { fetcher } from '@/lib/api';
import type { ParticipationTicket, TicketStatistics } from '@/lib/ticket-types';

const statusLabels: Record<string, { label: string; color: string }> = {
  CONFIRMED: { label: 'Thẻ hợp lệ', color: 'success' },
  SUBMITTED: { label: 'Đang chờ xác nhận', color: 'processing' },
  REJECTED: { label: 'Hồ sơ bị từ chối', color: 'error' },
  CANCELLED: { label: 'Hồ sơ đã hủy', color: 'default' },
};

const genderLabels: Record<string, string> = {
  MALE: 'Nam',
  FEMALE: 'Nữ',
  MIXED: 'Hỗn hợp',
};

const disciplineLabels: Record<string, string> = {
  NEWAZA: 'Newaza · Địa chiến',
  FIGHTING: 'Fighting',
  CONTACT: 'Contact',
  FULL_CONTACT: 'Full Contact',
  DUO: 'Duo',
  SHOW: 'Show',
};

function medalTotal(statistics?: TicketStatistics) {
  return statistics
    ? statistics.goldMedals + statistics.silverMedals + statistics.bronzeMedals
    : 0;
}

export default function TicketVerificationPage() {
  const params = useParams<{ ticketCode: string }>();
  const ticketCode = decodeURIComponent(params.ticketCode || '').toUpperCase();
  const { data: ticket, error, isLoading, mutate } = useSWR<ParticipationTicket>(
    ticketCode ? `/participant-auth/tickets/${encodeURIComponent(ticketCode)}` : null,
    fetcher,
    { refreshInterval: 30_000 },
  );

  if (isLoading) {
    return (
      <main className="ticket-verification-page mx-auto min-h-[80vh] max-w-5xl px-4 py-10">
        <Skeleton active paragraph={{ rows: 12 }} />
      </main>
    );
  }

  if (error || !ticket) {
    return (
      <main className="ticket-verification-page grid min-h-[75vh] place-items-center px-4">
        <Result
          status="404"
          title="Không tìm thấy hồ sơ hoặc thẻ tham dự"
          subTitle="Mã hồ sơ, mã QR hoặc mã thẻ không tồn tại. Vui lòng kiểm tra lại với ban tổ chức SportData."
          extra={<Link href="/events"><Button type="primary">Xem sự kiện</Button></Link>}
        />
      </main>
    );
  }

  const status = statusLabels[ticket.status] || statusLabels.SUBMITTED;
  const career = ticket.achievements?.career;
  const eventPerformance = ticket.achievements?.event;
  const categories: NonNullable<ParticipationTicket['categories']> = ticket.categories?.length
    ? ticket.categories : [ticket.category];

  return (
    <main className="ticket-verification-page min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="ticket-page-controls mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link href="/events">
            <Button icon={<ArrowLeft className="h-4 w-4" />}>Sự kiện</Button>
          </Link>
          {ticket.isValid ? (
            <Button
              type="primary"
              href={`/api/participant-auth/tickets/${encodeURIComponent(ticket.ticketCode)}/pdf`}
              target="_blank"
              icon={<Printer className="h-4 w-4" />}
            >
              Tải thẻ PDF
            </Button>
          ) : null}
        </div>

        <div className="ticket-page-controls ticket-status-panel">
          <ToastNotice
            showIcon
            type={ticket.isValid ? 'success' : ticket.status === 'REJECTED' ? 'error' : 'warning'}
            icon={ticket.isValid ? <CheckCircle2 className="h-5 w-5" /> : undefined}
            message={ticket.isValid ? 'Thẻ tham dự đã được phát hành' : status.label}
            description={ticket.isValid
              ? 'Hồ sơ đã được SportData duyệt. Thẻ này có thể dùng để check-in sự kiện.'
              : ticket.status === 'REJECTED' || ticket.status === 'CANCELLED'
                ? 'Hồ sơ không được phát hành thẻ. Vui lòng liên hệ ban tổ chức nếu cần hỗ trợ.'
                : 'Đây là trang theo dõi hồ sơ. Thẻ chỉ được phát hành sau khi hồ sơ được SportData duyệt.'}
          />
        </div>

        {!ticket.role && <PaymentCheckout ticket={ticket} onPaid={() => mutate()} />}

        {ticket.isValid ? (
          <div className="ticket-pass-stage">
            <EventParticipationCard ticket={ticket} />
          </div>
        ) : (
          <div className="ticket-pass-stage">
            <Card className="ticket-page-controls border-sky-500/20 text-center">
              <FileCheck2 className="mx-auto h-10 w-10 text-sky-400" />
              <h2 className="mt-3 text-lg font-bold">Thẻ chưa được phát hành</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
                Bạn có thể theo dõi trạng thái hồ sơ tại trang này. Khi hồ sơ được duyệt,
                thẻ sẽ xuất hiện tại đây và được gửi tới email đăng ký.
              </p>
            </Card>
          </div>
        )}

        {ticket.role ? <Card className="ticket-details mt-8" title="Thông tin tham gia sự kiện">
          <Descriptions column={1} colon={false}>
            <Descriptions.Item label="Họ và tên">{ticket.athlete.fullName}</Descriptions.Item>
            <Descriptions.Item label="Vai trò">{ticket.roleLabel}</Descriptions.Item>
            <Descriptions.Item label="Liên đoàn">{ticket.athlete.federation?.name || '—'}</Descriptions.Item>
            <Descriptions.Item label="Sự kiện">{ticket.event.name}</Descriptions.Item>
          </Descriptions>
        </Card> : <>
        <div className="ticket-details mt-8 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
          <Card title="Thông tin vận động viên" extra={<Tag color={status.color}>{status.label}</Tag>}>
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label="Họ và tên">{ticket.athlete.fullName}</Descriptions.Item>
              <Descriptions.Item label="Ngày sinh">{ticket.athlete.birthDate ? new Date(ticket.athlete.birthDate).toLocaleDateString('vi-VN') : '—'}</Descriptions.Item>
              <Descriptions.Item label="Giới tính">{genderLabels[ticket.athlete.gender || ''] || ticket.athlete.gender || '—'}</Descriptions.Item>
              <Descriptions.Item label="Quốc gia">{ticket.athlete.country?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Đơn vị / CLB">{ticket.athlete.federation?.name || 'Vận động viên tự do'}</Descriptions.Item>
              <Descriptions.Item label="Cân nặng hiện tại">{ticket.athlete.weight ? `${ticket.athlete.weight} kg` : '—'}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title={`Nội dung thi đấu (${categories.length})`}>
            <div className="space-y-5">
              {categories.map((category, index) => {
                const weightRange = [
                  category.minWeight != null ? `từ ${category.minWeight} kg` : '',
                  category.maxWeight != null ? `đến ${category.maxWeight} kg` : '',
                ].filter(Boolean).join(' ');
                const sport = category.sport || ticket.sport;
                return (
                  <Descriptions key={category.id || index} column={1} size="small" colon={false}>
                    <Descriptions.Item label="Bộ môn">{sport?.name || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Hạng đấu">{category.name}</Descriptions.Item>
                    <Descriptions.Item label="Nội dung">{disciplineLabels[category.discipline || ''] || category.discipline || '—'}{category.discipline === 'NEWAZA' ? ` · ${category.uniform === 'NO_GI' ? 'No-Gi' : 'Gi'}` : ''}</Descriptions.Item>
                    <Descriptions.Item label="Giới tính hạng">{genderLabels[category.gender || ''] || category.gender || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Hạng cân">{weightRange || 'Không giới hạn'}</Descriptions.Item>
                    <Descriptions.Item label="Đai">{category.beltLevel || '—'}</Descriptions.Item>
                  </Descriptions>
                );
              })}
            </div>
          </Card>
        </div>

        <Card className="ticket-details mt-6" title="Thành tích thi đấu" extra={<Trophy className="h-5 w-5 text-amber-400" />}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Statistic title="Tổng số trận" value={career?.totalMatches || 0} prefix={<Swords className="h-4 w-4" />} />
            <Statistic title="Số trận thắng" value={career?.totalWins || 0} valueStyle={{ color: '#10b981' }} />
            <Statistic title="Thành tích tại sự kiện" value={eventPerformance?.totalWins || 0} suffix="trận thắng" />
            <Statistic title="Tổng huy chương" value={medalTotal(career)} prefix={<Medal className="h-4 w-4" />} valueStyle={{ color: '#f59e0b' }} />
          </div>
          <div className="mt-5 flex flex-wrap gap-3 text-sm">
            <Tag color="gold">Vàng: {career?.goldMedals || 0}</Tag>
            <Tag color="default">Bạc: {career?.silverMedals || 0}</Tag>
            <Tag color="orange">Đồng: {career?.bronzeMedals || 0}</Tag>
            <Tag>Hòa: {career?.totalDraws || 0}</Tag>
            <Tag color="red">Thua: {career?.totalLosses || 0}</Tag>
          </div>
        </Card>

        </>}
        <div className="ticket-page-controls mt-6 flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-slate-400">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
          <p>Trang xác thực chỉ công khai thông tin phục vụ thi đấu. Ảnh CCCD, hộ chiếu, email và số điện thoại không được hiển thị qua mã QR.</p>
        </div>
      </div>
    </main>
  );
}
