'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Alert, Button, Card, Empty, Grid, Input, Modal, Popconfirm, Select, Space, Statistic, Table, Tag, Tooltip, Typography, type TableProps } from 'antd';
import { CheckCircle2, Eye, FileCheck2, FileWarning, RefreshCw, Search, SlidersHorizontal, Trash2, UserCheck, UserCog, Users, XCircle } from 'lucide-react';
import { CmsPageHeader } from '@/components/cms/CmsPageHeader';
import { AccountAvatar, AccountProfileModal, ProfileCompletionTags, accountStatusLabel, type SportDataAccount } from '@/components/cms/SportDataAccountProfile';
import { api, fetcher } from '@/lib/api';
import { accountTypeLabel, sportDataAccountTypeOptions, type SportDataAccountType } from '@/lib/sportdata-account-types';
import { useSportDataToast } from '@/hooks/useSportDataToast';

type AccountList = {
  items: SportDataAccount[];
  total: number;
  page: number;
  limit: number;
  summary: { total: number; complete: number; incomplete: number; pending: number };
};
type Federation = { id: string; name: string; country?: { code: string } };
type AccountFilters = {
  accountType?: SportDataAccountType;
  verificationStatus?: SportDataAccount['verificationStatus'];
  federationId?: string;
  profileStatus?: 'COMPLETE' | 'INCOMPLETE';
  isActive?: 'true' | 'false';
};

const statusOptions = [
  { value: 'PENDING', label: 'Chờ duyệt' },
  { value: 'VERIFIED', label: 'Đã duyệt' },
  { value: 'REJECTED', label: 'Từ chối' },
];
const sortOptions = [
  { value: 'createdAt:desc', label: 'Đăng ký mới nhất' },
  { value: 'createdAt:asc', label: 'Đăng ký cũ nhất' },
  { value: 'displayName:asc', label: 'Tên A → Z' },
  { value: 'displayName:desc', label: 'Tên Z → A' },
];

export function AccountDirectory({ personnelOnly = false }: { personnelOnly?: boolean }) {
  const roleOptions = sportDataAccountTypeOptions.filter((option) => !personnelOnly || ['REFEREE', 'TEAM_LEADER', 'COACH'].includes(option.value));
  const screens = Grid.useBreakpoint();
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<AccountFilters>({});
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('createdAt:desc');
  const [editing, setEditing] = useState<SportDataAccount>();
  const [viewing, setViewing] = useState<SportDataAccount>();
  const [selectedType, setSelectedType] = useState<SportDataAccountType>();
  const [updating, setUpdating] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ ids?: string[]; all?: boolean; name?: string; count: number }>();
  const [deleting, setDeleting] = useState(false);
  const toast = useSportDataToast();

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(keyword.trim());
      setPage(1);
      setSelectedIds([]);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [keyword]);

  const queryKey = useMemo(() => {
    const [sortBy, sortOrder] = sort.split(':');
    const params = new URLSearchParams({ page: String(page), limit: String(limit), sortBy, sortOrder });
    if (search) params.set('search', search);
    if (personnelOnly) params.set('accountGroup', 'PERSONNEL');
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return `/participant-auth/admin/accounts?${params.toString()}`;
  }, [search, filters, page, limit, sort, personnelOnly]);

  const query = useSWR<AccountList>(queryKey, fetcher, { keepPreviousData: true });
  const federationsQuery = useSWR<Federation[]>('/federations', fetcher);
  const { data: currentUser } = useSWR<{ role?: string }>('/auth/profile', fetcher);
  const canReview = ['ADMIN', 'GAMES_ADMIN'].includes(currentUser?.role || '');
  const canDelete = personnelOnly && canReview;
  const personnelTotal = useSWR<AccountList>(canDelete ? '/participant-auth/admin/accounts?accountGroup=PERSONNEL&limit=1' : null, fetcher);
  const hasFilters = Boolean(keyword.trim() || Object.values(filters).some(Boolean));
  const summary = query.data?.summary;
  const viewingAccount = query.data?.items.find((item) => item.id === viewing?.id) || viewing;

  const changeFilter = <Key extends keyof AccountFilters>(key: Key, value: AccountFilters[Key]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setSelectedIds([]);
  };

  const resetFilters = () => {
    setKeyword('');
    setSearch('');
    setFilters({});
    setPage(1);
    setSelectedIds([]);
  };

  const refreshAccounts = async () => {
    const result = await query.mutate();
    if (result && page > Math.max(1, Math.ceil(result.total / limit))) setPage(Math.max(1, Math.ceil(result.total / limit)));
  };

  const updateStatus = async (account: SportDataAccount, status: SportDataAccount['verificationStatus']) => {
    setUpdating(account.id);
    try {
      await api.patch(`/participant-auth/admin/accounts/${account.id}/status`, { status });
      await refreshAccounts();
      toast.success(status === 'VERIFIED' ? 'Đã duyệt tài khoản SportData.' : 'Đã từ chối yêu cầu tài khoản.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể cập nhật tài khoản.');
    } finally {
      setUpdating(undefined);
    }
  };

  const deletePersonnel = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = deleteTarget.ids?.length === 1
        ? await api.delete(`/participant-auth/admin/accounts/personnel/${encodeURIComponent(deleteTarget.ids[0])}`)
        : await api.post('/participant-auth/admin/accounts/personnel/delete', deleteTarget.all ? { all: true } : { ids: deleteTarget.ids });
      setSelectedIds([]);
      setViewing(undefined);
      setEditing(undefined);
      setDeleteTarget(undefined);
      await Promise.all([refreshAccounts(), personnelTotal.mutate()]);
      toast.success(`Đã xóa ${response.data.deleted} tài khoản nhân sự.`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể xóa nhân sự.');
    } finally {
      setDeleting(false);
    }
  };

  const columns: TableProps<SportDataAccount>['columns'] = [
    {
      title: 'Tài khoản',
      key: 'account',
      width: 285,
      render: (_, row) => (
        <div className="flex items-center gap-3">
          <AccountAvatar account={row} />
          <div className="min-w-0">
            <Button type="link" className="!h-auto !max-w-full !whitespace-normal !p-0 !text-left !font-semibold" onClick={() => setViewing(row)}>{row.displayName}</Button>
            <Typography.Text type="secondary" className="!block break-all !text-xs">{row.email}</Typography.Text>
            {row.phone && <Typography.Text type="secondary" className="!block !text-xs">{row.phone}</Typography.Text>}
          </div>
        </div>
      ),
    },
    {
      title: 'Đơn vị',
      key: 'federation',
      width: 210,
      render: (_, row) => (
        <div>
          <strong>{row.federation?.name || 'Chưa liên kết đơn vị'}</strong>
          {row.federation?.country && <Typography.Text type="secondary" className="!mt-1 !block !text-xs">{row.federation.country.code} · {row.federation.country.name}</Typography.Text>}
          {row.representativePosition && <Typography.Text type="secondary" className="!mt-1 !block !text-xs">{row.representativePosition}</Typography.Text>}
        </div>
      ),
    },
    { title: 'Loại tài khoản', key: 'accountTypes', width: 160, render: (_, row) => <Space size={[0, 4]} wrap>{row.accountTypes.map((type) => <Tag key={type} color="blue">{accountTypeLabel(type)}</Tag>)}</Space> },
    { title: 'Ảnh & giấy tờ', key: 'profile', width: 205, render: (_, row) => <ProfileCompletionTags account={row} /> },
    {
      title: 'Duyệt tài khoản',
      key: 'status',
      width: 155,
      render: (_, row) => (
        <div className="space-y-1">
          <Tag color={row.verificationStatus === 'VERIFIED' ? 'success' : row.verificationStatus === 'REJECTED' ? 'error' : 'processing'}>{accountStatusLabel(row.verificationStatus)}</Tag>
          {!row.isActive && <div><Tag color="default">Đã ngừng hoạt động</Tag></div>}
        </div>
      ),
    },
    { title: 'Ngày đăng ký', dataIndex: 'createdAt', width: 125, render: (value: string) => new Date(value).toLocaleDateString('vi-VN') },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 165,
      fixed: screens.lg ? 'right' : undefined,
      render: (_, row) => (
        <Space size={[6, 6]} wrap>
          <Tooltip title="Xem hồ sơ"><Button size="small" aria-label="Xem hồ sơ" icon={<Eye className="h-4 w-4" />} onClick={() => setViewing(row)} /></Tooltip>
          {canReview && <>
            <Tooltip title="Đổi vai trò"><Button size="small" aria-label="Đổi vai trò" disabled={deleting} icon={<UserCog className="h-4 w-4" />} onClick={() => { setEditing(row); setSelectedType(row.accountTypes[0]); }} /></Tooltip>
            {row.verificationStatus !== 'VERIFIED' && (
              <Popconfirm title="Duyệt tài khoản SportData này?" description="Ảnh thẻ và giấy tờ được kiểm tra riêng khi đăng ký sự kiện." okText="Duyệt" cancelText="Hủy" onConfirm={() => void updateStatus(row, 'VERIFIED')}>
                <Tooltip title="Duyệt tài khoản"><Button size="small" type="primary" aria-label="Duyệt tài khoản" disabled={deleting} loading={updating === row.id} icon={<CheckCircle2 className="h-4 w-4" />} /></Tooltip>
              </Popconfirm>
            )}
            {row.verificationStatus !== 'REJECTED' && (
              <Popconfirm title="Từ chối yêu cầu tài khoản này?" okText="Từ chối" cancelText="Hủy" okButtonProps={{ danger: true }} onConfirm={() => void updateStatus(row, 'REJECTED')}>
                <Tooltip title="Từ chối"><Button size="small" danger aria-label="Từ chối" disabled={deleting} loading={updating === row.id} icon={<XCircle className="h-4 w-4" />} /></Tooltip>
              </Popconfirm>
            )}
          </>}
          {canDelete && <Tooltip title="Xóa nhân sự"><Button size="small" danger aria-label={`Xóa nhân sự ${row.displayName}`} disabled={deleting || Boolean(updating)} icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleteTarget({ ids: [row.id], name: row.displayName, count: 1 })} /></Tooltip>}
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <CmsPageHeader
        title={personnelOnly ? 'Trọng tài, trưởng đoàn & huấn luyện viên' : 'Tài khoản SportData'}
        description={personnelOnly ? 'Quản lý hồ sơ trọng tài, trưởng đoàn và huấn luyện viên; tìm kiếm, lọc và phê duyệt tài khoản.' : 'Tra cứu tài khoản, quản lý phê duyệt và kiểm tra ảnh thẻ, CCCD hoặc hộ chiếu trước khi tham gia sự kiện.'}
        icon={<UserCheck className="h-6 w-6" />}
        action={<Button icon={<RefreshCw className="h-4 w-4" />} loading={query.isValidating} onClick={() => void refreshAccounts()}>Làm mới</Button>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { title: 'Tài khoản phù hợp', value: summary?.total, icon: Users, color: 'text-sblue-400' },
          { title: 'Đủ ảnh & giấy tờ', value: summary?.complete, icon: FileCheck2, color: 'text-emerald-500' },
          { title: 'Thiếu hồ sơ bắt buộc', value: summary?.incomplete, icon: FileWarning, color: 'text-amber-500' },
          { title: 'Chờ duyệt tài khoản', value: summary?.pending, icon: UserCheck, color: 'text-sblue-400' },
        ].map(({ title, value, icon: Icon, color }) => (
          <Card key={title} className="cms-surface" styles={{ body: { padding: '18px 20px' } }}>
            <div className="flex items-start justify-between gap-2">
              <Statistic title={title} value={value ?? '—'} loading={query.isLoading} />
              <Icon className={`mt-1 h-5 w-5 shrink-0 ${color}`} />
            </div>
          </Card>
        ))}
      </div>

      <Card className="cms-toolbar">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="account-search" className="mb-2 block text-sm font-semibold">{personnelOnly ? 'Tìm nhân sự' : 'Tìm tài khoản'}</label>
              <Input id="account-search" size="large" allowClear maxLength={200} prefix={<Search className="mr-1 h-4 w-4 text-slate-400" />} placeholder="Nhập họ tên, email, số điện thoại hoặc tên đơn vị..." value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            </div>
            <Button size="large" disabled={!hasFilters} icon={<XCircle className="h-4 w-4" />} onClick={resetFilters}>Xóa bộ lọc</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div>
              <label htmlFor="account-type-filter" className="mb-1.5 block text-sm font-medium">{personnelOnly ? 'Vai trò' : 'Loại tài khoản'}</label>
              <Select id="account-type-filter" className="w-full" allowClear placeholder={personnelOnly ? 'Tất cả vai trò' : 'Tất cả loại tài khoản'} value={filters.accountType} onChange={(value) => changeFilter('accountType', value)} options={[...roleOptions]} />
            </div>
            <div>
              <label htmlFor="account-status-filter" className="mb-1.5 block text-sm font-medium">Duyệt tài khoản</label>
              <Select id="account-status-filter" className="w-full" allowClear placeholder="Tất cả trạng thái" value={filters.verificationStatus} onChange={(value) => changeFilter('verificationStatus', value)} options={statusOptions} />
            </div>
            <div>
              <label htmlFor="account-unit-filter" className="mb-1.5 block text-sm font-medium">Đơn vị</label>
              <Select id="account-unit-filter" className="w-full" allowClear showSearch optionFilterProp="label" placeholder="Tất cả đơn vị" loading={federationsQuery.isLoading} value={filters.federationId} onChange={(value) => changeFilter('federationId', value)} options={[{ value: 'none', label: 'Chưa liên kết đơn vị' }, ...(federationsQuery.data || []).map((unit) => ({ value: unit.id, label: `${unit.name}${unit.country?.code ? ` · ${unit.country.code}` : ''}` }))]} />
            </div>
            <div>
              <label htmlFor="account-profile-filter" className="mb-1.5 block text-sm font-medium">Ảnh & giấy tờ</label>
              <Select id="account-profile-filter" className="w-full" allowClear placeholder="Tất cả hồ sơ" value={filters.profileStatus} onChange={(value) => changeFilter('profileStatus', value)} options={[{ value: 'COMPLETE', label: 'Đủ ảnh & giấy tờ' }, { value: 'INCOMPLETE', label: 'Thiếu hồ sơ bắt buộc' }]} />
            </div>
            <div>
              <label htmlFor="account-active-filter" className="mb-1.5 block text-sm font-medium">Hoạt động</label>
              <Select id="account-active-filter" className="w-full" allowClear placeholder="Tất cả tài khoản" value={filters.isActive} onChange={(value) => changeFilter('isActive', value)} options={[{ value: 'true', label: 'Đang hoạt động' }, { value: 'false', label: 'Đã ngừng hoạt động' }]} />
            </div>
          </div>
          <Typography.Text type="secondary" className="!block !text-xs">Số liệu và danh sách cập nhật theo các bộ lọc đang chọn.</Typography.Text>
          {federationsQuery.error && <Alert type="warning" showIcon title="Chưa tải được danh sách đơn vị." action={<Button size="small" onClick={() => void federationsQuery.mutate()}>Thử lại</Button>} />}
        </div>
      </Card>

      <Card className="cms-surface cms-table">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-500/15 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2"><strong>{personnelOnly ? 'Danh sách nhân sự' : 'Danh sách tài khoản'}</strong><Tag>{query.data?.total ?? '—'} tài khoản</Tag>{hasFilters && <Tag color="blue">Đang lọc</Tag>}</div>
          <Select aria-label="Sắp xếp tài khoản" className="w-44" value={sort} onChange={(value) => { setSort(value); setPage(1); }} options={sortOptions} />
        </div>
        {canDelete && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-500/15 px-5 py-3">
          <Space wrap><Typography.Text type="secondary">Đã chọn {selectedIds.length} nhân sự</Typography.Text>
            {selectedIds.length > 0 && <Button type="link" onClick={() => setSelectedIds([])}>Bỏ chọn</Button>}
          </Space>
          <Space wrap>
            <Button danger icon={<Trash2 size={16} />} disabled={!selectedIds.length || deleting || Boolean(updating)} onClick={() => setDeleteTarget({ ids: [...selectedIds], count: selectedIds.length })}>Xóa đã chọn</Button>
            <Button danger icon={<Trash2 size={16} />} disabled={!personnelTotal.data?.total || deleting || Boolean(updating)} onClick={() => setDeleteTarget({ all: true, count: personnelTotal.data?.total || 0 })}>Xóa tất cả nhân sự</Button>
          </Space>
        </div>}
        {query.error && <div className="p-5"><Alert type="error" showIcon title="Không thể tải danh sách tài khoản." description="Vui lòng thử lại để tiếp tục tra cứu." action={<Button onClick={() => void refreshAccounts()}>Thử lại</Button>} /></div>}
        <Table
          rowKey="id"
          loading={query.isLoading || query.isValidating || keyword.trim() !== search}
          columns={columns}
          rowSelection={canDelete ? {
            selectedRowKeys: selectedIds,
            preserveSelectedRowKeys: true,
            onChange: (keys) => setSelectedIds(keys.map(String)),
            getCheckboxProps: () => ({ disabled: deleting }),
          } : undefined}
          dataSource={query.data?.items || []}
          scroll={{ x: 1325 }}
          locale={{ emptyText: query.error ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa tải được tài khoản" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={hasFilters ? 'Không có tài khoản phù hợp với tìm kiếm và bộ lọc.' : 'Chưa có tài khoản SportData.'}>{hasFilters && <Button icon={<SlidersHorizontal className="h-4 w-4" />} onClick={resetFilters}>Xóa bộ lọc</Button>}</Empty> }}
          pagination={{
            current: page,
            pageSize: limit,
            total: query.data?.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total, range) => `${range[0]}–${range[1]} / ${total} tài khoản`,
            onChange: (nextPage, nextLimit) => { setPage(nextLimit !== limit ? 1 : nextPage); setLimit(nextLimit); },
          }}
        />
      </Card>

      <AccountProfileModal account={viewingAccount} open={Boolean(viewingAccount)} onClose={() => setViewing(undefined)} />

      <Modal open={Boolean(deleteTarget)} title={deleteTarget?.all ? 'Xóa tất cả nhân sự?' : `Xóa ${deleteTarget?.count || 0} nhân sự?`}
        okText="Xóa nhân sự" cancelText="Hủy" okButtonProps={{ danger: true }} confirmLoading={deleting}
        onCancel={() => { if (!deleting) setDeleteTarget(undefined); }} onOk={() => void deletePersonnel()}>
        <p className="mb-3">{deleteTarget?.name ? `Xóa tài khoản của ${deleteTarget.name}?` : `Bạn sắp xóa ${deleteTarget?.count || 0} tài khoản nhân sự.`}</p>
        {deleteTarget?.all && <Alert className="mb-3" type="warning" showIcon title="Xóa toàn bộ Trọng tài, Trưởng đoàn và Huấn luyện viên ở tất cả các trang, kể cả hồ sơ nằm ngoài bộ lọc đang chọn." />}
        <p>Tài khoản đã xóa không thể đăng nhập và không thể hoàn tác. Hồ sơ thi đấu và đăng ký sự kiện đã có vẫn được giữ lại.</p>
      </Modal>

      <Modal open={Boolean(editing)} title="Loại tài khoản SportData" onCancel={() => { if (!updating) setEditing(undefined); }} okText="Lưu" cancelText="Hủy" confirmLoading={Boolean(updating)} okButtonProps={{ disabled: !selectedType }} onOk={async () => {
        if (!editing || !selectedType) return;
        setUpdating(editing.id);
        try {
          await api.patch(`/participant-auth/admin/accounts/${editing.id}/types`, { accountTypes: [selectedType] });
          await refreshAccounts();
          setEditing(undefined);
          toast.success('Đã cập nhật loại tài khoản.');
        } catch (error: any) {
          toast.error(error.response?.data?.message || 'Không thể cập nhật loại tài khoản.');
        } finally {
          setUpdating(undefined);
        }
      }}>
        <p className="mb-4">Mỗi tài khoản chỉ được chọn một loại.</p>
        <Select className="w-full" value={selectedType} onChange={setSelectedType} options={[...roleOptions]} />
      </Modal>
    </div>
  );
}
