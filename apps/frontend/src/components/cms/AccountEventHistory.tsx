'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Alert, Button, Empty, Select, Space, Table, Tag, Typography, type TableProps } from 'antd';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { fetcher } from '@/lib/api';
import { accountTypeLabel } from '@/lib/sportdata-account-types';

type HistoryEntry = {
  id: string; role: string; status: string; referenceCode: string; createdAt: string;
  federationName: string | null; categoryName?: string; athleteName?: string;
};
type HistoryItem = {
  event: { id: string; name: string; startDate: string; endDate: string; location?: string | null };
  entries: HistoryEntry[];
};
const statusLabels: Record<string, { label: string; color: string }> = {
  SUBMITTED: { label: 'Chờ duyệt', color: 'processing' },
  CONFIRMED: { label: 'Đã duyệt', color: 'success' },
  REJECTED: { label: 'Từ chối', color: 'error' },
  CANCELLED: { label: 'Đã hủy', color: 'default' },
};
const roleLabel = (role: string) => role === 'REGISTRANT' ? 'Người đăng ký VĐV' : role === 'ATTENDEE' ? 'Người tham dự' : accountTypeLabel(role);
const localDay = (value: string | Date) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
const date = (value: string) => new Date(value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
function phase(event: HistoryItem['event']) {
  const today = localDay(new Date());
  if (localDay(event.endDate) < today) return { value: 'past', label: 'Đã kết thúc', color: 'default' };
  if (localDay(event.startDate) > today) return { value: 'upcoming', label: 'Sắp diễn ra', color: 'blue' };
  return { value: 'ongoing', label: 'Đang diễn ra', color: 'success' };
}

export function AccountEventHistory({ accountId, open }: { accountId: string; open: boolean }) {
  const [filter, setFilter] = useState<string>();
  const query = useSWR<{ items: HistoryItem[]; total: number }>(
    open ? `/participant-auth/admin/accounts/${encodeURIComponent(accountId)}/events` : null, fetcher,
  );
  const items = (query.data?.items || []).filter((item) => !filter || phase(item.event).value === filter);
  const columns: TableProps<HistoryItem>['columns'] = [
    { title: 'Sự kiện', key: 'event', width: 250, render: (_, row) => <div>
      <Typography.Text strong>{row.event.name}</Typography.Text>
      {row.event.location && <Typography.Text type="secondary" className="block text-xs">{row.event.location}</Typography.Text>}
    </div> },
    { title: 'Thời gian', key: 'dates', width: 155, render: (_, row) => <div>
      <span>{date(row.event.startDate)}{localDay(row.event.startDate) !== localDay(row.event.endDate) && <> – {date(row.event.endDate)}</>}</span>
      <div><Tag color={phase(row.event).color}>{phase(row.event).label}</Tag></div>
    </div> },
    { title: 'Vai trò', key: 'roles', width: 155, render: (_, row) => <Space size={[0, 4]} wrap>{[...new Set(row.entries.map((entry) => entry.role))].map((role) => <Tag key={role} color="blue">{roleLabel(role)}</Tag>)}</Space> },
    { title: 'Đăng ký', key: 'status', width: 125, render: (_, row) => <Space size={[0, 4]} wrap>{[...new Set(row.entries.map((entry) => entry.status))].map((status) => <Tag key={status} color={statusLabels[status]?.color}>{statusLabels[status]?.label || status}</Tag>)}</Space> },
    { title: '', key: 'view', width: 55, render: (_, row) => <Button type="text" href={`/cms/events/${row.event.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Xem sự kiện ${row.event.name}`} title="Xem sự kiện" icon={<ExternalLink size={16} />} /> },
  ];
  return <section aria-label="Lịch sử tham gia sự kiện">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <Typography.Title level={5} className="!mb-0">Lịch sử tham gia sự kiện <Tag>{query.data?.total ?? '—'}</Tag></Typography.Title>
      <Select allowClear aria-label="Lọc thời gian tham gia" placeholder="Tất cả sự kiện" value={filter} onChange={setFilter} className="w-44" options={[
        { value: 'ongoing', label: 'Đang diễn ra' }, { value: 'past', label: 'Đã kết thúc' }, { value: 'upcoming', label: 'Sắp diễn ra' },
      ]} />
    </div>
    {query.error ? <Alert type="error" showIcon title="Không thể tải lịch sử tham gia." action={<Button icon={<RefreshCw size={16} />} onClick={() => void query.mutate()}>Thử lại</Button>} /> : <Table<HistoryItem>
      size="small" bordered rowKey={(row) => row.event.id} columns={columns} dataSource={items} loading={query.isLoading}
      scroll={{ x: 740 }} pagination={{ pageSize: 5, showSizeChanger: false, hideOnSinglePage: true }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filter ? 'Không có sự kiện phù hợp với bộ lọc.' : 'Chưa có lịch sử tham gia sự kiện.'} /> }}
      expandable={{ expandedRowRender: (row) => <div className="space-y-3">{row.entries.map((entry) => <div key={entry.id}>
        <Space wrap size={[8, 4]}><strong>{roleLabel(entry.role)}</strong><Tag color={statusLabels[entry.status]?.color}>{statusLabels[entry.status]?.label || entry.status}</Tag><Typography.Text type="secondary">Đăng ký {date(entry.createdAt)}</Typography.Text></Space>
        {(entry.athleteName || entry.categoryName) && <div>{[entry.athleteName, entry.categoryName].filter(Boolean).join(' · ')}</div>}
        {entry.federationName && <div>Đơn vị: {entry.federationName}</div>}
        <Typography.Text type="secondary">Mã hồ sơ / thẻ: {entry.referenceCode}</Typography.Text>
      </div>)}</div> }}
    />}
  </section>;
}
