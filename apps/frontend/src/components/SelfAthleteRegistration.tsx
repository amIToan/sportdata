'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Select, Spin } from 'antd';
import useSWR from 'swr';
import { participantApi, participantError } from '@/lib/participant-auth';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { ParticipationTicketActions } from './ParticipationTicketActions';

export function SelfAthleteRegistration({ eventId, categories, open, onMore }: {
  eventId: string; categories: { id: string; name: string; discipline?: string | null; sport?: { name: string } | null }[];
  open: boolean; onMore: () => void;
}) {
  const [categoryId, setCategoryId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const toast = useSportDataToast();
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<{ registered: boolean; registration?: { ticketCode: string; status: string; category: { name: string } } | null }>(
    `/participant-auth/registrations/state?eventId=${encodeURIComponent(eventId)}`,
    (url: string) => participantApi.get(url).then((response) => response.data),
  );
  const submit = async () => {
    if (!categoryId) { toast.error('Vui lòng chọn hạng đấu.'); return; }
    if (['DUO', 'SHOW'].includes(categories.find((item) => item.id === categoryId)?.discipline || '')) { onMore(); return; }
    setSaving(true);
    try {
      const { data: result } = await participantApi.post('/participant-auth/registrations', { eventId, categoryId });
      toast.success(result.status === 'CONFIRMED' ? 'Đăng ký đã được xác nhận. Vé đã sẵn sàng.' : 'Đã gửi hồ sơ. Vé được phát hành sau khi hồ sơ được duyệt.');
      await mutate();
      if (result.paymentStatus === 'PENDING' && result.feeAmount > 0) router.push(`/tickets/${encodeURIComponent(result.ticketCode)}?payment=1`);
    } catch (requestError) { toast.error(participantError(requestError, 'Không thể đăng ký')); }
    finally { setSaving(false); }
  };
  return <Card title="Đăng ký bằng hồ sơ VĐV của tôi">
    {isLoading ? <Spin /> : error ? <div><p>Không thể kiểm tra hồ sơ đăng ký của bạn.</p><Button onClick={() => void mutate()}>Thử lại</Button></div>
      : data?.registered && data.registration ? <div className="space-y-4"><p>Bạn đã đăng ký: <strong>{data.registration.category.name}</strong>.</p><ParticipationTicketActions code={data.registration.ticketCode} status={data.registration.status} /><Button onClick={onMore}>Đăng ký thêm nội dung</Button></div>
        : <><p className="registration-muted mb-5">Thông tin và giấy tờ được lấy từ hồ sơ VĐV đã liên kết với tài khoản của bạn.</p><div className="grid items-end gap-4 sm:grid-cols-[1fr_auto]"><div><label htmlFor="self-athlete-category" className="mb-2 block font-semibold">Hạng đấu / nội dung *</label><Select id="self-athlete-category" className="w-full" size="large" showSearch optionFilterProp="label" value={categoryId} onChange={setCategoryId} placeholder="Chọn hạng đấu phù hợp" options={categories.map((item) => ({ value: item.id, label: `${item.sport?.name ? `${item.sport.name} · ` : ''}${item.name}` }))} /></div><Button type="primary" size="large" disabled={!open || !data || !categoryId} loading={saving} onClick={() => void submit()}>{['DUO', 'SHOW'].includes(categories.find((item) => item.id === categoryId)?.discipline || '') ? 'Khai báo cặp thi đấu' : 'Gửi đăng ký của tôi'}</Button></div></>}
  </Card>;
}
