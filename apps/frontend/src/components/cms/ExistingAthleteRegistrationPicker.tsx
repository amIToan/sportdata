'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import { Button, Input, Select, Table, Tag } from 'antd';
import { fetcher } from '@/lib/api';
import { ToastNotice } from '@/components/ToastNotice';

type Athlete = {
  id: string;
  fullName: string;
  gender?: string;
  birthDate?: string;
  weight?: number | null;
  federation?: { name: string } | null;
};

export type SelectedRegistrationAthlete = Athlete & { categoryId?: string };
export type BatchRegistrationResult = {
  athleteId: string;
  fullName: string;
  status: 'success' | 'eligible' | 'error';
  message: string;
};

type Props = {
  federations: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; sport?: { name: string } }>;
  defaultCategoryId?: string;
  selected: SelectedRegistrationAthlete[];
  onChange: (selected: SelectedRegistrationAthlete[]) => void;
  disabled: boolean;
  results: BatchRegistrationResult[];
};

export function ExistingAthleteRegistrationPicker({ federations, categories, defaultCategoryId, selected, onChange, disabled, results }: Props) {
  const [federationId, setFederationId] = useState<string>();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (federationId) params.set('federationId', federationId);
  if (debouncedSearch) params.set('search', debouncedSearch);
  const { data, error, isLoading, mutate } = useSWR<{ items: Athlete[]; total: number }>(`/athletes?${params}`, fetcher);
  const items = data?.items || [];
  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: `${category.sport?.name ? `${category.sport.name} · ` : ''}${category.name}`,
  }));
  const successfulIds = new Set(results.filter((result) => result.status === 'success').map((result) => result.athleteId));

  return (
    <div className="mb-5 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="registration-federation" className="mb-1 block">Lọc theo đơn vị</label>
          <Select
            id="registration-federation"
            className="w-full"
            showSearch
            allowClear
            disabled={disabled}
            optionFilterProp="label"
            placeholder="Tất cả đơn vị"
            value={federationId}
            options={federations.map((federation) => ({ value: federation.id, label: federation.name }))}
            onChange={(value) => { setFederationId(value); setPage(1); }}
          />
        </div>
        <div>
          <label htmlFor="registration-athlete-search" className="mb-1 block">Tìm VĐV trong danh sách</label>
          <Input id="registration-athlete-search" value={search} disabled={disabled} allowClear placeholder="Nhập họ tên VĐV" onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Đã chọn {selected.length} VĐV · lựa chọn được giữ khi đổi trang hoặc bộ lọc</span>
        <Button size="small" disabled={disabled || !selected.length} onClick={() => onChange([])}>Bỏ chọn tất cả</Button>
      </div>
      {error && <ToastNotice type="error" message="Không thể tải danh sách VĐV" description={<Button size="small" onClick={() => void mutate()}>Thử lại</Button>} />}
      <Table<Athlete>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={items}
        scroll={{ x: 780 }}
        pagination={{ current: page, pageSize: 20, total: data?.total || 0, showSizeChanger: false, onChange: setPage }}
        rowSelection={{
          selectedRowKeys: selected.map((athlete) => athlete.id),
          preserveSelectedRowKeys: true,
          getCheckboxProps: (athlete) => ({ disabled: disabled || successfulIds.has(athlete.id) }),
          onChange: (keys) => {
            const byId = new Map<string, SelectedRegistrationAthlete>([...items, ...selected].map((athlete) => [athlete.id, athlete]));
            onChange(keys.flatMap((key) => {
              const athlete = byId.get(String(key));
              return athlete ? [athlete] : [];
            }));
          },
        }}
        columns={[
          { title: 'Họ tên', dataIndex: 'fullName', render: (name, athlete) => <>{name}{successfulIds.has(athlete.id) && <Tag color="green">Đã thêm</Tag>}</> },
          { title: 'Đơn vị', render: (_, athlete) => athlete.federation?.name || 'VĐV tự do' },
          { title: 'Giới tính', dataIndex: 'gender', render: (gender: string) => ({ MALE: 'Nam', FEMALE: 'Nữ', MIXED: 'Khác / hỗn hợp' } as Record<string, string>)[gender] || '—' },
          { title: 'Ngày sinh', dataIndex: 'birthDate', render: (date) => date ? dayjs(date).format('DD/MM/YYYY') : '—' },
          { title: 'Cân nặng', dataIndex: 'weight', render: (weight) => weight == null ? '—' : `${weight} kg` },
        ]}
      />
      <p className="text-xs text-slate-500">Checkbox ở đầu bảng chọn tất cả VĐV trên trang hiện tại. Chọn hạng đấu chung ở trên hoặc chỉnh riêng từng VĐV bên dưới.</p>
      {selected.length > 0 && (
        <Table<SelectedRegistrationAthlete>
          rowKey="id"
          size="small"
          dataSource={selected}
          pagination={false}
          scroll={{ x: 620, y: 260 }}
          columns={[
            { title: 'VĐV đã chọn', dataIndex: 'fullName' },
            { title: 'Hạng đấu', width: 360, render: (_, athlete) => (
              <Select
                aria-label={`Hạng đấu của ${athlete.fullName}`}
                className="w-full"
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder="Chọn hạng đấu"
                value={athlete.categoryId || defaultCategoryId}
                options={categoryOptions}
                disabled={disabled}
                onChange={(categoryId) => onChange(selected.map((item) => item.id === athlete.id ? { ...item, categoryId } : item))}
              />
            ) },
            { title: '', render: (_, athlete) => <Button size="small" disabled={disabled} onClick={() => onChange(selected.filter((item) => item.id !== athlete.id))}>Bỏ chọn</Button> },
          ]}
        />
      )}
      {results.length > 0 && <div className="space-y-2" aria-live="polite">
        {results.map((result) => <div key={result.athleteId}>
          <Tag color={result.status === 'error' ? 'red' : 'green'}>{result.status === 'success' ? 'Đã thêm' : result.status === 'eligible' ? 'Đủ điều kiện' : 'Chưa thêm'}</Tag>
          <strong>{result.fullName}</strong> · {result.message}
        </div>)}
      </div>}
    </div>
  );
}
