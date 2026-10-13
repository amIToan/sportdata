'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Button, Card, Image, Input, Modal, Select, Spin, Table, Tag } from 'antd';
import { api, fetcher } from '@/lib/api';
import { ParticipationTicketActions } from '../ParticipationTicketActions';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { eventRoleLabel, eventRoleOptions, participationStatusLabels, type EventParticipation } from '@/lib/event-participation';

const mediaLabels: Record<string, string> = { AVATAR: 'Ảnh thẻ', CCCD_FRONT: 'Căn cước mặt trước', CCCD_BACK: 'Căn cước mặt sau', PASSPORT: 'Hộ chiếu' };

function ParticipationMediaPreview({ id, media }: { id: string; media: NonNullable<EventParticipation['media']>[number] }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setUrl(undefined); setFailed(false);
    void api.get(`/participant-auth/admin/event-participations/${id}/media/${media.type}`, {
      responseType: 'blob', params: { variant: 'preview' }, signal: controller.signal,
    }).then(({ data }) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(data);
      setUrl(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, media.type]);
  return <div className="rounded border border-slate-700 p-3">
    <p className="mb-2 font-medium">{mediaLabels[media.type]}</p>
    {media.verificationStatus && <Tag className="mb-2" color={media.verificationStatus === 'VERIFIED' ? 'success' : 'warning'}>
      {media.verificationStatus === 'VERIFIED' ? 'Giấy tờ đã duyệt' : 'Giấy tờ chờ duyệt'}
    </Tag>}
    {failed ? <p>Không thể tải tệp.</p> : !url ? <Spin /> : media.mimeType === 'application/pdf'
      ? <iframe src={url} title={mediaLabels[media.type]} className="h-64 w-full bg-white" />
      : <Image src={url} alt={mediaLabels[media.type]} style={{ maxHeight: 240, objectFit: 'contain' }} />}
  </div>;
}

export function EventParticipationsTable({ eventId }: { eventId?: string }) {
  const { data = [], isLoading, mutate, error } = useSWR<EventParticipation[]>(`/participant-auth/admin/event-participations${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`, fetcher);
  const { data: user } = useSWR<{ role?: string }>('/auth/profile', fetcher);
  const [review, setReview] = useState<EventParticipation>();
  const [status, setStatus] = useState('CONFIRMED');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useSportDataToast();
  const canReview = ['ADMIN', 'GAMES_ADMIN'].includes(user?.role || '');
  const save = async () => {
    if (!review || reason.trim().length < 2) return;
    setSaving(true);
    try {
      await api.patch(`/participant-auth/admin/event-participations/${review.id}/status`, { status, reason: reason.trim() });
      await mutate();
      setReview(undefined);
      toast.success('Đã cập nhật hồ sơ tham gia sự kiện.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể cập nhật hồ sơ');
    } finally { setSaving(false); }
  };

  return (
    <Card className="mb-6" title="Đăng ký tham gia theo vai trò" extra={<Button onClick={() => void mutate()}>Làm mới</Button>}>
      {error && <p className="mb-4 text-red-400">Không thể tải hồ sơ tham gia. Vui lòng thử lại.</p>}
      <Table<EventParticipation> rowKey="id" loading={isLoading} dataSource={data} scroll={{ x: 1000 }} pagination={{ pageSize: 10 }} columns={[
        { title: 'Người tham gia', key: 'contact', render: (_, row) => <div><strong>{row.contactName}</strong><p className="text-xs text-slate-500">{row.contactEmail} · {row.contactPhone || '—'}</p></div> },
        { title: 'Sự kiện', key: 'event', render: (_, row) => row.event.name },
        { title: 'Vai trò', key: 'role', filters: eventRoleOptions.filter((item) => item.value !== 'ATHLETE').map((item) => ({ text: item.label, value: item.value })), onFilter: (value, row) => row.role === value, render: (_, row) => <Tag color="blue">{eventRoleLabel(row.role)}</Tag> },
        { title: 'Đơn vị / CLB', key: 'federation', render: (_, row) => row.federation?.name || '—' },
        { title: 'Giấy tờ', key: 'document', render: (_, row) => row.documentNumber ? `${row.identityType === 'CCCD' ? 'CCCD' : 'Hộ chiếu'} · ${row.documentNumber}` : '—' },
        { title: 'Mã hồ sơ', dataIndex: 'referenceCode' },
        { title: 'Trạng thái', dataIndex: 'status', render: (value: string) => <Tag color={value === 'CONFIRMED' ? 'success' : value === 'REJECTED' ? 'error' : 'default'}>{participationStatusLabels[value]}</Tag> },
        { title: 'Thao tác', key: 'actions', render: (_, row) => <div className="flex flex-wrap gap-2"><ParticipationTicketActions code={row.referenceCode} status={row.status} /><Button size="small" onClick={() => { setReview(row); setStatus(row.status === 'SUBMITTED' ? 'CONFIRMED' : row.status); setReason(''); }}>{canReview ? 'Xét duyệt' : 'Xem hồ sơ'}</Button></div> },
      ]} />
      <Modal open={Boolean(review)} title={`Hồ sơ · ${review?.contactName || ''}`} width={760} okText="Lưu" cancelText="Hủy" onCancel={() => setReview(undefined)} onOk={() => void save()} confirmLoading={saving} okButtonProps={{ disabled: reason.trim().length < 2 }} footer={canReview ? undefined : null}>
        <p className="mb-3">{review ? eventRoleLabel(review.role) : ''} · {review?.event.name}</p>
        <p className="mb-3">Đơn vị / CLB: {review?.federation?.name || '—'}</p>
        <p className="mb-4">{review?.identityType === 'PASSPORT' ? 'Số hộ chiếu' : 'Số căn cước'}: {review?.documentNumber || '—'}</p>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">{review?.media?.map((media) => <ParticipationMediaPreview key={`${review.id}-${media.type}`} id={review.id} media={media} />)}</div>
        {canReview && <>
          <Select className="mb-4 w-full" value={status} onChange={setStatus} options={Object.entries(participationStatusLabels).map(([value, label]) => ({ value, label }))} />
          <Input.TextArea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} placeholder="Lý do cập nhật trạng thái (bắt buộc)" />
        </>}
      </Modal>
    </Card>
  );
}
