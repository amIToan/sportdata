'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Tooltip, Typography, type TableProps } from 'antd';
import { Dumbbell, Pencil, Plus, RotateCcw, Search, SlidersHorizontal, Tags, Trash2 } from 'lucide-react';
import { imageUrl } from '@/lib/image-url';

type Option = { value: string; label: string };
type Props = {
  sports: any[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  canManageSports: boolean;
  canManageCategories: boolean;
  canDeleteSport: boolean;
  canDeleteCategory: boolean;
  onEditSport: (sport?: any) => void;
  onEditCategory: (sport: any, category?: any) => void;
  onDeleteSport: (sport: any) => Promise<void>;
  onDeleteCategory: (category: any) => Promise<void>;
  onVisibility: (sport: any, visible: boolean) => Promise<void>;
  onSortOrder: (sport: any, sortOrder: number) => Promise<void>;
  options: { discipline: Option[]; uniform: Option[]; beltLevel: Option[]; format: Option[] };
};

const genders = [{ value: 'MALE', label: 'Nam' }, { value: 'FEMALE', label: 'Nữ' }, { value: 'MIXED', label: 'Hỗn hợp' }];
const normalize = (text: unknown) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const matches = (query: string, values: unknown[]) => {
  const text = normalize(values.join(' '));
  return normalize(query).trim().split(/\s+/).every((word) => text.includes(word));
};
const label = (options: Option[], value: string) => options.find((option) => option.value === value)?.label || value || '—';
const range = (min: number | null, max: number | null, unit: string) => {
  if (min == null && max == null) return 'Không giới hạn';
  if (min == null) return `Đến ${max} ${unit}`;
  if (max == null) return `Từ ${min} ${unit}`;
  return `${min}–${max} ${unit}`;
};

export function SportsCatalogTables(props: Props) {
  const { sports, options } = props;
  const [tab, setTab] = useState('sports');
  const [sportSearch, setSportSearch] = useState('');
  const [visibility, setVisibility] = useState<string>();
  const [categorySearch, setCategorySearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string | undefined>>({});
  const [advanced, setAdvanced] = useState(false);
  const [sportPage, setSportPage] = useState(1);
  const [categoryPage, setCategoryPage] = useState(1);
  const [sportPageSize, setSportPageSize] = useState(10);
  const [categoryPageSize, setCategoryPageSize] = useState(20);
  const [busySport, setBusySport] = useState<string>();
  const categories = useMemo(() => sports.flatMap((sport) => (sport.categories || []).map((category: any) => ({ ...category, sport }))), [sports]);
  const filteredSports = sports.filter((sport) => matches(sportSearch, [sport.name, sport.displayName, sport.code, sport.subtitle, sport.description]) &&
    (!visibility || (sport.isVisible !== false ? 'visible' : 'hidden') === visibility));
  const filteredCategories = categories.filter((category) =>
    Object.entries(filters).every(([key, value]) => !value || (key === 'sportId' ? category.sport.id : category[key]) === value) &&
    matches(categorySearch, [category.name, category.sport.name, category.sport.code,
      label(genders, category.gender), label(options.discipline, category.discipline),
      label(options.uniform, category.uniform), label(options.beltLevel, category.beltLevel),
      label(options.format, category.format), range(category.minAge, category.maxAge, 'tuổi'),
      range(category.minWeight, category.maxWeight, 'kg')]));
  const setFilter = (key: string, value?: string) => { setFilters((previous) => ({ ...previous, [key]: value })); setCategoryPage(1); };
  const viewCategories = (sport: any) => {
    setFilters({ sportId: sport.id }); setCategorySearch(''); setCategoryPage(1); setTab('categories');
  };
  const activeCount = Object.values(filters).filter(Boolean).length;
  const actions = (record: any, category = false) => (
    <Space size={2}>
      {(category ? props.canManageCategories : props.canManageSports) && <Tooltip title={category ? 'Sửa hạng đấu' : 'Sửa bộ môn'}>
        <Button type="text" aria-label={category ? `Sửa hạng đấu ${record.name}` : `Sửa bộ môn ${record.name}`} icon={<Pencil size={16} />}
          onClick={() => category ? props.onEditCategory(record.sport, record) : props.onEditSport(record)} />
      </Tooltip>}
      {(category ? props.canDeleteCategory : props.canDeleteSport) && <Popconfirm
        title={category ? 'Xóa hạng đấu?' : 'Xóa bộ môn?'}
        description={category ? 'Các trận đấu và sơ đồ thuộc hạng này cũng sẽ bị xóa.' : 'Các hạng đấu và dữ liệu thi đấu chỉ thuộc bộ môn này cũng sẽ bị xóa.'}
        okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }}
        onConfirm={() => category ? props.onDeleteCategory(record) : props.onDeleteSport(record)}>
        <Tooltip title={category ? 'Xóa hạng đấu' : 'Xóa bộ môn'}><Button type="text" danger
          aria-label={category ? `Xóa hạng đấu ${record.name}` : `Xóa bộ môn ${record.name}`} icon={<Trash2 size={16} />} /></Tooltip>
      </Popconfirm>}
    </Space>
  );
  const sportColumns: TableProps<any>['columns'] = [
    { title: 'Thứ tự hiển thị', dataIndex: 'sortOrder', width: 150, fixed: 'left', sorter: (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0), render: (value, sport) => props.canManageSports
      ? <SportOrderInput value={value ?? 0} name={sport.name} onSave={(sortOrder) => props.onSortOrder(sport, sortOrder)} />
      : value ?? 0 },
    { title: 'Bộ môn', key: 'name', width: 300, sorter: (a, b) => a.name.localeCompare(b.name, 'vi'), render: (_, sport) => (
      <div className="sports-catalog-identity">
        <span className="sports-catalog-logo">{sport.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(sport.logoUrl, 'logo')} alt="" loading="lazy" />
        ) : <Dumbbell size={22} />}</span>
        <div><Typography.Text strong>{sport.displayName || sport.name}</Typography.Text>
          {sport.displayName && sport.displayName !== sport.name && <Typography.Text type="secondary" className="block text-xs">{sport.name}</Typography.Text>}
        </div>
      </div>
    ) },
    { title: 'Mã', dataIndex: 'code', width: 90, sorter: (a, b) => a.code.localeCompare(b.code), render: (code) => <Tag>{code}</Tag> },
    { title: 'Hạng đấu', key: 'categories', width: 120, sorter: (a, b) => (a.categories?.length || 0) - (b.categories?.length || 0), render: (_, sport) => <Button type="link" className="!px-0" onClick={() => viewCategories(sport)}>{sport.categories?.length || 0} hạng đấu</Button> },
    { title: 'Sự kiện', key: 'events', width: 100, sorter: (a, b) => (a._count?.events || 0) - (b._count?.events || 0), render: (_, sport) => sport._count?.events || 0 },
    { title: 'Hiển thị', key: 'visibility', width: 150, render: (_, sport) => props.canManageSports ? <Space size={8}>
      <Switch size="small" aria-label={`Hiển thị bộ môn ${sport.name}`} checked={sport.isVisible !== false} loading={busySport === sport.id}
        onChange={async (visible) => { setBusySport(sport.id); try { await props.onVisibility(sport, visible); } finally { setBusySport(undefined); } }} />
      <Typography.Text type="secondary">{sport.isVisible !== false ? 'Hiển thị' : 'Đang ẩn'}</Typography.Text>
    </Space> : <Tag color={sport.isVisible !== false ? 'success' : 'default'}>{sport.isVisible !== false ? 'Hiển thị' : 'Đang ẩn'}</Tag> },
    { title: 'Thao tác', key: 'actions', width: 180, fixed: 'right', render: (_, sport) => <Space size={4}>
      {props.canManageCategories && <Tooltip title="Thêm hạng đấu"><Button type="text" aria-label={`Thêm hạng đấu cho ${sport.name}`} icon={<Plus size={16} />} onClick={() => props.onEditCategory(sport)} /></Tooltip>}
      {actions(sport)}
    </Space> },
  ];
  const categoryColumns: TableProps<any>['columns'] = [
    { title: 'Hạng đấu', dataIndex: 'name', width: 290, sorter: (a, b) => a.name.localeCompare(b.name, 'vi'), render: (name) => <Typography.Text strong>{name}</Typography.Text> },
    { title: 'Bộ môn', key: 'sport', width: 140, sorter: (a, b) => a.sport.name.localeCompare(b.sport.name, 'vi'), render: (_, category) => <Tag color="blue">{category.sport.name}</Tag> },
    { title: 'Giới tính', dataIndex: 'gender', width: 100, render: (value) => label(genders, value) },
    { title: 'Nội dung', dataIndex: 'discipline', width: 180, render: (value) => label(options.discipline, value) },
    { title: 'Trang phục / Đai', key: 'uniform', width: 190, render: (_, category) => <><div>{label(options.uniform, category.uniform)}</div><Typography.Text type="secondary" className="text-xs">{label(options.beltLevel, category.beltLevel)}</Typography.Text></> },
    { title: 'Cân nặng', key: 'weight', width: 140, sorter: (a, b) => (a.maxWeight ?? a.minWeight ?? Infinity) - (b.maxWeight ?? b.minWeight ?? Infinity), render: (_, category) => range(category.minWeight, category.maxWeight, 'kg') },
    { title: 'Độ tuổi', key: 'age', width: 130, render: (_, category) => range(category.minAge, category.maxAge, 'tuổi') },
    { title: 'Thể thức', dataIndex: 'format', width: 170, render: (value) => label(options.format, value) },
    { title: 'Thời lượng', dataIndex: 'matchDurationSeconds', width: 120, sorter: (a, b) => (a.matchDurationSeconds || 0) - (b.matchDurationSeconds || 0), render: (value) => value == null ? '—' : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` },
    { title: 'Thao tác', key: 'actions', width: 100, fixed: 'right', render: (_, category) => actions(category, true) },
  ];
  const selectFilter = (key: string, placeholder: string, choices: Option[]) => <Select
    allowClear showSearch optionFilterProp="label" filterOption={(input, option) => normalize(option?.label).includes(normalize(input))}
    aria-label={placeholder} placeholder={placeholder} value={filters[key]} options={choices} onChange={(value) => setFilter(key, value)} />;
  const pagination = (total: number, page: number, size: number, onChange: (page: number, size: number) => void) => ({
    current: Math.min(page, Math.max(1, Math.ceil(total / size))), pageSize: size, showSizeChanger: true,
    pageSizeOptions: [10, 20, 50, 100], onChange, showTotal: (count: number, bounds: [number, number]) => `${bounds[0]}–${bounds[1]} / ${count} kết quả`,
  });
  const empty = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có kết quả phù hợp. Thử đổi từ khóa hoặc bỏ bộ lọc." />;

  return <Card className="sports-catalog" styles={{ body: { padding: 0 } }}>
    {props.error && <Alert className="m-5" type="error" showIcon title="Không thể tải danh mục" action={<Button onClick={props.onRetry}>Thử lại</Button>} />}
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'sports', label: <span className="flex items-center gap-2"><Dumbbell size={17} />Bộ môn <Tag>{sports.length}</Tag></span> },
      { key: 'categories', label: <span className="flex items-center gap-2"><Tags size={17} />Hạng đấu <Tag>{categories.length}</Tag></span> },
    ]} />
    <div className="sports-catalog-toolbar">
      {tab === 'sports' ? <>
        <div className="sports-catalog-filters sports-catalog-sport-filters">
          <Input allowClear aria-label="Tìm bộ môn" prefix={<Search size={17} />} placeholder="Tìm tên, mã hoặc mô tả bộ môn…" value={sportSearch} onChange={(event) => { setSportSearch(event.target.value); setSportPage(1); }} />
          <Select allowClear aria-label="Trạng thái hiển thị" placeholder="Tất cả trạng thái" value={visibility} onChange={(value) => { setVisibility(value); setSportPage(1); }} options={[{ value: 'visible', label: 'Đang hiển thị' }, { value: 'hidden', label: 'Đang ẩn' }]} />
          <Button icon={<RotateCcw size={16} />} disabled={!sportSearch && !visibility} onClick={() => { setSportSearch(''); setVisibility(undefined); setSportPage(1); }}>Đặt lại</Button>
        </div>
        <Typography.Text type="secondary">{filteredSports.length} / {sports.length} bộ môn · Số thứ tự nhỏ hiển thị trước{props.canManageSports ? ' · Nhập thứ tự rồi nhấn Enter hoặc rời ô để lưu' : ''}</Typography.Text>
      </> : <>
        <div className="sports-catalog-filters">
          <Input allowClear aria-label="Tìm hạng đấu" prefix={<Search size={17} />} placeholder="Tìm tên hạng, bộ môn, cân nặng…" value={categorySearch} onChange={(event) => { setCategorySearch(event.target.value); setCategoryPage(1); }} />
          {selectFilter('sportId', 'Tất cả bộ môn', sports.map((sport) => ({ value: sport.id, label: `${sport.name} (${sport.code})` })))}
          {selectFilter('gender', 'Tất cả giới tính', genders)}
          <Button icon={<SlidersHorizontal size={16} />} aria-expanded={advanced} type={advanced ? 'primary' : 'default'} onClick={() => setAdvanced(!advanced)}>Bộ lọc thêm{activeCount ? ` (${activeCount})` : ''}</Button>
        </div>
        {advanced && <div className="sports-catalog-filters sports-catalog-advanced">
          {selectFilter('discipline', 'Tất cả nội dung', options.discipline)}
          {selectFilter('uniform', 'Tất cả trang phục', options.uniform)}
          {selectFilter('beltLevel', 'Tất cả trình độ đai', options.beltLevel)}
          {selectFilter('format', 'Tất cả thể thức', options.format)}
        </div>}
        <div className="sports-catalog-results">
          <Space wrap><Typography.Text type="secondary">{filteredCategories.length} / {categories.length} hạng đấu</Typography.Text>
            {(activeCount > 0 || categorySearch) && <Button type="link" className="!px-0" icon={<RotateCcw size={14} />} onClick={() => { setFilters({}); setCategorySearch(''); setCategoryPage(1); }}>Xóa bộ lọc</Button>}
          </Space>
          {props.canManageCategories && <Button type="primary" disabled={!sports.length} icon={<Plus size={16} />} onClick={() => props.onEditCategory(sports.find((sport) => sport.id === filters.sportId) || sports[0])}>Thêm hạng đấu</Button>}
        </div>
      </>}
    </div>
    {tab === 'sports' ? <Table key="sports" rowKey="id" loading={props.loading} columns={sportColumns} dataSource={filteredSports} scroll={{ x: 1190 }} locale={{ emptyText: empty }}
      pagination={pagination(filteredSports.length, sportPage, sportPageSize, (page, size) => { setSportPage(page); setSportPageSize(size); })} /> :
      <Table key="categories" rowKey="id" loading={props.loading} columns={categoryColumns} dataSource={filteredCategories} scroll={{ x: 1560 }} locale={{ emptyText: empty }}
        pagination={pagination(filteredCategories.length, categoryPage, categoryPageSize, (page, size) => { setCategoryPage(page); setCategoryPageSize(size); })} />}
  </Card>;
}

function SportOrderInput({ value, name, onSave }: { value: number; name: string; onSave: (value: number) => Promise<void> }) {
  const [draft, setDraft] = useState<number | null>(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  const save = async () => {
    const nextValue = draft ?? 0;
    if (saving || nextValue === value) return;
    setSaving(true);
    try {
      await onSave(nextValue);
      setDraft(nextValue);
    } catch {
      setDraft(value);
    } finally {
      setSaving(false);
    }
  };

  return <InputNumber<number> aria-label={`Thứ tự hiển thị ${name}`} min={0} max={2147483647} precision={0} value={draft} disabled={saving}
    className="w-full" onChange={setDraft} onBlur={() => { void save(); }} onPressEnter={(event) => (event.target as HTMLInputElement).blur()} />;
}
