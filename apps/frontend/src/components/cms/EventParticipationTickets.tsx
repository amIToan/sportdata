'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Alert, Button, Card, Empty, Input, Select, Space, Table, Tag, Typography, type TableProps } from 'antd';
import { RefreshCw, Search } from 'lucide-react';
import { ParticipationTicketActions } from '@/components/ParticipationTicketActions';
import { fetcher } from '@/lib/api';
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

export function EventParticipationTickets({ eventId }: { eventId: string }) {
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
      title: 'Thao tác', key: 'actions', width: 330,
      render: (_, item) => <div className="flex flex-wrap items-center gap-2">
        {item.status === 'CONFIRMED'
          ? <ParticipationTicketActions code={item.referenceCode} status={item.status} />
          : <><span className="text-sm text-slate-500">Chưa phát hành thẻ</span><Button size="small" href={profileHref}>Xem hồ sơ</Button></>}
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
        scroll={{ x: 1290 }}
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
    </Card>
  );
}
