'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, type TableProps } from 'antd';
import { CheckCircle2, Eye, RefreshCw, Search } from 'lucide-react';
import { ParticipationTicketActions } from '@/components/ParticipationTicketActions';
import { api, fetcher } from '@/lib/api';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { eventRoleLabel, participationStatusLabels, type EventParticipation } from '@/lib/event-participation';

const ticketRoleOptions = [
  { value: 'COACH', label: 'Huấn luyện viên' },
  { value: 'REFEREE', label: 'Trọng tài' },
  { value: 'TEAM_LEADER', label: 'Trưởng đoàn' },
];
const ticketRoles = new Set(ticketRoleOptions.map((item) => item.value));
const statusColors: Record<string, string> = {
  SUBMITTED: 'processing', CONFIRMED: 'success', REJECTED: 'error', CANCELLED: 'default',
};

function searchableText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

export function EventParticipationTickets({ eventId, canOperate = false }: { eventId: string; canOperate?: boolean }) {
  const toast = useSportDataToast();
  const [review, setReview] = useState<EventParticipation>();
  const [reason, setReason] = useState('CMS: Đã kiểm tra thông tin và giấy tờ');
  const [saving, setSaving] = useState(false);
  const query = useSWR<EventParticipation[]>(`/participant-auth/admin/event-participations?eventId=${encodeURIComponent(eventId)}`, fetcher);
  const [keyword, setKeyword] = useState('');
  const [role, setRole] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setKeyword('');
    setRole(undefined);
    setStatus(undefined);
    setPage(1);
  }, [eventId]);

  const participations = useMemo(() => (query.data || []).filter((item) => ticketRoles.has(item.role)), [query.data]);
  const filteredParticipations = useMemo(() => {
    const search = searchableText(keyword.trim());
    return participations.filter((item) => (!role || item.role === role)
      && (!status || item.status === status)
      && (!search || searchableText([item.contactName, item.referenceCode, item.contactEmail, item.federation?.name || ''].join(' ')).includes(search)));
  }, [participations, keyword, role, status]);
  const hasFilters = Boolean(keyword.trim() || role || status);
  const issuedCount = participations.filter((item) => item.status === 'CONFIRMED').length;
  const awaitingCount = participations.filter((item) => item.status === 'SUBMITTED').length;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filteredParticipations.length / pageSize)));
  const profileHref = `/cms/registrations?eventId=${encodeURIComponent(eventId)}`;
  const clearFilters = () => {
    setKeyword('');
    setRole(undefined);
    setStatus(undefined);
    setPage(1);
  };

  const columns: TableProps<EventParticipation>['columns'] = [
    {
      title: 'Người tham gia', key: 'contact', width: 240,
      render: (_, item) => <div><strong>{item.contactName}</strong><p className="mt-1 text-sm text-slate-500">{item.contactEmail}</p></div>,
    },
    { title: 'Vai trò', dataIndex: 'role', width: 160, render: (value: string) => <Tag color="blue">{eventRoleLabel(value)}</Tag> },
    { title: 'Đơn vị / CLB', key: 'federation', width: 200, render: (_, item) => item.federation?.name || 'Chưa khai báo' },
    { title: 'Trạng thái', dataIndex: 'status', width: 150, render: (value: string) => <Tag color={statusColors[value]}>{participationStatusLabels[value] || value}</Tag> },
    { title: 'Mã thẻ', dataIndex: 'referenceCode', width: 210, render: (value: string) => <span className="font-mono text-sm">{value}</span> },
    {
      title: 'Thao tác', key: 'actions', width: 130, fixed: 'right',
      render: (_, item) => <div className="flex items-center gap-1 whitespace-nowrap">
        {item.status === 'CONFIRMED'
          ? <ParticipationTicketActions compact code={item.referenceCode} status={item.status} />
          : <><Tooltip title="Xem hồ sơ"><Button size="small" aria-label="Xem hồ sơ" icon={<Eye size={16} />} href={profileHref} /></Tooltip>{canOperate && <Tooltip title="Duyệt & cấp vé"><Button size="small" type="primary" aria-label="Duyệt & cấp vé" icon={<CheckCircle2 size={16} />} onClick={() => setReview(item)} /></Tooltip>}</>}
      </div>,
    },
  ];

  return (
    <Card title="Thẻ tham gia sự kiện" extra={<Button icon={<RefreshCw className="h-4 w-4" />} loading={query.isValidating} onClick={() => void query.mutate()}>Làm mới</Button>}>
      <Typography.Paragraph type="secondary">
        Thẻ dành cho huấn luyện viên, trọng tài và trưởng đoàn. Hồ sơ đã xác nhận có thể xem, in và tải thẻ PDF theo mẫu của sự kiện.
      </Typography.Paragraph>
      <Space wrap className="mb-4">
        <Tag>Tổng hồ sơ: {query.isLoading ? '—' : participations.length}</Tag>
        <Tag color="success">Đã phát hành: {query.isLoading ? '—' : issuedCount}</Tag>
        <Tag color="processing">Chờ duyệt: {query.isLoading ? '—' : awaitingCount}</Tag>
      </Space>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          allowClear
          aria-label="Tìm thẻ tham gia sự kiện"
          placeholder="Tìm tên, mã thẻ, email hoặc đơn vị"
          prefix={<Search className="h-4 w-4 text-slate-400" />}
          value={keyword}
          onChange={(event) => { setKeyword(event.target.value); setPage(1); }}
          className="!w-full min-w-0 sm:!w-80"
        />
        <Select
          allowClear
          aria-label="Lọc theo vai trò"
          placeholder="Mọi vai trò"
          value={role}
          onChange={(value) => { setRole(value); setPage(1); }}
          options={ticketRoleOptions}
          className="!w-full sm:!w-48"
        />
        <Select
          allowClear
          aria-label="Lọc theo trạng thái thẻ"
          placeholder="Mọi trạng thái"
          value={status}
          onChange={(value) => { setStatus(value); setPage(1); }}
          options={Object.entries(participationStatusLabels).map(([value, label]) => ({ value, label }))}
          className="!w-full sm:!w-48"
        />
        {hasFilters && <Button onClick={clearFilters}>Xóa bộ lọc</Button>}
      </div>
      {query.error && <Alert
        type="error"
        showIcon
        title="Không thể tải danh sách thẻ tham gia sự kiện."
        action={<Button size="small" onClick={() => void query.mutate()}>Thử lại</Button>}
        className="mb-4"
      />}
      <Table<EventParticipation>
        rowKey="id"
        loading={query.isLoading}
        columns={columns}
        dataSource={filteredParticipations}
        scroll={{ x: 1090 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query.error ? 'Danh sách chưa tải được.' : hasFilters ? 'Không có hồ sơ phù hợp với bộ lọc.' : 'Chưa có huấn luyện viên, trọng tài hoặc trưởng đoàn đăng ký sự kiện.'} /> }}
        pagination={{
          current: currentPage,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          showTotal: (total) => `${total} hồ sơ${hasFilters ? ` / ${participations.length} hồ sơ` : ''}`,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPageSize === pageSize ? nextPage : 1);
            setPageSize(nextPageSize);
          },
        }}
      />
      <Modal title="Duyệt hồ sơ và cấp vé" open={Boolean(review)} onCancel={() => { if (!saving) setReview(undefined); }} confirmLoading={saving} okText="Duyệt & cấp vé" cancelText="Hủy" okButtonProps={{ disabled: reason.trim().length < 2 }} onOk={async () => {
        if (!review) return;
        setSaving(true);
        try {
          await api.patch(`/participant-auth/admin/event-participations/${review.id}/status`, { status: 'CONFIRMED', reason });
          await query.mutate(); setReview(undefined); toast.success('Đã duyệt và cấp vé; email được đưa vào hàng đợi gửi.');
        } catch (error: any) { toast.error(error.response?.data?.message || 'Không thể duyệt hồ sơ'); }
        finally { setSaving(false); }
      }}>
        <p className="mb-3">{review?.contactName} · {review && eventRoleLabel(review.role)}</p>
        <p className="mb-3">Kiểm tra hồ sơ trước khi duyệt. Hệ thống yêu cầu đủ ảnh thẻ và giấy tờ định danh.</p>
        <Input.TextArea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} aria-label="Lý do duyệt" />
      </Modal>
    </Card>
  );
}
