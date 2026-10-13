'use client';

import { imageUrl } from '@/lib/image-url';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Flex,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableProps,
} from 'antd';
import { Pencil, Search, Trash2, UserRound } from 'lucide-react';
import { CmsPageHeader } from '@/components/cms/CmsPageHeader';
import { api, fetcher } from '@/lib/api';
import { useSportDataToast } from '@/hooks/useSportDataToast';

const genderLabels: Record<string, string> = {
  MALE: 'Nam',
  FEMALE: 'Nữ',
  MIXED: 'Hỗn hợp',
};

type AthleteFilters = { search?: string; gender?: string };
type AllMatchingSelection = {
  mode: 'ALL_MATCHING';
  filters: AthleteFilters;
  expectedCount: number;
  selectionToken: string;
};
type DeleteScope = AllMatchingSelection | { mode: 'SELECTED'; ids: string[]; names: Record<string, string> };
type BulkDeleteResult = {
  requestedCount: number;
  deletedCount: number;
  deletedIds: string[];
  deleted?: { id: string; fullName: string }[];
  failed: { id: string; fullName?: string; reason: string }[];
};

const pageSize = 10;
const maxSelectedAthletes = 1000;

function describeFilters(filters: AthleteFilters) {
  const descriptions = [];
  if (filters.search) descriptions.push(`Tìm kiếm: “${filters.search}”`);
  if (filters.gender) descriptions.push(`Giới tính: ${genderLabels[filters.gender] || filters.gender}`);
  return descriptions.length ? descriptions.join(' · ') : 'Không áp dụng bộ lọc: toàn bộ danh sách vận động viên.';
}

function requestErrorMessage(error: any, fallback: string) {
  const message = error.response?.data?.message;
  return Array.isArray(message) ? message.join(' ') : message || fallback;
}

export default function AthletesListPage() {
  const { data: currentUser } = useSWR<any>('/auth/profile', fetcher);
  const canManage = ['ADMIN', 'CONTENT', 'GAMES_ADMIN'].includes(currentUser?.role);
  const canDelete = ['ADMIN', 'GAMES_ADMIN'].includes(currentUser?.role);
  const [search, setSearch] = useState('');
  const [gender, setGender] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedNames, setSelectedNames] = useState<Record<string, string>>({});
  const [allSelection, setAllSelection] = useState<AllMatchingSelection>();
  const [selectingAll, setSelectingAll] = useState(false);
  const [deleteScope, setDeleteScope] = useState<DeleteScope>();
  const [deleting, setDeleting] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [deleteError, setDeleteError] = useState('');
  const [deleteResult, setDeleteResult] = useState<BulkDeleteResult>();
  const [resultOpen, setResultOpen] = useState(false);
  const toast = useSportDataToast();

  const filters = useMemo<AthleteFilters>(() => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(gender ? { gender } : {}),
  }), [search, gender]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize), ...filters });
    return `/athletes?${params}`;
  }, [filters, page]);

  const { data, error, isLoading, mutate } = useSWR<any>(query, fetcher);
  const athletes = data?.items || [];
  const total = data?.total || 0;
  const selectedCount = allSelection?.expectedCount ?? selectedIds.length;
  const busy = deleting || Boolean(deletingId) || selectingAll;
  const selectionChanged = Boolean(allSelection && data && total !== allSelection.expectedCount);

  useEffect(() => {
    if (error) toast.error('Không thể tải danh sách vận động viên.');
  }, [error, toast]);

  const clearSelection = () => {
    setSelectedIds([]);
    setSelectedNames({});
    setAllSelection(undefined);
  };

  const refreshList = async () => {
    const refreshed = await mutate();
    if (refreshed) setPage((current) => Math.min(current, Math.max(1, Math.ceil(refreshed.total / pageSize))));
  };

  const selectAllMatching = async () => {
    if (!canDelete || busy) return;
    setSelectingAll(true);
    try {
      const { data: preview } = await api.post<{ total: number; selectionToken: string }>('/athletes/bulk-delete/preview', { filters });
      clearSelection();
      if (preview.total > 0) {
        setAllSelection({ mode: 'ALL_MATCHING', filters: { ...filters }, expectedCount: preview.total, selectionToken: preview.selectionToken });
      } else {
        toast.info('Không có vận động viên phù hợp để chọn.');
      }
      await refreshList().catch(() => undefined);
    } catch (requestError: any) {
      toast.error(requestErrorMessage(requestError, 'Không thể chọn toàn bộ danh sách vận động viên.'));
    } finally {
      setSelectingAll(false);
    }
  };

  const openDeleteConfirmation = () => {
    if (!canDelete || busy || !selectedCount || selectionChanged || error) return;
    setDeleteError('');
    setDeleteScope(allSelection || { mode: 'SELECTED', ids: [...selectedIds], names: { ...selectedNames } });
  };

  const removeSelected = async () => {
    if (!deleteScope || !canDelete || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const body = deleteScope.mode === 'ALL_MATCHING'
        ? deleteScope
        : { mode: deleteScope.mode, ids: deleteScope.ids };
      const { data: result } = await api.post<BulkDeleteResult>('/athletes/bulk-delete', body);
      setDeleteResult({
        ...result,
        deleted: result.deleted || result.deletedIds.map((id) => ({
          id,
          fullName: deleteScope.mode === 'SELECTED' ? deleteScope.names[id] || id : id,
        })),
      });
      setResultOpen(true);
      setDeleteScope(undefined);
      clearSelection();
      if (result.failed.length) {
        toast.warning(`Đã xóa ${result.deletedCount}/${result.requestedCount} VĐV. ${result.failed.length} VĐV không thể xóa.`);
      } else {
        toast.success(`Đã xóa ${result.deletedCount} vận động viên.`);
      }
      await refreshList().catch(() => undefined);
    } catch (requestError: any) {
      const message = requestErrorMessage(requestError, 'Không thể xóa danh sách vận động viên. Vui lòng thử lại.');
      if (requestError.response?.status === 409 && deleteScope.mode === 'ALL_MATCHING') {
        clearSelection();
        setDeleteScope(undefined);
        toast.warning(message);
        await refreshList().catch(() => undefined);
      } else {
        setDeleteError(message);
      }
    } finally {
      setDeleting(false);
    }
  };

  const remove = async (id: string) => {
    if (!canDelete || busy) return;
    setDeletingId(id);
    try {
      await api.delete(`/athletes/${id}`);
      if (allSelection) clearSelection();
      else setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
      toast.success('Đã xóa vận động viên.');
      await refreshList().catch(() => undefined);
    } catch (requestError: any) {
      toast.error(requestErrorMessage(requestError, 'Không thể xóa vận động viên đang có dữ liệu thi đấu.'));
    } finally {
      setDeletingId(undefined);
    }
  };

  const rowSelection: TableProps<any>['rowSelection'] = canDelete ? {
    fixed: true,
    preserveSelectedRowKeys: true,
    selectedRowKeys: allSelection ? athletes.map((athlete: any) => athlete.id) : selectedIds,
    getCheckboxProps: (athlete) => ({
      disabled: busy || Boolean(allSelection),
      'aria-label': `Chọn vận động viên ${athlete.fullName}`,
    }),
    getTitleCheckboxProps: () => ({
      disabled: busy || Boolean(allSelection) || !athletes.length,
      'aria-label': 'Chọn tất cả vận động viên trên trang hiện tại',
    }),
    columnTitle: (checkbox) => <Tooltip title="Chọn VĐV trên trang hiện tại">{checkbox}</Tooltip>,
    onChange: (keys, rows) => {
      if (keys.length > maxSelectedAthletes) {
        toast.warning(`Chỉ chọn tối đa ${maxSelectedAthletes} VĐV riêng lẻ. Dùng “Chọn toàn bộ” để chọn cả danh sách.`);
        return;
      }
      setSelectedIds(keys.map(String));
      setSelectedNames((current) => ({ ...current, ...Object.fromEntries(rows.map((athlete) => [athlete.id, athlete.fullName])) }));
    },
  } : undefined;

  const resultRows = useMemo(() => deleteResult ? [
    ...deleteResult.failed.map((athlete) => ({ ...athlete, status: 'failed' })),
    ...(deleteResult.deleted || deleteResult.deletedIds.map((id) => ({ id, fullName: id })))
      .map((athlete) => ({ ...athlete, status: 'deleted', reason: '' })),
  ] : [], [deleteResult]);

  const columns: TableProps<any>['columns'] = [
    {
      title: 'Vận động viên',
      key: 'athlete',
      fixed: 'left',
      width: 260,
      render: (_, athlete) => (
        <Flex align="center" gap={12} className="w-full min-w-0">
          <Avatar
            size={44}
            src={imageUrl(athlete.photoUrl, 'avatar')}
            alt={athlete.fullName}
            icon={<UserRound className="h-5 w-5" />}
            className="!shrink-0 bg-sblue-500/20 text-sblue-300"
          />
          <div className="min-w-0 flex-1 overflow-hidden">
            <Tooltip title={athlete.fullName} placement="topLeft">
              <Typography.Text strong className="block max-w-full truncate">
                {athlete.fullName}
              </Typography.Text>
            </Tooltip>
            <Typography.Text type="secondary" className="text-xs">
              {genderLabels[athlete.gender] || 'Chưa xác định'}
            </Typography.Text>
          </div>
        </Flex>
      ),
    },
    {
      title: 'Quốc gia',
      key: 'country',
      width: 110,
      render: (_, athlete) => (
        <Tag className="inline-flex items-center gap-1.5">
          {athlete.country?.flagUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={athlete.country.flagUrl}
              alt={`Cờ ${athlete.country.name || athlete.country.code}`}
              className="h-3.5 w-5 shrink-0 rounded-sm object-cover"
            />
          )}
          {athlete.country?.code || '—'}
        </Tag>
      ),
    },
    {
      title: 'Đơn vị',
      key: 'federation',
      ellipsis: true,
      render: (_, athlete) => athlete.federation?.name || '—',
    },
    {
      title: 'Bộ môn',
      key: 'sports',
      width: 180,
      render: (_, athlete) => {
        const sports = Array.from(
          new Map(
            (athlete.categories || [])
              .filter((category: any) => category.sport)
              .map((category: any) => [category.sport.id, category.sport]),
          ).values(),
        ) as any[];

        return sports.length ? (
          <Space size={[4, 4]} wrap>
            {sports.map((sport: any) => <Tag key={sport.id} color="blue">{sport.name}</Tag>)}
          </Space>
        ) : 'Chưa chọn';
      },
    },
    {
      title: 'Hạng cân / hạng đấu',
      key: 'category',
      width: 260,
      render: (_, athlete) => athlete.categories?.length ? (
        <Space size={[4, 4]} wrap>
          {athlete.categories.map((category: any) => (
            <Tag key={category.id}>{category.name}</Tag>
          ))}
        </Space>
      ) : 'Chưa phân hạng',
    },
    {
      title: 'Thành tích',
      key: 'stats',
      width: 170,
      render: (_, athlete) => {
        const stats = athlete.statistics || [];
        const matches = stats.reduce(
          (sum: number, item: any) => sum + (item.totalMatches || 0),
          0,
        );
        const medals = stats.reduce(
          (sum: number, item: any) =>
            sum +
            (item.goldMedals || 0) +
            (item.silverMedals || 0) +
            (item.bronzeMedals || 0),
          0,
        );
        return (
          <Space size={6}>
            <Tag color="blue">{matches} trận</Tag>
            <Tag color="gold">{medals} HC</Tag>
          </Space>
        );
      },
    },
    {
      title: 'Thao tác',
      key: 'actions',
      align: 'right',
      fixed: 'right',
      width: 112,
      render: (_, athlete) => (
        <Space size={4}>
          {canManage && <Tooltip title="Chỉnh sửa">
            <Button
              type="text"
              href={`/cms/athletes/${athlete.id}/edit`}
              aria-label="Chỉnh sửa"
              icon={<Pencil className="h-4 w-4" />}
            />
          </Tooltip>}
          {canDelete && <Popconfirm
            title={`Xóa “${athlete.fullName}”?`}
            description="Thao tác này không thể hoàn tác."
            okText="Xóa"
            cancelText="Hủy"
            okButtonProps={{ danger: true }}
            disabled={busy}
            onConfirm={() => remove(athlete.id)}
          >
            <Tooltip title="Xóa">
              <Button
                type="text"
                danger
                disabled={busy}
                loading={deletingId === athlete.id}
                aria-label="Xóa"
                icon={<Trash2 className="h-4 w-4" />}
              />
            </Tooltip>
          </Popconfirm>}
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <CmsPageHeader
        title="Quản lý vận động viên"
        description="Tạo và cập nhật hồ sơ hiển thị trên trang người dùng."
        actionHref={canManage ? '/cms/athletes/new' : undefined}
        actionLabel={canManage ? 'Thêm VĐV' : undefined}
      />

      <Card className="cms-toolbar" styles={{ body: { padding: 16 } }}>
        <Flex gap={12} wrap>
          <Input
            allowClear
            size="large"
            prefix={<Search className="h-4 w-4 text-slate-500" />}
            placeholder="Tìm theo tên, email, số điện thoại..."
            value={search}
            disabled={busy}
            onChange={(event) => {
              clearSelection();
              setSearch(event.target.value);
              setPage(1);
            }}
            className="min-w-64 flex-1"
          />
          <Select
            size="large"
            className="w-full sm:w-48"
            value={gender}
            disabled={busy}
            onChange={(value) => {
              clearSelection();
              setGender(value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'Mọi giới tính' },
              { value: 'MALE', label: 'Nam' },
              { value: 'FEMALE', label: 'Nữ' },
              { value: 'MIXED', label: 'Hỗn hợp' },
            ]}
          />
        </Flex>
      </Card>

      {error && <Alert
        type="error"
        showIcon
        title="Không thể tải danh sách vận động viên."
        action={<Button onClick={() => void mutate()} disabled={busy}>Tải lại</Button>}
      />}

      <Card className="cms-table" variant="borderless">
        <Flex align="center" justify="space-between" gap={12} wrap className="border-b border-sdark-800 p-4">
          <Typography.Text type="secondary">{total.toLocaleString('vi-VN')} vận động viên</Typography.Text>
          <Space wrap>
            {deleteResult && <Button onClick={() => setResultOpen(true)}>Kết quả lần xóa gần nhất</Button>}
            {canDelete && <>
              <Button
                onClick={selectAllMatching}
                loading={selectingAll}
                disabled={busy || isLoading || Boolean(error) || !total}
              >
                Chọn toàn bộ {total.toLocaleString('vi-VN')} VĐV
              </Button>
              <Button
                danger
                icon={<Trash2 className="h-4 w-4" />}
                disabled={busy || !selectedCount || selectionChanged || Boolean(error)}
                onClick={openDeleteConfirmation}
              >
                Xóa {selectedCount ? selectedCount.toLocaleString('vi-VN') : ''} VĐV đã chọn
              </Button>
            </>}
          </Space>
        </Flex>
        {canDelete && selectedCount > 0 && <div className="px-4 pt-4">
          <Alert
            type={selectionChanged ? 'warning' : 'info'}
            showIcon
            title={allSelection
              ? `Đã chọn toàn bộ ${selectedCount.toLocaleString('vi-VN')} VĐV phù hợp trên tất cả các trang.`
              : `Đã chọn ${selectedCount.toLocaleString('vi-VN')} VĐV. Lựa chọn được giữ khi chuyển trang.`}
            description={selectionChanged
              ? 'Danh sách đã thay đổi. Hãy bấm “Chọn toàn bộ” lại để xác nhận phạm vi mới trước khi xóa.'
              : allSelection
                ? `${describeFilters(allSelection.filters)} Bỏ chọn toàn bộ để chọn riêng từng VĐV.`
                : undefined}
            action={<Button onClick={clearSelection} disabled={busy}>Bỏ chọn</Button>}
          />
        </div>}
        <Table
          rowKey="id"
          loading={isLoading || deleting}
          dataSource={athletes}
          columns={columns}
          pagination={false}
          rowSelection={rowSelection}
          scroll={{ x: canDelete ? 1290 : 1240 }}
          locale={{ emptyText: error ? 'Chưa tải được danh sách vận động viên.' : 'Không có vận động viên phù hợp.' }}
        />
        <Flex justify="flex-end" className="border-t border-sdark-800 p-4">
          <Pagination
            current={page}
            total={total}
            pageSize={pageSize}
            showSizeChanger={false}
            disabled={busy}
            onChange={setPage}
          />
        </Flex>
      </Card>

      <Modal
        open={Boolean(deleteScope)}
        title={deleteScope?.mode === 'ALL_MATCHING'
          ? `Xóa toàn bộ ${deleteScope.expectedCount.toLocaleString('vi-VN')} vận động viên?`
          : `Xóa ${deleteScope?.ids.length || 0} vận động viên đã chọn?`}
        onCancel={() => { if (!deleting) setDeleteScope(undefined); }}
        onOk={removeSelected}
        okText={deleteScope?.mode === 'ALL_MATCHING' ? 'Xóa toàn bộ' : 'Xóa VĐV đã chọn'}
        cancelText="Hủy"
        confirmLoading={deleting}
        okButtonProps={{ danger: true }}
        cancelButtonProps={{ disabled: deleting }}
        closable={!deleting}
        maskClosable={!deleting}
        keyboard={!deleting}
      >
        <Space orientation="vertical" size={16} className="w-full">
          <Alert
            type="warning"
            showIcon
            title="Thao tác này không thể hoàn tác."
            description="Hồ sơ, ảnh đại diện và giấy tờ của VĐV được xóa khỏi hệ thống. VĐV có dữ liệu thi đấu liên quan sẽ được giữ lại và báo lý do trong kết quả."
          />
          {deleteScope?.mode === 'ALL_MATCHING' ? <div>
            <Typography.Paragraph strong>Phạm vi: tất cả các trang của danh sách theo bộ lọc đã chọn.</Typography.Paragraph>
            <Typography.Paragraph>{describeFilters(deleteScope.filters)}</Typography.Paragraph>
          </div> : deleteScope && <div>
            <Typography.Paragraph>Phạm vi: {deleteScope.ids.length} VĐV đã chọn, kể cả ở các trang khác.</Typography.Paragraph>
            <Space size={[4, 8]} wrap>
              {deleteScope.ids.slice(0, 8).map((id) => <Tag key={id}>{deleteScope.names[id] || id}</Tag>)}
              {deleteScope.ids.length > 8 && <Tag>+{deleteScope.ids.length - 8} VĐV khác</Tag>}
            </Space>
          </div>}
          {deleteError && <Alert type="error" showIcon title={deleteError} />}
        </Space>
      </Modal>

      <Modal
        open={resultOpen}
        title="Kết quả xóa vận động viên"
        onCancel={() => setResultOpen(false)}
        footer={<Button type="primary" onClick={() => setResultOpen(false)}>Đóng</Button>}
        width={760}
      >
        <Space orientation="vertical" size={16} className="w-full">
          <Alert
            showIcon
            type={deleteResult?.failed.length ? 'warning' : 'success'}
            title={`Đã xóa ${deleteResult?.deletedCount || 0}/${deleteResult?.requestedCount || 0} VĐV.`}
            description={deleteResult?.failed.length ? `${deleteResult.failed.length} VĐV được giữ lại. Xem lý do trong danh sách bên dưới.` : undefined}
          />
          <Table
            rowKey="id"
            size="small"
            dataSource={resultRows}
            columns={[
              { title: 'Vận động viên', dataIndex: 'fullName', render: (name, row) => name || row.id },
              { title: 'Kết quả', dataIndex: 'status', width: 140, render: (status) => <Tag color={status === 'deleted' ? 'green' : 'red'}>{status === 'deleted' ? 'Đã xóa' : 'Không thể xóa'}</Tag> },
              { title: 'Lý do', dataIndex: 'reason', render: (reason) => reason || '—' },
            ]}
            pagination={{ pageSize, showSizeChanger: false }}
            scroll={{ x: 550 }}
          />
        </Space>
      </Modal>
    </div>
  );
}
