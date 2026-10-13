'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Button, Card, Input, Modal, Select, Table, Tag, Typography } from 'antd';
import { CheckCircle2, Eye, RefreshCw, TicketCheck, XCircle } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { CmsPageHeader } from '@/components/cms/CmsPageHeader';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { AthleteQuickViewModal } from '@/components/cms/AthleteQuickViewModal';
import { EventParticipationsTable } from '@/components/cms/EventParticipationsTable';

type Registration = {
  id: string;
  competitionEntry?: { status: string } | null;
  isPairPayer?: boolean;
  team?: { members: { athlete: { id: string; fullName: string } }[]; registrations: { status: string; paymentStatus: string }[] } | null;
  ticketCode: string;
  status: string;
  paymentStatus: string;
  feeAmount: number;
  currency: string;
  statusReason?: string | null;
  createdAt: string;
  event: { id: string; name: string };
  category: { name: string; sport?: { name: string } };
  athlete: {
    id: string;
    fullName: string;
    birthDate?: string;
    weight?: number;
    country: { code: string; name: string };
    federation?: { name: string };
    media: {
      type: 'AVATAR' | 'CCCD_FRONT' | 'CCCD_BACK' | 'PASSPORT';
      verificationStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
      verificationNote?: string | null;
    }[];
  };
  submission?: {
    type: 'INDIVIDUAL' | 'GROUP';
    contactName: string;
    contactEmail: string;
    contactPhone?: string;
    organizationName?: string;
    referenceCode: string;
  } | null;
};
type EventItem = { id: string; name: string };

export default function CmsRegistrationsPage() {
  const [eventId, setEventId] = useState('');
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('eventId');
    if (requested) setEventId(requested);
  }, []);
  const toast = useSportDataToast();
  const [pendingStatus, setPendingStatus] = useState<{ item: Registration; status: string }>();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string>();
  const { data: registrations = [], isLoading, mutate } = useSWR<Registration[]>(
    `/participant-auth/admin/registrations${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`,
    fetcher,
  );
  const { data: eventResponse } = useSWR<{ items: EventItem[] }>('/events?limit=200', fetcher);
  const events = useMemo(() => eventResponse?.items || [], [eventResponse]);

  const changeStatus = async () => {
    if (!pendingStatus || reason.trim().length < 3) return;
    setSaving(true);
    try {
      await api.patch(`/participant-auth/admin/registrations/${pendingStatus.item.id}/status`, { status: pendingStatus.status, reason: reason.trim() });
      await mutate();
      toast.success('Đã cập nhật trạng thái đăng ký.');
      setPendingStatus(undefined);
      setReason('');
    } catch (requestError: any) {
      toast.error(requestError.response?.data?.message || 'Không thể cập nhật trạng thái.');
    } finally {
      setSaving(false);
    }
  };

  const viewDocument = async (athleteId: string, type: string) => {
    try {
      const response = await api.get(`/participant-auth/admin/athletes/${athleteId}/media/${type}`, { responseType: 'blob', params: { variant: 'preview' } });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (requestError: any) {
      toast.error(requestError.response?.status === 404 ? 'Vận động viên chưa tải giấy tờ này.' : 'Không thể mở giấy tờ.');
    }
  };

  const verifyDocument = async (athleteId: string, type: string, status: 'VERIFIED' | 'REJECTED') => {
    try {
      await api.patch(`/participant-auth/admin/athletes/${athleteId}/media/${type}/verification`, {
        status,
        note: status === 'REJECTED' ? 'Giấy tờ không hợp lệ hoặc không đọc được. Vui lòng tải lại đúng giấy tờ.' : undefined,
      });
      await mutate();
      toast.success(status === 'VERIFIED' ? 'Đã xác thực giấy tờ.' : 'Đã từ chối giấy tờ.');
    } catch (requestError: any) {
      toast.error(requestError.response?.data?.message || 'Không thể cập nhật trạng thái xác thực.');
    }
  };

  return (
    <div>
      <CmsPageHeader
        title="Đăng ký tham gia sự kiện"
        description="Quản lý vai trò tham gia sự kiện, duyệt hồ sơ VĐV và đối chiếu giấy tờ thi đấu."
        icon={<TicketCheck className="h-6 w-6" />}
      />
      <Card className="cms-surface mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            className="min-w-72"
            size="large"
            placeholder="Tất cả sự kiện"
            value={eventId || undefined}
            onChange={(value) => setEventId(value || '')}
            options={events.map((event) => ({ value: event.id, label: event.name }))}
          />
          <Button size="large" icon={<RefreshCw className="h-4 w-4" />} onClick={() => mutate()}>Làm mới</Button>
          <Typography.Text type="secondary">{registrations.length} lượt đăng ký</Typography.Text>
        </div>
      </Card>
      <EventParticipationsTable eventId={eventId || undefined} />
      <Card className="cms-surface" title="Đăng ký VĐV thi đấu" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={registrations}
          scroll={{ x: 1500 }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          columns={[
            {
              title: 'Vận động viên',
              key: 'athlete',
              width: 240,
              render: (_, item) => (
                <div><Button type="link" className="h-auto !p-0 font-semibold" onClick={() => setSelectedAthleteId(item.athlete.id)}>{item.athlete.fullName}</Button><div className="text-xs text-slate-500">{item.athlete.country.code} · {item.athlete.federation?.name || 'VĐV tự do'} · {item.athlete.weight ? `${item.athlete.weight} kg` : 'chưa cân'}</div></div>
              ),
            },
            { title: 'Sự kiện', dataIndex: ['event', 'name'], width: 260 },
            {
              title: 'Thanh toán',
              key: 'payment',
              width: 170,
              render: (_, item) => <div><Tag color={item.paymentStatus === 'PAID' || item.paymentStatus === 'NOT_REQUIRED' ? 'success' : item.paymentStatus === 'FAILED' ? 'error' : 'processing'}>{{ NOT_REQUIRED: 'Miễn thanh toán', PENDING: 'Chờ thanh toán', PAID: 'Đã duyệt', FAILED: 'Thất bại' }[item.paymentStatus] || item.paymentStatus}</Tag>{item.feeAmount > 0 ? <div className="mt-1 text-xs tabular-nums">{new Intl.NumberFormat('vi-VN').format(item.feeAmount)} {item.currency}</div> : null}</div>,
            },
            {
              title: 'Hạng đấu',
              key: 'category',
              width: 220,
              render: (_, item) => <div>{item.category.sport?.name} · {item.category.name}{item.team && <div className="mt-2 rounded-lg bg-sky-50 p-2 text-xs text-sky-900">
                <strong>{item.team.members.map((member) => member.athlete.fullName).join(' / ')}</strong>
                <div>{item.isPairPayer ? 'Người khai báo · chịu lệ phí' : 'Đồng đội · không thu thêm phí'}</div>
                <Tag className="mt-1" color={item.competitionEntry?.status === 'VERIFIED' ? 'green' : 'orange'}>
                  {item.competitionEntry?.status === 'VERIFIED' ? 'Cặp đã xác nhận' : 'Cặp chưa đủ điều kiện'}
                </Tag></div>}</div>,
            },
            {
              title: 'Giấy tờ',
              key: 'documents',
              width: 360,
              render: (_, item) => {
                const mediaMap = new Map(item.athlete.media.map((media) => [media.type, media]));
                const documents = [
                  { type: 'CCCD_FRONT', label: 'CCCD trước' },
                  { type: 'CCCD_BACK', label: 'CCCD sau' },
                  { type: 'PASSPORT', label: 'Hộ chiếu' },
                ] as const;
                return (
                  <div className="space-y-2">
                    {documents.map(({ type, label }) => {
                      const media = mediaMap.get(type);
                      if (!media) return null;
                      return (
                        <div className="flex flex-wrap items-center gap-1" key={type}>
                          <Button size="small" icon={<Eye className="h-3 w-3" />} onClick={() => viewDocument(item.athlete.id, type)}>{label}</Button>
                          {media.verificationStatus === 'VERIFIED'
                            ? <Tag color="success">Đã xác thực</Tag>
                            : media.verificationStatus === 'REJECTED'
                              ? <Tag color="error">Từ chối</Tag>
                              : <Tag color="processing">Chờ xác thực</Tag>}
                          {media.verificationStatus !== 'VERIFIED' && (
                            <Button size="small" type="text" title="Xác thực" icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} onClick={() => verifyDocument(item.athlete.id, type, 'VERIFIED')} />
                          )}
                          {media.verificationStatus !== 'REJECTED' && (
                            <Button size="small" type="text" title="Từ chối" icon={<XCircle className="h-4 w-4 text-red-500" />} onClick={() => verifyDocument(item.athlete.id, type, 'REJECTED')} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              },
            },
            {
              title: 'Nguồn đăng ký',
              key: 'source',
              width: 230,
              render: (_, item) => item.submission ? (
                <div>
                  <Tag color={item.submission.type === 'GROUP' ? 'purple' : 'blue'}>{item.submission.type === 'GROUP' ? 'Danh sách' : 'Không tài khoản'}</Tag>
                  <div className="mt-1 text-xs">{item.submission.organizationName || item.submission.contactName}</div>
                  <div className="text-xs text-slate-500">{item.submission.referenceCode}</div>
                </div>
              ) : <Tag>Tài khoản SportData</Tag>,
            },
            {
              title: 'Thẻ',
              dataIndex: 'ticketCode',
              width: 190,
              render: (value) => <code>{value}</code>,
            },
            {
              title: 'Trạng thái',
              key: 'status',
              fixed: 'right',
              width: 180,
              render: (_, item) => {
                const mediaMap = new Map(item.athlete.media.map((media) => [media.type, media.verificationStatus]));
                const identityVerified = (
                  mediaMap.get('CCCD_FRONT') === 'VERIFIED'
                  && mediaMap.get('CCCD_BACK') === 'VERIFIED'
                ) || mediaMap.get('PASSPORT') === 'VERIFIED';
                return (
                  <Select
                    value={item.status}
                    className="w-full"
                    onChange={(status) => status !== item.status && setPendingStatus({ item, status })}
                    options={[
                      { value: 'SUBMITTED', label: 'Chờ duyệt' },
                      { value: 'CONFIRMED', label: identityVerified ? 'Đã xác nhận' : 'Cần xác thực giấy tờ', disabled: !identityVerified },
                      { value: 'REJECTED', label: 'Từ chối' },
                      { value: 'CANCELLED', label: 'Đã hủy' },
                    ]}
                  />
                );
              },
            },
          ]}
        />
      </Card>
      <Modal
        open={Boolean(pendingStatus)}
        title="Cập nhật trạng thái đăng ký"
        okText="Xác nhận thay đổi"
        cancelText="Hủy"
        confirmLoading={saving}
        okButtonProps={{ disabled: reason.trim().length < 3 }}
        onOk={() => void changeStatus()}
        onCancel={() => { if (!saving) { setPendingStatus(undefined); setReason(''); } }}
      >
        <p className="mb-3 text-sm text-slate-500">Mọi thay đổi trạng thái đều phải có lý do và được lưu lịch sử.</p>
        <Input.TextArea rows={4} showCount maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Nhập lý do (bắt buộc)" />
      </Modal>
      <AthleteQuickViewModal athleteId={selectedAthleteId} open={Boolean(selectedAthleteId)} onClose={() => setSelectedAthleteId(undefined)} />
    </div>
  );
}
