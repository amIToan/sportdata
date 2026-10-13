'use client';

import { imageUrl } from '@/lib/image-url';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import dayjs from 'dayjs';
import {
  Avatar,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import { Check, Eye, FileText, ImagePlus, Pencil, Plus, Save, Trash2, UploadCloud, UserRound, X } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { vietnamCountryId } from '@/lib/countries';

type CountryOption = {
  id: string;
  code: string;
  name: string;
  flagUrl?: string | null;
};

type FederationOption = {
  id: string;
  name: string;
  code?: string | null;
  type?: FederationType;
  countryId: string;
  country?: CountryOption;
};

type FederationType =
  | 'INTERNATIONAL_FEDERATION'
  | 'NATIONAL_FEDERATION'
  | 'SPORTS_CENTER'
  | 'CLUB'
  | 'SCHOOL'
  | 'ACADEMY'
  | 'OTHER';

type AthleteDocumentType = 'CCCD_FRONT' | 'CCCD_BACK' | 'PASSPORT';
type AthleteDocument = {
  id: string;
  type: AthleteDocumentType;
  mimeType: string;
  size: number;
  verificationStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
  verificationNote?: string | null;
  updatedAt: string;
};

const athleteDocumentOptions: Array<{
  type: AthleteDocumentType;
  label: string;
  description: string;
}> = [
  { type: 'CCCD_FRONT', label: 'CCCD mặt trước', description: 'Ảnh rõ họ tên, số CCCD và ngày sinh' },
  { type: 'CCCD_BACK', label: 'CCCD mặt sau', description: 'Ảnh rõ mã QR và thông tin cấp thẻ' },
  { type: 'PASSPORT', label: 'Hộ chiếu (nếu có)', description: 'Trang thông tin cá nhân của hộ chiếu' },
];

const federationTypeOptions: Array<{ value: FederationType; label: string }> = [
  { value: 'SPORTS_CENTER', label: 'Trung tâm thể thao' },
  { value: 'CLUB', label: 'Câu lạc bộ' },
  { value: 'ACADEMY', label: 'Học viện' },
  { value: 'SCHOOL', label: 'Trường học' },
  { value: 'NATIONAL_FEDERATION', label: 'Liên đoàn quốc gia' },
  { value: 'INTERNATIONAL_FEDERATION', label: 'Liên đoàn quốc tế' },
  { value: 'OTHER', label: 'Đơn vị khác' },
];

const athleteSchema = z.object({
  firstName: z.string().min(1, 'Vui lòng nhập họ'),
  lastName: z.string().min(1, 'Vui lòng nhập tên'),
  fullName: z.string().min(3, 'Tên hiển thị phải có ít nhất 3 ký tự'),
  email: z.string().email('Email không hợp lệ').or(z.literal('')).optional(),
  phone: z.string().min(8, 'Số điện thoại phải có ít nhất 8 ký tự').or(z.literal('')).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'MIXED']),
  birthDate: z.string().optional(),
  countryId: z.string().min(1, 'Vui lòng chọn quốc gia'),
  federationId: z.string().optional(),
  height: z.string().optional(),
  weight: z.string().optional(),
  photoUrl: z.string().url('URL ảnh không hợp lệ').or(z.literal('')).optional(),
  sportIds: z.array(z.string()).min(1, 'Vui lòng chọn ít nhất một bộ môn'),
  categoryIds: z.array(z.string()).min(1, 'Vui lòng chọn ít nhất một hạng thi đấu'),
});

type AthleteFormValues = z.infer<typeof athleteSchema>;

export function AthleteForm({ athleteId, initialData, returnTo = '/cms/athletes' }: { athleteId?: string; initialData?: any; returnTo?: string }) {
  const { data: currentUser } = useSWR<any>('/auth/profile', fetcher);
  const router = useRouter();
  const toast = useSportDataToast();
  const [federationManagerOpen, setFederationManagerOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [documentUploading, setDocumentUploading] = useState<AthleteDocumentType | null>(null);
  const [pendingDocuments, setPendingDocuments] = useState<Partial<Record<AthleteDocumentType, File>>>({});
  const { data: countries = [] } = useSWR<CountryOption[]>('/countries', fetcher);
  const {
    data: federations = [],
    isLoading: federationsLoading,
    mutate: mutateFederations,
  } = useSWR<FederationOption[]>('/federations', fetcher);
  const { data: sports = [] } = useSWR<any[]>('/sports', fetcher);
  const { data: athleteDocuments = [], mutate: mutateDocuments } = useSWR<AthleteDocument[]>(
    athleteId ? `/athletes/${athleteId}/documents` : null,
    fetcher,
  );
  const { data: identityDetails, error: identityError, isLoading: identityLoading, mutate: mutateIdentity } = useSWR<{ cccd: string | null }>(
    athleteId ? `/athletes/${athleteId}/identity-details` : null,
    fetcher,
  );

  const {
    control,
    clearErrors,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AthleteFormValues>({
    resolver: zodResolver(athleteSchema),
    mode: 'onChange',
    defaultValues: {
      firstName: initialData?.firstName || '',
      lastName: initialData?.lastName || '',
      fullName: initialData?.fullName || '',
      email: initialData?.email || '',
      phone: initialData?.phone || '',
      gender: initialData?.gender || 'MALE',
      birthDate: initialData?.birthDate ? new Date(initialData.birthDate).toISOString().slice(0, 10) : '',
      countryId: initialData?.countryId || '',
      federationId: initialData?.federationId || '',
      height: initialData?.height != null ? String(initialData.height) : '',
      weight: initialData?.weight != null ? String(initialData.weight) : '',
      photoUrl: initialData?.photoUrl || '',
      sportIds: Array.from(
        new Set(
          (initialData?.categories || [])
            .map((category: any) => category.sportId || category.sport?.id)
            .filter(Boolean),
        ),
      ),
      categoryIds: initialData?.categories?.map((category: any) => category.id) || [],
    },
  });
  const selectedCountryId = watch('countryId');
  const selectedFederationId = watch('federationId');
  const selectedSportIds = watch('sportIds') || [];
  const selectedCategoryIds = watch('categoryIds') || [];
  const countryFederations = federations.filter(
    (federation) => !selectedCountryId || federation.countryId === selectedCountryId,
  );

  useEffect(() => {
    if (athleteId || selectedCountryId || !countries.length) return;
    const defaultCountryId = vietnamCountryId(countries);
    if (defaultCountryId) {
      setValue('countryId', defaultCountryId, { shouldValidate: true });
    }
  }, [athleteId, countries, selectedCountryId, setValue]);

  useEffect(() => {
    if (!selectedFederationId || !selectedCountryId) return;
    const selectedFederation = federations.find((item) => item.id === selectedFederationId);
    if (selectedFederation && selectedFederation.countryId !== selectedCountryId) {
      setValue('federationId', '', { shouldDirty: true, shouldValidate: true });
    }
  }, [federations, selectedCountryId, selectedFederationId, setValue]);

  const selectedSports = sports
    .filter((sport: any) => selectedSportIds.includes(sport.id))
    .map((sport: any) => ({
      ...sport,
      categories: uniqueCategories(sport.categories || []),
    }));
  const availableCategoryIds = new Set(
    selectedSports.flatMap((sport: any) =>
      (sport.categories || []).map((category: any) => category.id),
    ),
  );
  const categoryOptions = selectedSports.map((sport: any) => ({
    label: sport.name,
    options: (sport.categories || []).map((category: any) => ({
      value: category.id,
      label: formatCategoryLabel(category),
    })),
  }));

  const onSubmit = async (values: AthleteFormValues) => {
    const selectedCategories = sports
      .flatMap((sport: any) => sport.categories || [])
      .filter((category: any) => values.categoryIds.includes(category.id));
    const categorySportIds = new Set(selectedCategories.map((category: any) => category.sportId));
    const sportWithoutCategory = sports.find(
      (sport: any) => values.sportIds.includes(sport.id) && !categorySportIds.has(sport.id),
    );

    if (sportWithoutCategory) {
      setError('categoryIds', {
        type: 'validate',
        message: `Vui lòng chọn ít nhất một hạng thi đấu của ${sportWithoutCategory.name}`,
      });
      return;
    }

    const { sportIds: _sportIds, ...formValues } = values;
    const payload = {
      ...formValues,
      categoryIds: Array.from(new Set(formValues.categoryIds)),
      birthDate: values.birthDate || undefined,
      email: athleteId ? values.email || null : values.email || undefined,
      phone: athleteId ? values.phone || null : values.phone || undefined,
      federationId: athleteId ? values.federationId || null : values.federationId || undefined,
      height: values.height ? Number(values.height) : undefined,
      weight: values.weight ? Number(values.weight) : undefined,
      photoUrl: values.photoUrl || undefined,
    };
    let savedAthleteId = athleteId;
    try {
      if (athleteId) {
        await api.patch(`/athletes/${athleteId}`, payload);
      } else {
        const response = await api.post('/athletes', payload);
        savedAthleteId = response.data.id;
        for (const option of athleteDocumentOptions) {
          const file = pendingDocuments[option.type];
          if (file) await sendDocument(savedAthleteId, option.type, file);
        }
      }
      toast.success(athleteId ? 'Đã cập nhật vận động viên.' : 'Đã thêm vận động viên.');
      router.push(athleteId ? returnTo : '/cms/athletes');
      router.refresh();
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Không thể lưu vận động viên';
      if (!athleteId && savedAthleteId) {
        toast.error(`Hồ sơ đã được tạo nhưng chưa tải đủ giấy tờ: ${Array.isArray(message) ? message.join(', ') : message}`);
        router.push(`/cms/athletes/${savedAthleteId}/edit`);
        router.refresh();
        return;
      }
      toast.error(Array.isArray(message) ? message.join(', ') : message);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (!athleteId) return;
    setAvatarUploading(true);
    const data = new FormData();
    data.append('file', file);
    try {
      const response = await api.post(`/athletes/${athleteId}/avatar`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setValue('photoUrl', response.data.photoUrl, { shouldDirty: true });
      setAvatarVersion((version) => version + 1);
      toast.success('Đã cập nhật ảnh đại diện.');
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Không thể tải ảnh đại diện';
      toast.error(Array.isArray(message) ? message.join(', ') : message);
    } finally {
      setAvatarUploading(false);
    }
  };

  const sendDocument = async (targetAthleteId: string, type: AthleteDocumentType, file: File) => {
    const data = new FormData();
    data.append('file', file);
    await api.post(`/athletes/${targetAthleteId}/documents/${type}`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  };

  const selectDocument = async (type: AthleteDocumentType, file: File) => {
    if (file.size > 4 * 1024 * 1024) {
      toast.error('Tệp giấy tờ không được vượt quá 4 MB.');
      return;
    }
    if (!athleteId) {
      setPendingDocuments((current) => ({ ...current, [type]: file }));
      return;
    }

    setDocumentUploading(type);
    try {
      await sendDocument(athleteId, type, file);
      await mutateDocuments();
      await mutateIdentity();
      toast.success(`Đã tải lên ${documentLabel(type)}.`);
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Không thể tải giấy tờ';
      toast.error(Array.isArray(message) ? message.join(', ') : message);
    } finally {
      setDocumentUploading(null);
    }
  };

  const viewDocument = async (type: AthleteDocumentType) => {
    const pendingFile = pendingDocuments[type];
    if (pendingFile) {
      const url = URL.createObjectURL(pendingFile);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    if (!athleteId) return;
    try {
      const response = await api.get(`/athletes/${athleteId}/documents/${type}`, {
        responseType: 'blob', params: { variant: 'preview' },
      });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Không thể mở giấy tờ';
      toast.error(Array.isArray(message) ? message.join(', ') : message);
    }
  };

  const deleteDocument = async (type: AthleteDocumentType) => {
    if (pendingDocuments[type]) {
      setPendingDocuments((current) => {
        const next = { ...current };
        delete next[type];
        return next;
      });
      return;
    }
    if (!athleteId) return;
    try {
      await api.delete(`/athletes/${athleteId}/documents/${type}`);
      await mutateDocuments();
      await mutateIdentity();
      toast.success(`Đã xóa ${documentLabel(type)}.`);
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Không thể xóa giấy tờ';
      toast.error(Array.isArray(message) ? message.join(', ') : message);
    }
  };

  const canEditDocuments = ['ADMIN', 'CONTENT', 'GAMES_ADMIN'].includes(currentUser?.role);

  return (
    <>
      <Form layout="vertical" requiredMark={false} onFinish={handleSubmit(onSubmit)}>
      <div className="grid gap-6">
      <Card className="cms-surface" title="Thông tin vận động viên">
        <Row gutter={[20, 2]}>
          <ControlledField name="firstName" control={control} label="Họ" error={errors.firstName?.message}>
            {(field) => <Input {...field} size="large" placeholder="Nguyễn" />}
          </ControlledField>
          <ControlledField name="lastName" control={control} label="Tên" error={errors.lastName?.message}>
            {(field) => <Input {...field} size="large" placeholder="Minh Anh" />}
          </ControlledField>
          <ControlledField name="fullName" control={control} label="Tên hiển thị" error={errors.fullName?.message} wide>
            {(field) => <Input {...field} size="large" placeholder="Ví dụ: Nguyễn Minh Anh" />}
          </ControlledField>
          <ControlledField name="email" control={control} label="Email" error={errors.email?.message}>
            {(field) => <Input {...field} size="large" type="email" placeholder="email@example.com" />}
          </ControlledField>
          <ControlledField name="phone" control={control} label="Số điện thoại" error={errors.phone?.message}>
            {(field) => <Input {...field} size="large" type="tel" placeholder="0901234567" />}
          </ControlledField>
          <Col xs={24} md={12}>
            <Form.Item
              label="Số CCCD"
              validateStatus={identityError ? 'error' : undefined}
              help={identityError ? 'Không thể tải số CCCD. Vui lòng thử lại.' : undefined}
            >
              <Input
                size="large"
                readOnly
                aria-label="Số CCCD"
                value={identityDetails?.cccd || ''}
                placeholder={identityLoading ? 'Đang tải...' : 'Chưa có số CCCD'}
                suffix={identityError ? <Button size="small" type="link" onClick={() => mutateIdentity()}>Thử lại</Button> : undefined}
              />
            </Form.Item>
          </Col>
          <ControlledField name="gender" control={control} label="Giới tính" error={errors.gender?.message}>
            {(field) => <Select size="large" className="w-full" value={field.value} onChange={field.onChange} options={[{ value: 'MALE', label: 'Nam' }, { value: 'FEMALE', label: 'Nữ' }, { value: 'MIXED', label: 'Hỗn hợp' }]} />}
          </ControlledField>
          <ControlledField name="birthDate" control={control} label="Ngày sinh" error={errors.birthDate?.message}>
            {(field) => (
              <DatePicker needConfirm={false}
                format="DD/MM/YYYY"
                size="large"
                className="w-full"
                placeholder="Chọn ngày sinh"
                value={field.value ? dayjs(field.value) : null}
                disabledDate={(current) => current.isAfter(dayjs(), 'day')}
                onBlur={field.onBlur}
                onChange={(value) => field.onChange(value ? value.format('YYYY-MM-DD') : '')}
              />
            )}
          </ControlledField>
          <ControlledField name="countryId" control={control} label="Quốc gia" error={errors.countryId?.message}>
            {(field) => (
              <Select
                size="large"
                showSearch
                optionFilterProp="searchText"
                className="w-full"
                placeholder="Chọn quốc gia"
                value={field.value || undefined}
                onChange={field.onChange}
                options={countries.map((country) => ({
                  value: country.id,
                  searchText: `${country.code} ${country.name}`,
                  label: <CountryLabel country={country} />,
                }))}
              />
            )}
          </ControlledField>
          <ControlledField
            name="federationId"
            control={control}
            label={(
              <Space size={4}>
                <span>Đơn vị chủ quản</span>
                <Tooltip title="Thêm, sửa hoặc xóa liên đoàn, trung tâm, CLB">
                  <Button
                    type="text"
                    size="small"
                    htmlType="button"
                    aria-label="Quản lý đơn vị chủ quản"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => setFederationManagerOpen(true)}
                  />
                </Tooltip>
              </Space>
            )}
            error={errors.federationId?.message}
          >
            {(field) => <Select size="large" allowClear showSearch optionFilterProp="label" className="w-full" placeholder={selectedCountryId ? 'Liên đoàn, trung tâm, CLB...' : 'Chọn quốc gia trước'} disabled={!selectedCountryId} value={field.value || undefined} onChange={(value) => field.onChange(value || '')} options={countryFederations.map((federation) => ({ value: federation.id, label: federation.code ? `${federation.code} · ${federation.name}` : federation.name }))} />}
          </ControlledField>
          <ControlledField name="height" control={control} label="Chiều cao (cm)" error={errors.height?.message}>
            {(field) => <Input {...field} size="large" type="number" min={0} step={0.1} placeholder="170" />}
          </ControlledField>
          <ControlledField name="weight" control={control} label="Cân nặng (kg)" error={errors.weight?.message}>
            {(field) => <Input {...field} size="large" type="number" min={0} step={0.1} placeholder="65" />}
          </ControlledField>
          {athleteId && (
            <Col span={24}>
              <Form.Item label="Tải ảnh đại diện trực tiếp">
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-sdark-700 p-4">
                  <Avatar
                    size={64}
                    icon={<UserRound />}
                    src={imageUrl(watch('photoUrl'), 'avatar', avatarVersion)}
                  />
                  <Upload
                    accept="image/jpeg,image/png,image/webp"
                    showUploadList={false}
                    customRequest={async (options) => {
                      await uploadAvatar(options.file as File);
                      options.onSuccess?.({});
                    }}
                  >
                    <Button loading={avatarUploading} icon={<ImagePlus className="h-4 w-4" />}>Chọn ảnh từ máy</Button>
                  </Upload>
                  <span className="text-xs text-slate-500">JPG, PNG hoặc WebP · tối đa 8 MB</span>
                </div>
              </Form.Item>
            </Col>
          )}
        </Row>
      </Card>
      <Card className="cms-surface" title="Giấy tờ định danh">
          <Typography.Paragraph type="secondary" className="mb-5">
            Tải ảnh CCCD hai mặt và hộ chiếu nếu có. {athleteId
              ? 'Tệp mới sẽ thay thế tệp cùng loại và chuyển về trạng thái chờ xác minh.'
              : 'Các tệp sẽ được tải lên tự động ngay sau khi tạo hồ sơ.'}
          </Typography.Paragraph>
          <Row gutter={[24, 24]}>
            {athleteDocumentOptions.map((option) => {
              const document = athleteDocuments.find((item) => item.type === option.type);
              const pendingFile = pendingDocuments[option.type];
              const hasFile = Boolean(document || pendingFile);
              return (
                <Col xs={24} md={8} key={option.type}>
                  <div className="flex h-full flex-col rounded-xl border border-sdark-700 bg-sdark-950/35 p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-sblue-300" />
                        <Typography.Text strong>{option.label}</Typography.Text>
                      </div>
                      {pendingFile
                        ? <Tag color="blue">Sẵn sàng tải</Tag>
                        : document && <DocumentStatusTag status={document.verificationStatus} />}
                    </div>
                    <Typography.Text type="secondary" className="mb-4 block text-xs">
                      {option.description}
                    </Typography.Text>
                    {(document || pendingFile) && (
                      <Typography.Text type="secondary" className="mb-3 block text-xs">
                        {pendingFile
                          ? `${pendingFile.name} · ${formatBytes(pendingFile.size)}`
                          : `${formatBytes(document!.size)} · cập nhật ${new Date(document!.updatedAt).toLocaleString('vi-VN')}`}
                      </Typography.Text>
                    )}
                    <Space wrap className="mt-auto">
                      {canEditDocuments && (
                        <Upload
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          showUploadList={false}
                          customRequest={async (options) => {
                            await selectDocument(option.type, options.file as File);
                            options.onSuccess?.({});
                          }}
                        >
                          <Button
                            htmlType="button"
                            loading={documentUploading === option.type}
                            icon={<UploadCloud className="h-4 w-4" />}
                          >
                            {hasFile ? 'Thay tệp' : 'Chọn tệp'}
                          </Button>
                        </Upload>
                      )}
                      {hasFile && (
                        <Button
                          htmlType="button"
                          icon={<Eye className="h-4 w-4" />}
                          onClick={() => void viewDocument(option.type)}
                        >
                          Xem
                        </Button>
                      )}
                      {hasFile && canEditDocuments && (
                        <Popconfirm
                          title={`Xóa ${option.label}?`}
                          okText="Xóa"
                          cancelText="Hủy"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => deleteDocument(option.type)}
                        >
                          <Button htmlType="button" danger icon={<Trash2 className="h-4 w-4" />} />
                        </Popconfirm>
                      )}
                    </Space>
                    <Typography.Text type="secondary" className="mt-3 text-xs">
                      JPG, PNG, WebP hoặc PDF · tối đa 4 MB
                    </Typography.Text>
                  </div>
                </Col>
              );
            })}
          </Row>
      </Card>
      <Card className="cms-surface" title="Nội dung thi đấu">
        <Typography.Paragraph type="secondary" className="mb-5">
          Một vận động viên có thể đăng ký nhiều bộ môn và nhiều hạng thi đấu.
        </Typography.Paragraph>
        <Row gutter={[20, 2]}>
          <ControlledField name="sportIds" control={control} label="Bộ môn" error={errors.sportIds?.message} wide>
            {(field) => (
              <Select
                mode="multiple"
                size="large"
                showSearch
                optionFilterProp="label"
                className="w-full"
                placeholder="Chọn một hoặc nhiều bộ môn"
                value={field.value}
                onChange={(sportIds: string[]) => {
                  const nextSportIds = Array.from(new Set<string>(sportIds));
                  setValue('sportIds', nextSportIds, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  });
                  const validCategoryIds = new Set(
                    sports
                      .filter((sport: any) => nextSportIds.includes(sport.id))
                      .flatMap((sport: any) =>
                        (sport.categories || []).map((category: any) => category.id),
                      ),
                  );
                  setValue(
                    'categoryIds',
                    selectedCategoryIds.filter((categoryId) => validCategoryIds.has(categoryId)),
                    { shouldDirty: true, shouldTouch: true, shouldValidate: true },
                  );
                }}
                options={sports.map((sport: any) => ({ value: sport.id, label: sport.name }))}
              />
            )}
          </ControlledField>
          <ControlledField name="categoryIds" control={control} label="Hạng cân / hạng thi đấu" error={errors.categoryIds?.message} wide>
            {(field) => (
              <Select
                mode="multiple"
                size="large"
                showSearch
                optionFilterProp="label"
                className="w-full"
                placeholder={selectedSportIds.length ? 'Chọn một hoặc nhiều hạng thi đấu' : 'Chọn bộ môn trước'}
                disabled={!selectedSportIds.length}
                value={field.value.filter((categoryId: string) => availableCategoryIds.has(categoryId))}
                onChange={(categoryIds: string[]) => {
                  const nextCategoryIds = Array.from(new Set<string>(categoryIds))
                    .filter((categoryId) => availableCategoryIds.has(categoryId));
                  setValue('categoryIds', nextCategoryIds, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  });
                  if (nextCategoryIds.length) clearErrors('categoryIds');
                }}
                options={categoryOptions}
                notFoundContent="Bộ môn này chưa có hạng thi đấu"
              />
            )}
          </ControlledField>
        </Row>
      </Card>
      </div>
      <FormActions pending={isSubmitting} label={athleteId ? 'Lưu thay đổi' : 'Tạo vận động viên'} cancelHref={athleteId ? returnTo : '/cms/athletes'} />
      </Form>

      <FederationManager
        open={federationManagerOpen}
        countries={countries}
        federations={federations}
        loading={federationsLoading}
        preferredCountryId={selectedCountryId}
        selectedFederationId={selectedFederationId}
        onClose={() => setFederationManagerOpen(false)}
        onSelect={(federationId) => {
          setValue('federationId', federationId, {
            shouldDirty: true,
            shouldTouch: true,
            shouldValidate: true,
          });
        }}
        onChanged={() => mutateFederations()}
        canDelete={['ADMIN', 'GAMES_ADMIN'].includes(currentUser?.role)}
      />
    </>
  );
}

function CountryLabel({ country }: { country: CountryOption }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {country.flagUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={country.flagUrl}
          alt={`Cờ ${country.name}`}
          className="h-4 w-6 shrink-0 rounded-sm object-cover"
        />
      ) : (
        <span className="h-4 w-6 shrink-0 rounded-sm bg-sdark-700" aria-hidden="true" />
      )}
      <span className="truncate">{country.code} · {country.name}</span>
    </span>
  );
}

function FederationManager({
  open,
  countries,
  federations,
  loading,
  preferredCountryId,
  selectedFederationId,
  onClose,
  onSelect,
  onChanged,
  canDelete,
}: {
  open: boolean;
  countries: CountryOption[];
  federations: FederationOption[];
  loading: boolean;
  preferredCountryId?: string;
  selectedFederationId?: string;
  onClose: () => void;
  onSelect: (federationId: string) => void;
  onChanged: () => Promise<unknown>;
  canDelete: boolean;
}) {
  const [countryId, setCountryId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<FederationType>('SPORTS_CENTER');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const toast = useSportDataToast();

  useEffect(() => {
    if (!open) return;

    const selectedFederation = federations.find(
      (federation) => federation.id === selectedFederationId,
    );
    setCountryId(
      selectedFederation?.countryId || preferredCountryId || vietnamCountryId(countries) || countries[0]?.id || '',
    );
    setName('');
    setCode('');
    setType('SPORTS_CENTER');
    setEditingId(null);
  }, [countries, federations, open, preferredCountryId, selectedFederationId]);

  const visibleFederations = federations.filter(
    (federation) => federation.countryId === countryId,
  );

  const resetEditor = () => {
    setName('');
    setCode('');
    setType('SPORTS_CENTER');
    setEditingId(null);
  };

  const saveFederation = async () => {
    const normalizedName = name.trim();
    if (!countryId) {
      toast.error('Vui lòng chọn quốc gia của liên đoàn.');
      return;
    }
    if (!normalizedName) {
      toast.error('Vui lòng nhập tên liên đoàn.');
      return;
    }

    setSaving(true);
    try {
      const response = editingId
        ? await api.patch<FederationOption>(`/federations/${editingId}`, {
            name: normalizedName,
            countryId,
            code: code.trim() || null,
            type,
          })
        : await api.post<FederationOption>('/federations', {
            name: normalizedName,
            countryId,
            code: code.trim() || undefined,
            type,
          });
      await onChanged();
      onSelect(response.data.id);
      resetEditor();
      toast.success(editingId ? 'Đã cập nhật đơn vị thể thao.' : 'Đã thêm đơn vị thể thao.');
    } catch (requestError: any) {
      toast.error(getRequestError(requestError, 'Không thể lưu liên đoàn.'));
    } finally {
      setSaving(false);
    }
  };

  const removeFederation = async (federation: FederationOption) => {
    setDeletingId(federation.id);
    try {
      await api.delete(`/federations/${federation.id}`);
      if (selectedFederationId === federation.id) onSelect('');
      if (editingId === federation.id) resetEditor();
      await onChanged();
      toast.success('Đã xóa đơn vị thể thao.');
    } catch (requestError: any) {
      toast.error(getRequestError(requestError, 'Không thể xóa liên đoàn.'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Modal
      open={open}
      title="Quản lý đơn vị thể thao"
      footer={null}
      width={680}
      maskClosable={!saving && !deletingId}
      onCancel={onClose}
    >
      <div className="space-y-4 pt-2">
        <div>
          <Typography.Text strong>Quốc gia</Typography.Text>
          <Select
            size="large"
            showSearch
            optionFilterProp="searchText"
            className="mt-2 w-full"
            placeholder="Chọn quốc gia"
            value={countryId || undefined}
            onChange={(value) => {
              setCountryId(value);
              resetEditor();
            }}
            options={countries.map((country) => ({
              value: country.id,
              searchText: `${country.code} ${country.name}`,
              label: <CountryLabel country={country} />,
            }))}
          />
        </div>

        <div>
          <Typography.Text strong>
            {editingId ? 'Sửa đơn vị' : 'Thêm đơn vị mới'}
          </Typography.Text>
          <Row gutter={[10, 10]} className="mt-2">
            <Col xs={24} sm={9}>
              <Select
                size="large"
                className="w-full"
                value={type}
                options={federationTypeOptions}
                onChange={setType}
              />
            </Col>
            <Col xs={24} sm={5}>
              <Input
                size="large"
                value={code}
                placeholder="Mã đơn vị"
                maxLength={24}
                disabled={!countryId}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </Col>
            <Col xs={24} sm={10}>
            <Input
              size="large"
              value={name}
              placeholder="Tên liên đoàn / trung tâm / CLB"
              maxLength={180}
              disabled={!countryId}
              onChange={(event) => setName(event.target.value)}
              onPressEnter={saveFederation}
            />
            </Col>
            <Col span={24} className="flex justify-end gap-2">
            {editingId && (
              <Tooltip title="Hủy sửa">
                <Button
                  size="large"
                  htmlType="button"
                  aria-label="Hủy sửa"
                  icon={<X className="h-4 w-4" />}
                  onClick={resetEditor}
                />
              </Tooltip>
            )}
            <Button
              type="primary"
              size="large"
              htmlType="button"
              loading={saving}
              disabled={!countryId || !name.trim()}
              icon={editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              onClick={saveFederation}
            >
              {editingId ? 'Lưu' : 'Thêm'}
            </Button>
            </Col>
          </Row>
        </div>

        <div>
          <Typography.Text strong>Danh sách đơn vị</Typography.Text>
          <List
            className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-sdark-700 px-3"
            loading={loading}
            dataSource={visibleFederations}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Quốc gia này chưa có đơn vị thể thao"
                />
              ),
            }}
            renderItem={(federation) => {
              const selected = federation.id === selectedFederationId;
              return (
                <List.Item
                  actions={[
                    <Tooltip key="select" title={selected ? 'Đang được chọn' : 'Chọn đơn vị này'}>
                      <Button
                        type={selected ? 'primary' : 'text'}
                        size="small"
                        htmlType="button"
                        aria-label="Chọn đơn vị"
                        icon={<Check className="h-4 w-4" />}
                        onClick={() => onSelect(federation.id)}
                      />
                    </Tooltip>,
                    <Tooltip key="edit" title="Sửa tên">
                      <Button
                        type="text"
                        size="small"
                        htmlType="button"
                        aria-label="Sửa tên liên đoàn"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => {
                          setEditingId(federation.id);
                          setName(federation.name);
                          setCode(federation.code || '');
                          setType(federation.type || 'NATIONAL_FEDERATION');
                        }}
                      />
                    </Tooltip>,
                    canDelete ? <Popconfirm
                      key="delete"
                      title={`Xóa “${federation.name}”?`}
                      description="Chỉ có thể xóa đơn vị chưa được VĐV hoặc sự kiện sử dụng."
                      okText="Xóa"
                      cancelText="Hủy"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => removeFederation(federation)}
                    >
                      <Tooltip title="Xóa">
                        <Button
                          type="text"
                          danger
                          size="small"
                          htmlType="button"
                          aria-label="Xóa liên đoàn"
                          loading={deletingId === federation.id}
                          icon={<Trash2 className="h-4 w-4" />}
                        />
                      </Tooltip>
                    </Popconfirm> : null,
                  ]}
                >
                  <Space size={6} wrap>
                    <Typography.Text>{federation.name}</Typography.Text>
                    {federation.code && <Tag>{federation.code}</Tag>}
                    <Tag color="geekblue">
                      {federationTypeOptions.find((option) => option.value === federation.type)?.label || 'Đơn vị'}
                    </Tag>
                  </Space>
                  {selected && <Tag color="blue">Đang chọn</Tag>}
                </List.Item>
              );
            }}
          />
        </div>
      </div>
    </Modal>
  );
}

function getRequestError(error: any, fallback: string) {
  const message = error.response?.data?.message || error.message || fallback;
  return Array.isArray(message) ? message.join(', ') : message;
}

function DocumentStatusTag({ status }: { status?: AthleteDocument['verificationStatus'] }) {
  if (status === 'VERIFIED') return <Tag color="success">Đã xác minh</Tag>;
  if (status === 'REJECTED') return <Tag color="error">Bị từ chối</Tag>;
  return <Tag color="processing">Chờ xác minh</Tag>;
}

function documentLabel(type: AthleteDocumentType) {
  return athleteDocumentOptions.find((option) => option.type === type)?.label || 'giấy tờ';
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uniqueCategories(categories: any[]) {
  const unique = new Map<string, any>();

  for (const category of categories) {
    const key = `${category.sportId}:${category.name.trim().toLocaleLowerCase('vi')}`;
    const current = unique.get(key);
    const completeness = categoryCompleteness(category);

    if (!current || completeness > categoryCompleteness(current)) {
      unique.set(key, category);
    }
  }

  return Array.from(unique.values());
}

function categoryCompleteness(category: any) {
  return [
    category.discipline,
    category.uniform,
    category.beltLevel,
    category.matchDurationSeconds,
    category.minAge,
    category.maxAge,
    category.minWeight,
    category.maxWeight,
  ].filter((value) => value != null).length;
}

function formatCategoryLabel(category: any) {
  const gender = category.gender === 'FEMALE' ? 'Nữ' : category.gender === 'MIXED' ? 'Hỗn hợp' : 'Nam';
  const weight = category.minWeight != null && category.maxWeight != null
    ? `${category.minWeight}–${category.maxWeight} kg`
    : category.maxWeight != null
      ? `đến ${category.maxWeight} kg`
      : category.minWeight != null
        ? `từ ${category.minWeight} kg`
        : null;

  return [category.name, gender, weight].filter(Boolean).join(' · ');
}

function ControlledField({ name, control, label, error, children, wide = false }: { name: keyof AthleteFormValues; control: any; label: ReactNode; error?: string; children: (field: any) => React.ReactElement; wide?: boolean }) {
  return (
    <Col xs={24} md={wide ? 24 : 12}>
      <Form.Item label={label} validateStatus={error ? 'error' : undefined} help={error} required>
        <Controller name={name} control={control} render={({ field }) => children(field)} />
      </Form.Item>
    </Col>
  );
}

export function FormActions({ pending, label, cancelHref }: { pending: boolean; label: string; cancelHref: string }) {
  return (
    <div className="mt-6 flex justify-end">
      <Space>
        <Button href={cancelHref} size="large">Hủy</Button>
        <Button type="primary" htmlType="submit" size="large" loading={pending} icon={<Save className="h-4 w-4" />}>{label}</Button>
      </Space>
    </div>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  const toast = useSportDataToast();

  useEffect(() => {
    toast.error(message);
  }, [message, toast]);

  return null;
}
