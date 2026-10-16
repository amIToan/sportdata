'use client';

import { imageUrl } from '@/lib/image-url';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  App as AntApp,
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Switch,
  Upload,
  type UploadFile,
} from 'antd';
import TextArea from 'antd/es/input/TextArea';
import { Dumbbell, ImagePlus, Plus, Trash2, UploadCloud } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { CmsPageHeader } from '@/components/cms/CmsPageHeader';
import { SportsCatalogTables } from '@/components/cms/SportsCatalogTables';
import { api, fetcher } from '@/lib/api';

const emptySport = {
  name: '',
  code: '',
  description: '',
  displayName: '',
  subtitle: '',
  isVisible: true,
  sortOrder: '0',
};
const acceptedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const emptyCategory = {
  name: '',
  gender: 'MALE',
  format: 'HEAD_TO_HEAD',
  discipline: 'NEWAZA',
  uniform: 'GI',
  beltLevel: 'OPEN',
  matchDurationSeconds: '300',
  minAge: '',
  maxAge: '',
  maxWeight: '',
};
const formatOptions = [
  { value: 'HEAD_TO_HEAD', label: 'Đối kháng 1–1' },
  { value: 'ROUND_ROBIN', label: 'Vòng tròn' },
  { value: 'HEAT', label: 'Chia heat' },
  { value: 'LANE', label: 'Thi đấu theo làn' },
  { value: 'MULTI_PARTICIPANT', label: 'Nhiều VĐV cùng thi đấu' },
  { value: 'RELAY', label: 'Tiếp sức' },
];
const disciplineOptions = [
  { value: 'NEWAZA', label: 'Newaza · Địa chiến' },
  { value: 'FIGHTING', label: 'Fighting · Đối kháng 3 phần' },
  { value: 'CONTACT', label: 'Contact' },
  { value: 'FULL_CONTACT', label: 'Full Contact' },
  { value: 'DUO', label: 'Duo' },
  { value: 'SHOW', label: 'Show' },
];
const uniformOptions = [
  { value: 'GI', label: 'Gi' },
  { value: 'NO_GI', label: 'No-Gi' },
];
const beltOptions = [
  { value: 'WHITE', label: 'Đai trắng' },
  { value: 'BLUE', label: 'Đai xanh' },
  { value: 'PURPLE', label: 'Đai tím' },
  { value: 'BROWN', label: 'Đai nâu' },
  { value: 'BLACK', label: 'Đai đen' },
  { value: 'OPEN', label: 'Không giới hạn đai' },
];

export default function SportsPage() {
  const { data: currentUser } = useSWR<any>('/auth/profile', fetcher);
  const canManageSports = ['ADMIN', 'CONTENT', 'GAMES_ADMIN'].includes(currentUser?.role);
  const canManageCategories = ['ADMIN', 'CONTENT', 'GAMES_ADMIN'].includes(currentUser?.role);
  const canDeleteSport = ['ADMIN', 'GAMES_ADMIN'].includes(currentUser?.role);
  const canDeleteCategory = ['ADMIN', 'GAMES_ADMIN'].includes(currentUser?.role);
  const { message: toast } = AntApp.useApp();
  const { data: sports = [], error, isLoading, mutate } = useSWR<any[]>('/sports', fetcher);
  const [sportOpen, setSportOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingSport, setEditingSport] = useState<any>(null);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [categorySport, setCategorySport] = useState<any>(null);
  const [sportForm, setSportForm] = useState(emptySport);
  const [logoFileList, setLogoFileList] = useState<UploadFile[]>([]);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [backgroundFileList, setBackgroundFileList] = useState<UploadFile[]>([]);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState(emptyCategory);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (error) toast.error('Không thể tải danh sách bộ môn.');
  }, [error, toast]);

  const openSport = (sport?: any) => {
    setEditingSport(sport || null);
    setSportForm(
      sport
        ? {
            name: sport.name,
            code: sport.code,
            description: sport.description || '',
            displayName: sport.displayName || '',
            subtitle: sport.subtitle || '',
            isVisible: sport.isVisible !== false,
            sortOrder: String(sport.sortOrder || 0),
          }
        : emptySport,
    );
    setLogoFileList([]);
    setLogoPreview(sport?.logoUrl || null);
    setBackgroundFileList([]);
    setBackgroundPreview(sport?.backgroundUrl || null);
    setSportOpen(true);
  };

  const openCategory = (sport: any, category?: any) => {
    setCategorySport(sport);
    setEditingCategory(category || null);
    setCategoryForm(category
      ? {
          name: category.name,
          gender: category.gender,
          format: category.format || 'HEAD_TO_HEAD',
          discipline: category.discipline || 'NEWAZA',
          uniform: category.uniform || 'GI',
          beltLevel: category.beltLevel || 'OPEN',
          matchDurationSeconds: String(category.matchDurationSeconds || 300),
          minAge: category.minAge == null ? '' : String(category.minAge),
          maxAge: category.maxAge == null ? '' : String(category.maxAge),
          maxWeight: category.maxWeight == null ? '' : String(category.maxWeight),
        }
      : emptyCategory);
    setCategoryOpen(true);
  };

  const saveSport = async () => {
    setSaving(true);
    try {
      const payload = {
        ...sportForm,
        code: sportForm.code.trim().toUpperCase(),
        sortOrder: Number(sportForm.sortOrder || 0),
      };
      const response = editingSport
        ? await api.patch(`/sports/${editingSport.id}`, payload)
        : await api.post('/sports', payload);
      const savedSport = response.data;
      const logo = logoFileList[0]?.originFileObj || logoFileList[0];
      if (logo instanceof File) {
        const formData = new FormData();
        formData.append('image', logo);
        await api.patch(`/sports/${savedSport.id}/logo`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      const image = backgroundFileList[0]?.originFileObj || backgroundFileList[0];
      if (image instanceof File) {
        const formData = new FormData();
        formData.append('image', image);
        await api.patch(`/sports/${savedSport.id}/background`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      setSportOpen(false);
      setLogoFileList([]);
      setLogoPreview(null);
      setBackgroundFileList([]);
      setBackgroundPreview(null);
      await mutate();
      toast.success(editingSport ? 'Đã cập nhật bộ môn' : 'Đã thêm bộ môn');
    } catch (requestError: any) {
      toast.error(requestError.response?.data?.message || 'Không thể lưu bộ môn.');
    } finally {
      setSaving(false);
    }
  };

  const validateLogo = (file: File) => {
    if (!acceptedImageTypes.includes(file.type)) {
      toast.error('Chỉ chấp nhận logo JPG, PNG, WebP hoặc AVIF.');
      return Upload.LIST_IGNORE;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo không được vượt quá 2 MB.');
      return Upload.LIST_IGNORE;
    }
    setLogoFileList([file as unknown as UploadFile]);
    setLogoPreview(URL.createObjectURL(file));
    return false;
  };

  const removeLogo = async () => {
    if (!editingSport?.logoUrl) return;
    setSaving(true);
    try {
      const response = await api.delete(`/sports/${editingSport.id}/logo`);
      setEditingSport(response.data);
      setLogoFileList([]);
      setLogoPreview(null);
      await mutate();
      toast.success('Đã xóa logo.');
    } catch (requestError: any) {
      toast.error(requestError.response?.data?.message || 'Không thể xóa logo.');
    } finally {
      setSaving(false);
    }
  };

  const validateBackground = (file: File) => {
    if (!acceptedImageTypes.includes(file.type)) {
      toast.error('Chỉ chấp nhận ảnh JPG, PNG, WebP hoặc AVIF.');
      return Upload.LIST_IGNORE;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error('Ảnh nền không được vượt quá 4 MB.');
      return Upload.LIST_IGNORE;
    }
    setBackgroundFileList([file as unknown as UploadFile]);
    setBackgroundPreview(URL.createObjectURL(file));
    return false;
  };

  const removeBackground = async () => {
    if (!editingSport?.backgroundUrl) return;
    setSaving(true);
    try {
      const response = await api.delete(`/sports/${editingSport.id}/background`);
      setEditingSport(response.data);
      setBackgroundFileList([]);
      setBackgroundPreview(null);
      await mutate();
      toast.success('Đã xóa ảnh nền.');
    } catch (requestError: any) {
      toast.error(requestError.response?.data?.message || 'Không thể xóa ảnh nền.');
    } finally {
      setSaving(false);
    }
  };

  const updateVisibility = async (sport: any, isVisible: boolean) => {
    try {
      await api.patch(`/sports/${sport.id}`, { isVisible });
      await mutate();
      toast.success(isVisible ? 'Đã hiển thị bộ môn trên trang Sự kiện.' : 'Đã ẩn bộ môn khỏi trang Sự kiện.');
    } catch (requestError: any) {
      toast.error(requestError.response?.data?.message || 'Không thể cập nhật trạng thái hiển thị.');
    }
  };

  const saveCategory = async () => {
    setSaving(true);
    try {
      const payload = {
        name: categoryForm.name,
        sportId: categorySport.id,
        gender: categoryForm.gender,
        format: categoryForm.format,
        discipline: categoryForm.discipline || undefined,
        uniform: categoryForm.uniform || undefined,
        beltLevel: categoryForm.beltLevel || undefined,
        matchDurationSeconds: categoryForm.matchDurationSeconds ? Number(categoryForm.matchDurationSeconds) : undefined,
        minAge: categoryForm.minAge !== '' ? Number(categoryForm.minAge) : null,
        maxAge: categoryForm.maxAge !== '' ? Number(categoryForm.maxAge) : null,
        maxWeight: categoryForm.maxWeight !== '' ? Number(categoryForm.maxWeight) : null,
      };
      if (editingCategory) await api.patch(`/categories/${editingCategory.id}`, payload);
      else await api.post('/categories', payload);
      setCategoryOpen(false);
      await mutate();
      toast.success(editingCategory ? 'Đã cập nhật hạng đấu' : 'Đã thêm hạng đấu');
    } catch (requestError: any) {
      toast.error(requestError.response?.data?.message || 'Không thể tạo hạng đấu.');
    } finally {
      setSaving(false);
    }
  };

  const updateSortOrder = async (sport: any, sortOrder: number) => {
    try {
      await api.patch(`/sports/${sport.id}`, { sortOrder });
      await mutate();
      toast.success('Đã cập nhật thứ tự hiển thị bộ môn.');
    } catch (requestError: any) {
      toast.error(requestError.response?.data?.message || 'Không thể cập nhật thứ tự hiển thị.');
      throw requestError;
    }
  };

  const removeSport = async (sport: any) => {
    try {
      await api.delete(`/sports/${sport.id}`);
      await mutate();
      toast.success('Đã xóa bộ môn');
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ||
          'Không thể xóa bộ môn đang được sử dụng.',
      );
    }
  };

  const removeCategory = async (category: any) => {
    try {
      await api.delete(`/categories/${category.id}`);
      await mutate();
      toast.success('Đã xóa hạng đấu');
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ||
          'Không thể xóa hạng đấu đang được sử dụng.',
      );
    }
  };

  return (
    <div className="space-y-6">
      <CmsPageHeader
        title="Bộ môn & hạng đấu"
        description="Cấu hình danh mục dùng khi tạo sự kiện và trận đấu."
        icon={<Dumbbell className="h-6 w-6" />}
        action={canManageSports ? <Button type="primary" size="large" icon={<Plus className="h-4 w-4" />} onClick={() => openSport()}>Thêm bộ môn</Button> : undefined}
      />

      <SportsCatalogTables
        sports={sports}
        loading={isLoading}
        error={Boolean(error)}
        onRetry={() => { void mutate(); }}
        canManageSports={canManageSports}
        canManageCategories={canManageCategories}
        canDeleteSport={canDeleteSport}
        canDeleteCategory={canDeleteCategory}
        onEditSport={openSport}
        onEditCategory={openCategory}
        onDeleteSport={removeSport}
        onDeleteCategory={removeCategory}
        onVisibility={updateVisibility}
        onSortOrder={updateSortOrder}
        options={{ discipline: disciplineOptions, uniform: uniformOptions, beltLevel: beltOptions, format: formatOptions }}
      />
      <Modal
        isOpen={sportOpen}
        onClose={() => {
          if (saving) return;
          setSportOpen(false);
          setLogoFileList([]);
          setLogoPreview(null);
          setBackgroundFileList([]);
          setBackgroundPreview(null);
        }}
        title={editingSport ? 'Chỉnh sửa bộ môn' : 'Thêm bộ môn'}
        size="xl"
        scrollBody={false}
      >
        <Form layout="vertical" requiredMark={false} onFinish={saveSport}>
          <div className="grid gap-x-4 md:grid-cols-2">
            <Field label="Tên bộ môn trong hệ thống *">
              <Input
                required
                value={sportForm.name}
                onChange={(event) => setSportForm({ ...sportForm, name: event.target.value })}
              />
            </Field>
            <Field label="Mã viết tắt *">
              <Input
                required
                maxLength={10}
                className="font-mono uppercase"
                value={sportForm.code}
                onChange={(event) => setSportForm({ ...sportForm, code: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Tên tiêu đề trên thẻ">
            <Input
              maxLength={120}
              placeholder="Ví dụ: JJIF"
              value={sportForm.displayName}
              onChange={(event) => setSportForm({ ...sportForm, displayName: event.target.value })}
            />
          </Field>
          <Field label="Tiêu đề phụ">
            <TextArea
              rows={2}
              maxLength={240}
              showCount
              placeholder="Ví dụ: Ju Jitsu International Federation"
              value={sportForm.subtitle}
              onChange={(event) => setSportForm({ ...sportForm, subtitle: event.target.value })}
            />
          </Field>
          <div className="grid gap-x-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <Form.Item label="Logo bộ môn">
              <div className="flex flex-col gap-3 rounded-xl border border-sdark-700 bg-sdark-800/40 p-3 sm:flex-row sm:items-center">
                <div className="grid h-24 w-32 shrink-0 place-items-center overflow-hidden rounded-xl border border-sdark-700 bg-sdark-950 p-3">
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl(logoPreview, 'logo')} alt="Xem trước logo" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <ImagePlus className="h-7 w-7 text-slate-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2">
                    <Upload
                      accept={acceptedImageTypes.join(',')}
                      maxCount={1}
                      fileList={logoFileList}
                      showUploadList={false}
                      beforeUpload={validateLogo}
                    >
                      <Button htmlType="button" icon={<ImagePlus className="h-4 w-4" />}>
                        {logoPreview ? 'Thay logo' : 'Chọn logo'}
                      </Button>
                    </Upload>
                    {logoFileList.length > 0 && (
                      <Button
                        htmlType="button"
                        onClick={() => {
                          setLogoFileList([]);
                          setLogoPreview(editingSport?.logoUrl || null);
                        }}
                      >
                        Hủy ảnh mới
                      </Button>
                    )}
                    {editingSport?.logoUrl && !logoFileList.length && (
                      <Popconfirm
                        title="Xóa logo hiện tại?"
                        okText="Xóa"
                        cancelText="Hủy"
                        okButtonProps={{ danger: true }}
                        onConfirm={removeLogo}
                      >
                        <Button htmlType="button" danger icon={<Trash2 className="h-4 w-4" />}>Xóa logo</Button>
                      </Popconfirm>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">JPG, PNG, WebP hoặc AVIF · tối đa 2 MB · nên dùng ảnh nền trong suốt.</p>
                </div>
              </div>
            </Form.Item>
            <Field label="Thứ tự hiển thị">
              <InputNumber
                min={0}
                precision={0}
                className="w-full"
                value={Number(sportForm.sortOrder || 0)}
                onChange={(value) => setSportForm({ ...sportForm, sortOrder: String(value ?? 0) })}
              />
            </Field>
          </div>
          <Field label="Mô tả chi tiết">
            <TextArea
              rows={3}
              value={sportForm.description}
              onChange={(event) => setSportForm({ ...sportForm, description: event.target.value })}
            />
          </Field>

          <Form.Item label="Ảnh nền thẻ bộ môn">
            {backgroundPreview && (
              <div className="relative mb-3 aspect-[16/7] overflow-hidden rounded-2xl border border-sdark-700 bg-sdark-950">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(backgroundPreview, 'card')} alt="Xem trước ảnh nền" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
                {logoPreview && (
                  <div className="absolute left-4 top-4 grid h-16 w-24 place-items-center rounded-xl border border-white/15 bg-black/35 p-2 backdrop-blur-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl(logoPreview, 'logo')} alt="" className="max-h-full max-w-full object-contain" />
                  </div>
                )}
                <div className="absolute bottom-4 left-4">
                  <p className="text-xl font-black text-white">{sportForm.displayName || sportForm.name || 'Tên bộ môn'}</p>
                  <p className="text-sm text-slate-200">{sportForm.subtitle || 'Tiêu đề phụ'}</p>
                </div>
              </div>
            )}
            <Upload.Dragger
              accept={acceptedImageTypes.join(',')}
              maxCount={1}
              fileList={backgroundFileList}
              beforeUpload={validateBackground}
              onRemove={() => {
                setBackgroundFileList([]);
                setBackgroundPreview(editingSport?.backgroundUrl || null);
              }}
            >
              <UploadCloud className="mx-auto mb-2 h-8 w-8 text-sblue-400" />
              <p className="font-semibold text-slate-200">Chọn hoặc kéo ảnh nền vào đây</p>
              <p className="text-xs text-slate-500">JPG, PNG, WebP hoặc AVIF · tối đa 4 MB · khuyến nghị tỷ lệ 16:9</p>
            </Upload.Dragger>
            {editingSport?.backgroundUrl && !backgroundFileList.length && (
              <Popconfirm
                title="Xóa ảnh nền hiện tại?"
                okText="Xóa"
                cancelText="Hủy"
                okButtonProps={{ danger: true }}
                onConfirm={removeBackground}
              >
                <Button htmlType="button" danger type="link" className="mt-2 !px-0" icon={<Trash2 className="h-4 w-4" />}>
                  Xóa ảnh nền
                </Button>
              </Popconfirm>
            )}
          </Form.Item>

          <div className="mb-5 flex items-center justify-between rounded-xl border border-sdark-700 bg-sdark-800/50 px-4 py-3">
            <div>
              <p className="font-semibold text-slate-200">Hiển thị trên trang Sự kiện</p>
              <p className="text-xs text-slate-500">Tắt để ẩn thẻ bộ môn nhưng vẫn giữ nguyên dữ liệu.</p>
            </div>
            <Switch
              checked={sportForm.isVisible}
              onChange={(isVisible) => setSportForm({ ...sportForm, isVisible })}
            />
          </div>
          <Button type="primary" htmlType="submit" block loading={saving}>
            Lưu bộ môn
          </Button>
        </Form>
      </Modal>

      <Modal
        isOpen={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        title={`${editingCategory ? 'Chỉnh sửa' : 'Thêm'} hạng đấu · ${categorySport?.name || ''}`}
        size="xl"
      >
        <Form layout="vertical" requiredMark={false} onFinish={saveCategory} className="space-y-6 [&_.ant-form-item]:!mb-0">
          {!editingCategory && <Field label="Bộ môn *">
            <Select
              showSearch
              optionFilterProp="label"
              className="w-full"
              value={categorySport?.id}
              options={sports.map((sport) => ({ value: sport.id, label: `${sport.name} (${sport.code})` }))}
              onChange={(id) => setCategorySport(sports.find((sport) => sport.id === id))}
            />
          </Field>}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
            <div className="md:col-span-3">
              <Field label="Tên hạng đấu *">
                <Input
                  required
                  value={categoryForm.name}
                  onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })}
                />
              </Field>
            </div>
            <Field label="Giới tính">
              <Select
                className="w-full"
                value={categoryForm.gender}
                options={[
                  { value: 'MALE', label: 'Nam' },
                  { value: 'FEMALE', label: 'Nữ' },
                  { value: 'MIXED', label: 'Hỗn hợp' },
                ]}
                onChange={(gender) => setCategoryForm({ ...categoryForm, gender })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-4">
            <Field label="Nội dung thi đấu">
              <Select className="w-full" value={categoryForm.discipline} options={disciplineOptions} onChange={(discipline) => setCategoryForm({ ...categoryForm, discipline })} />
            </Field>
            <Field label="Trang phục">
              <Select className="w-full" value={categoryForm.uniform} options={uniformOptions} onChange={(uniform) => setCategoryForm({ ...categoryForm, uniform })} />
            </Field>
            <Field label="Trình độ đai">
              <Select className="w-full" value={categoryForm.beltLevel} options={beltOptions} onChange={(beltLevel) => setCategoryForm({ ...categoryForm, beltLevel })} />
            </Field>
            <Field label="Thể thức">
              <Select
                className="w-full"
                value={categoryForm.format}
                options={formatOptions}
                onChange={(format) => setCategoryForm({ ...categoryForm, format })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-4">
            <NumberField label="Tuổi tối thiểu" value={categoryForm.minAge} onChange={(minAge) => setCategoryForm({ ...categoryForm, minAge })} />
            <NumberField label="Tuổi tối đa" value={categoryForm.maxAge} onChange={(maxAge) => setCategoryForm({ ...categoryForm, maxAge })} />
            <NumberField label="Cân nặng tối đa (kg)" value={categoryForm.maxWeight} step={0.1} onChange={(maxWeight) => setCategoryForm({ ...categoryForm, maxWeight })} />
            <NumberField label="Thời lượng trận (giây)" value={categoryForm.matchDurationSeconds} onChange={(matchDurationSeconds) => setCategoryForm({ ...categoryForm, matchDurationSeconds })} />
          </div>
          <p className="text-sm text-slate-400">Cân nặng tối đa là tùy chọn, chỉ dùng để hiển thị thông tin, không giới hạn đăng ký.</p>
          <Button type="primary" htmlType="submit" block loading={saving}>
            {editingCategory ? 'Lưu hạng đấu' : 'Tạo hạng đấu'}
          </Button>
        </Form>
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <Form.Item label={label}>{children}</Form.Item>;
}

function NumberField({
  label,
  value,
  step = 1,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  value: string;
  step?: number;
  min?: number;
  max?: number;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <InputNumber
        min={min}
        max={max}
        step={step}
        value={value === '' ? null : Number(value)}
        className="w-full"
        style={{ width: '100%' }}
        onChange={(nextValue) => onChange(nextValue === null ? '' : String(nextValue))}
      />
    </Field>
  );
}
