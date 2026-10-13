'use client';

import { imageUrl } from '@/lib/image-url';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import dayjs from 'dayjs';
import { Button, Card, Checkbox, Col, DatePicker, Form, Image, Input, InputNumber, Row, Select, Upload } from 'antd';
import { ImagePlus, Trash2 } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { FormActions } from './AthleteForm';
import { RemoteAthleteSelect } from './RemoteAthleteSelect';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { findVietnamCountry } from '@/lib/countries';

const eventImageUrlSchema = z.string().refine(
  (value) => !value || value.startsWith('/api/') || z.string().url().safeParse(value).success,
  'Đường dẫn ảnh không hợp lệ',
).optional();

const eventSchema = z.object({
  name: z.string().min(3, 'Tên sự kiện phải có ít nhất 3 ký tự'),
  sportIds: z.array(z.string()).min(1, 'Vui lòng chọn ít nhất một bộ môn'),
  categoryIds: z.array(z.string()),
  athleteIds: z.array(z.string()),
  level: z.enum(['INTERNATIONAL', 'NATIONAL', 'REGIONAL', 'PROVINCIAL', 'CENTER_INTERNAL', 'OPEN']),
  organizerId: z.string().optional(),
  participatingFederationIds: z.array(z.string()),
  allowIndependentAthletes: z.boolean(),
  ageLimitMode: z.enum(['CATEGORY', 'UNRESTRICTED', 'CUSTOM']),
  minAge: z.number().int('Tuổi phải là số nguyên').min(0, 'Tuổi không được âm').nullable(),
  maxAge: z.number().int('Tuổi phải là số nguyên').min(0, 'Tuổi không được âm').nullable(),
  registrationEnabled: z.boolean(),
  registrationOpenAt: z.string().optional(),
  registrationCloseAt: z.string().optional(),
  registrationFee: z.number().min(0),
  registrationCurrency: z.string().min(1),
  paymentMode: z.enum(['FREE', 'MANUAL', 'ONLINE']),
  description: z.string().optional(),
  startDate: z.string().min(1, 'Vui lòng chọn thời gian bắt đầu'),
  endDate: z.string().min(1, 'Vui lòng chọn thời gian kết thúc'),
  location: z.string().optional(),
  bannerUrl: eventImageUrlSchema,
  logoUrl: eventImageUrlSchema,
  isPublished: z.boolean(),
}).refine((values) => values.ageLimitMode !== 'CUSTOM' || values.minAge !== null || values.maxAge !== null, {
  message: 'Vui lòng nhập tuổi tối thiểu hoặc tuổi tối đa',
  path: ['minAge'],
}).refine((values) => values.ageLimitMode !== 'CUSTOM' || values.minAge === null || values.maxAge === null || values.maxAge >= values.minAge, {
  message: 'Tuổi tối đa phải lớn hơn hoặc bằng tuổi tối thiểu',
  path: ['maxAge'],
}).refine((values) => new Date(values.endDate) >= new Date(values.startDate), {
  message: 'Thời gian kết thúc phải sau thời gian bắt đầu',
  path: ['endDate'],
}).refine((values) => values.level !== 'CENTER_INTERNAL' || Boolean(values.organizerId), {
  message: 'Sự kiện nội bộ phải chọn đơn vị tổ chức',
  path: ['organizerId'],
}).refine((values) => values.paymentMode === 'FREE' || values.registrationFee > 0, {
  message: 'Sự kiện thu phí phải có lệ phí lớn hơn 0',
  path: ['registrationFee'],
}).refine((values) => !values.registrationEnabled || Boolean(values.registrationOpenAt && values.registrationCloseAt), {
  message: 'Sự kiện mở đăng ký phải có thời gian bắt đầu và kết thúc đăng ký',
  path: ['registrationCloseAt'],
}).refine((values) => !values.registrationOpenAt || !values.registrationCloseAt || new Date(values.registrationCloseAt) >= new Date(values.registrationOpenAt), {
  message: 'Thời gian đóng đăng ký phải sau thời gian mở',
  path: ['registrationCloseAt'],
}).refine((values) => !values.registrationCloseAt || new Date(values.registrationCloseAt) <= new Date(values.startDate), {
  message: 'Thời gian đóng đăng ký không được sau khi sự kiện bắt đầu',
  path: ['registrationCloseAt'],
});

type EventFormValues = z.infer<typeof eventSchema>;
const toLocalInput = (value?: string) => value ? dayjs(value).format('YYYY-MM-DDTHH:mm') : '';
const formatVnd = (value?: string | number) => value == null || value === ''
  ? ''
  : new Intl.NumberFormat('vi-VN').format(Number(value));
const parseVnd = (value?: string) => Number(String(value || '').replace(/[^0-9]/g, ''));
const registrationWindowFrom = (startValue?: string) => {
  if (!startValue || !dayjs(startValue).isValid()) return { open: '', close: '' };
  const start = dayjs(startValue);
  return {
    open: start.subtract(30, 'day').startOf('day').format('YYYY-MM-DDTHH:mm'),
    close: start.subtract(1, 'day').endOf('day').second(0).format('YYYY-MM-DDTHH:mm'),
  };
};

export function EventForm({ eventId, initialData, returnTo = '/cms/events' }: { eventId?: string; initialData?: any; returnTo?: string }) {
  const router = useRouter();
  const toast = useSportDataToast();
  const [athleteCountryId, setAthleteCountryId] = useState<string>();
  const [athleteFederationId, setAthleteFederationId] = useState<string>();
  const [bannerFile, setBannerFile] = useState<File>();
  const [logoFile, setLogoFile] = useState<File>();
  const [bannerRemoved, setBannerRemoved] = useState(false);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const athleteCountryInitialized = useRef(false);
  const { data: sports = [] } = useSWR<any[]>('/sports', fetcher);
  const { data: federations = [] } = useSWR<any[]>('/federations', fetcher);
  const { data: categoriesResponse } = useSWR<any>('/categories?limit=500', fetcher);
  const categories = categoriesResponse?.items || [];
  const initialRegistrationWindow = registrationWindowFrom(initialData?.startDate);
  const {
    control,
    handleSubmit,
    getValues,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      name: initialData?.name || '',
      sportIds: initialData?.sports?.map((sport: any) => sport.id) || (initialData?.sportId ? [initialData.sportId] : []),
      categoryIds: initialData?.categories?.map((category: any) => category.id) || [],
      athleteIds: initialData?.athletes?.map((athlete: any) => athlete.id) || [],
      level: initialData?.level || 'INTERNATIONAL',
      organizerId: initialData?.organizerId || '',
      participatingFederationIds: initialData?.participatingFederations?.map((item: any) => item.id) || [],
      allowIndependentAthletes: initialData?.allowIndependentAthletes ?? true,
      ageLimitMode: initialData?.ageLimitMode || (eventId ? 'CATEGORY' : 'UNRESTRICTED'),
      minAge: initialData?.minAge ?? null,
      maxAge: initialData?.maxAge ?? null,
      registrationEnabled: initialData?.registrationEnabled ?? false,
      registrationOpenAt: toLocalInput(initialData?.registrationOpenAt) || initialRegistrationWindow.open,
      registrationCloseAt: toLocalInput(initialData?.registrationCloseAt) || initialRegistrationWindow.close,
      registrationFee: initialData?.registrationFee ?? 0,
      registrationCurrency: initialData?.registrationCurrency || 'VND',
      paymentMode: initialData?.paymentMode || 'FREE',
      description: initialData?.description || '',
      startDate: toLocalInput(initialData?.startDate),
      endDate: toLocalInput(initialData?.endDate),
      location: initialData?.location || '',
      bannerUrl: initialData?.bannerUrl || '',
      logoUrl: initialData?.logoUrl || '',
      isPublished: initialData?.isPublished ?? false,
    },
  });
  const selectedSportIds = watch('sportIds') || [];
  const selectedCategoryIds = watch('categoryIds') || [];
  const selectedLevel = watch('level');
  const selectedFederationIds = watch('participatingFederationIds') || [];
  const allowIndependentAthletes = watch('allowIndependentAthletes');
  const ageLimitMode = watch('ageLimitMode');
  const registrationEnabled = watch('registrationEnabled');
  const paymentMode = watch('paymentMode');
  const selectedCategoryIdsKey = selectedCategoryIds.join(',');
  const selectedFederationIdsKey = selectedFederationIds.join(',');
  const { data: athleteFilterOptions } = useSWR<any>(
    selectedCategoryIdsKey
      ? `/athletes/filter-options?categoryIds=${encodeURIComponent(selectedCategoryIdsKey)}${selectedFederationIdsKey ? `&federationIds=${encodeURIComponent(selectedFederationIdsKey)}` : ''}${allowIndependentAthletes ? '&includeIndependent=true' : ''}`
      : null,
    fetcher,
  );
  const countries = useMemo(() => athleteFilterOptions?.countries || [], [athleteFilterOptions?.countries]);
  const eligibleFederations = useMemo(
    () => athleteFilterOptions?.federations || [],
    [athleteFilterOptions?.federations],
  );
  const availableCategories = categories.filter((category: any) => selectedSportIds.includes(category.sportId));
  const selectedSports = selectedSportIds
    .map((sportId) => sports.find((sport: any) => sport.id === sportId))
    .filter(Boolean);

  useEffect(() => {
    if (!countries.length) return;
    if (!athleteCountryInitialized.current && !athleteCountryId) {
      athleteCountryInitialized.current = true;
      const vietnam = findVietnamCountry(countries);
      if (vietnam) setAthleteCountryId(vietnam.id);
      return;
    }
    if (athleteCountryId && !countries.some((country: any) => country.id === athleteCountryId)) {
      setAthleteCountryId(undefined);
    }
  }, [athleteCountryId, countries]);

  useEffect(() => {
    if (
      athleteFederationId
      && !eligibleFederations.some((federation: any) => federation.id === athleteFederationId)
    ) {
      setAthleteFederationId(undefined);
    }
  }, [athleteFederationId, eligibleFederations]);

  const onSubmit = async (values: EventFormValues) => {
    const validCategoryIds = values.categoryIds.filter(
      (id) => availableCategories.some((category: any) => category.id === id),
    );
    const payload = {
      ...values,
      minAge: values.ageLimitMode === 'CUSTOM' ? values.minAge : null,
      maxAge: values.ageLimitMode === 'CUSTOM' ? values.maxAge : null,
      sportId: values.sportIds[0],
      categoryIds: validCategoryIds,
      athleteIds: values.athleteIds,
      startDate: new Date(values.startDate).toISOString(),
      endDate: new Date(values.endDate).toISOString(),
      registrationOpenAt: values.registrationOpenAt ? new Date(values.registrationOpenAt).toISOString() : undefined,
      registrationCloseAt: values.registrationCloseAt ? new Date(values.registrationCloseAt).toISOString() : undefined,
      registrationFee: values.paymentMode === 'FREE' ? 0 : values.registrationFee,
      description: values.description || undefined,
      location: values.location || undefined,
      bannerUrl: eventId && bannerRemoved ? null : values.bannerUrl || undefined,
      logoUrl: eventId && logoRemoved ? null : values.logoUrl || undefined,
    };
    try {
      const response = eventId
        ? await api.patch(`/events/${eventId}`, payload)
        : await api.post('/events', payload);
      const savedEventId = eventId || response.data.id;
      const syncImage = async (
        kind: 'banner' | 'logo',
        file: File | undefined,
        removed: boolean,
      ) => {
        if (file) {
          const formData = new FormData();
          formData.append('file', file);
          await api.patch(`/events/${savedEventId}/${kind}-image`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } else if (removed && eventId) {
          await api.delete(`/events/${savedEventId}/${kind}-image`);
        }
      };
      await Promise.all([
        syncImage('banner', bannerFile, bannerRemoved),
        syncImage('logo', logoFile, logoRemoved),
      ]);
      toast.success(eventId ? 'Đã cập nhật sự kiện.' : 'Đã tạo sự kiện.');
      router.push(eventId ? returnTo : '/cms/events');
      router.refresh();
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Không thể lưu sự kiện';
      toast.error(Array.isArray(message) ? message.join(', ') : message);
    }
  };

  return (
    <Form layout="vertical" requiredMark={false} onFinish={handleSubmit(onSubmit)}>
      <Card className="cms-surface" title="Thông tin sự kiện">
        <Row gutter={[20, 2]}>
          <ControlledField name="name" control={control} label="Tên sự kiện" error={errors.name?.message} wide required>
            {(field) => <Input {...field} size="large" placeholder="Tên giải đấu hoặc sự kiện" />}
          </ControlledField>
          <ControlledField name="level" control={control} label="Quy mô sự kiện" error={errors.level?.message} required>
            {(field) => (
              <Select
                size="large"
                className="w-full"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'INTERNATIONAL', label: 'Quốc tế / Đại hội đa quốc gia' },
                  { value: 'NATIONAL', label: 'Toàn quốc' },
                  { value: 'REGIONAL', label: 'Khu vực' },
                  { value: 'PROVINCIAL', label: 'Tỉnh / thành phố' },
                  { value: 'CENTER_INTERNAL', label: 'Nội bộ trung tâm / CLB' },
                  { value: 'OPEN', label: 'Mở rộng' },
                ]}
              />
            )}
          </ControlledField>
          <ControlledField name="organizerId" control={control} label="Đơn vị tổ chức" error={errors.organizerId?.message}>
            {(field) => (
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                size="large"
                className="w-full"
                placeholder="Liên đoàn, trung tâm hoặc CLB"
                value={field.value || undefined}
                onChange={(organizerId) => {
                  field.onChange(organizerId || '');
                  if (selectedLevel === 'CENTER_INTERNAL' && organizerId) {
                    setValue(
                      'participatingFederationIds',
                      Array.from(new Set([...selectedFederationIds, organizerId])),
                    );
                  }
                }}
                options={federations.map((item: any) => ({
                  value: item.id,
                  label: `${item.name}${item.code ? ` · ${item.code}` : ''}`,
                }))}
              />
            )}
          </ControlledField>
          <ControlledField
            name="participatingFederationIds"
            control={control}
            label="Đơn vị / trung tâm / CLB tham gia"
            error={errors.participatingFederationIds?.message}
            wide
          >
            {(field) => (
              <Select
                mode="multiple"
                allowClear
                showSearch
                optionFilterProp="label"
                maxTagCount="responsive"
                size="large"
                className="w-full"
                placeholder="Để trống nếu giải mở cho mọi đơn vị"
                value={field.value}
                onChange={(ids) => {
                  field.onChange(ids);
                  setValue('athleteIds', [], { shouldValidate: true });
                }}
                options={federations.map((item: any) => ({
                  value: item.id,
                  label: `${item.name}${item.code ? ` · ${item.code}` : ''}`,
                }))}
              />
            )}
          </ControlledField>
          <Col span={24}>
            <Form.Item>
              <Controller
                name="allowIndependentAthletes"
                control={control}
                render={({ field }) => (
                  <Checkbox checked={field.value} onChange={(event) => field.onChange(event.target.checked)}>
                    Cho phép VĐV tự do, không trực thuộc đơn vị
                  </Checkbox>
                )}
              />
            </Form.Item>
          </Col>
          <ControlledField name="sportIds" control={control} label="Bộ môn" error={errors.sportIds?.message} wide required>
            {(field) => (
              <Select
                mode="multiple"
                size="large"
                showSearch
                optionFilterProp="label"
                className="w-full"
                maxTagCount={3}
                maxTagTextLength={24}
                maxTagPlaceholder={() => `Đã chọn ${field.value.length} bộ môn`}
                placeholder="Chọn một hoặc nhiều bộ môn"
                value={field.value}
                onChange={(sportIds: string[]) => {
                  field.onChange(sportIds);
                  const allowedSportIds = new Set(sportIds);
                  const validCategoryIds = selectedCategoryIds.filter((categoryId) => {
                    const category = categories.find((item: any) => item.id === categoryId);
                    return category && allowedSportIds.has(category.sportId);
                  });
                  setValue('categoryIds', validCategoryIds, { shouldValidate: true });
                  setValue('athleteIds', [], { shouldValidate: true });
                }}
                options={sports.map((sport) => ({ value: sport.id, label: sport.name }))}
              />
            )}
          </ControlledField>
          <ControlledField name="categoryIds" control={control} label="Hạng mục thi đấu" error={errors.categoryIds?.message} wide required>
            {(field) => (
              <CategoryGroupedSelect
                sports={selectedSports}
                categories={availableCategories}
                value={field.value}
                onChange={(categoryIds: string[]) => {
                  field.onChange(categoryIds);
                  setValue('athleteIds', [], { shouldValidate: true });
                }}
              />
            )}
          </ControlledField>
          <ControlledField name="ageLimitMode" control={control} label="Giới hạn tuổi" error={errors.ageLimitMode?.message} wide>
            {(field) => (
              <Select
                size="large"
                className="w-full"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'UNRESTRICTED', label: 'Không giới hạn tuổi' },
                  { value: 'CATEGORY', label: 'Theo độ tuổi của từng hạng đấu' },
                  { value: 'CUSTOM', label: 'Tự cấu hình cho sự kiện' },
                ]}
              />
            )}
          </ControlledField>
          {ageLimitMode === 'CUSTOM' && (
            <>
              <ControlledField name="minAge" control={control} label="Tuổi tối thiểu" error={errors.minAge?.message}>
                {(field) => <InputNumber size="large" className="w-full" min={0} precision={0} value={field.value} onChange={field.onChange} placeholder="Không giới hạn" />}
              </ControlledField>
              <ControlledField name="maxAge" control={control} label="Tuổi tối đa" error={errors.maxAge?.message}>
                {(field) => <InputNumber size="large" className="w-full" min={0} precision={0} value={field.value} onChange={field.onChange} placeholder="Không giới hạn" />}
              </ControlledField>
            </>
          )}
          <Col span={24}>
            <p className="mb-5 text-sm text-slate-500">
              {ageLimitMode === 'CATEGORY'
                ? 'Áp dụng tuổi tối thiểu và tối đa đã cấu hình trong từng hạng đấu.'
                : ageLimitMode === 'CUSTOM'
                  ? 'Tuổi được tính vào ngày bắt đầu sự kiện. Để trống một ô nếu không giới hạn phía đó. Cấu hình này thay thế giới hạn tuổi của hạng đấu.'
                  : 'VĐV ở mọi độ tuổi đều có thể tham gia; không áp dụng giới hạn tuổi của hạng đấu.'}
            </p>
          </Col>
          {/* <ControlledField name="athleteIds" control={control} label="Vận động viên tham gia" error={errors.athleteIds?.message} wide>
            {(field) => (
              <div className="event-athlete-picker">
                <div className="event-picker-heading">
                  <div>
                    <strong>Chọn VĐV đủ điều kiện</strong>
                    <p>Lọc theo quốc gia và đơn vị, sau đó tìm theo tên vận động viên.</p>
                  </div>
                  <span className="event-selection-count">
                    Đã chọn {(field.value || []).length.toLocaleString()} VĐV
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="event-filter-field">
                    <span>Quốc gia</span>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      size="large"
                      placeholder="Tất cả quốc gia"
                      value={athleteCountryId}
                      onChange={(value) => {
                        setAthleteCountryId(value);
                        setAthleteFederationId(undefined);
                      }}
                      options={countries.map((country: any) => ({
                        value: country.id,
                        label: `${country.name} · ${country.code} (${country.athleteCount})`,
                      }))}
                    />
                  </label>
                  <label className="event-filter-field">
                    <span>Đơn vị / CLB</span>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      size="large"
                      placeholder="Tất cả đơn vị"
                      value={athleteFederationId}
                      onChange={setAthleteFederationId}
                      options={eligibleFederations
                        .filter((federation: any) => !athleteCountryId || federation.countryId === athleteCountryId)
                        .map((federation: any) => ({
                          value: federation.id,
                          label: `${federation.name} (${federation.athleteCount})`,
                        }))}
                    />
                  </label>
                </div>
                <div className="event-athlete-search">
                  <span>Tìm và chọn vận động viên</span>
                  <RemoteAthleteSelect
                    mode="multiple"
                    categoryIds={selectedCategoryIds}
                    countryId={athleteCountryId}
                    federationId={athleteFederationId}
                    federationIds={selectedFederationIds}
                    includeIndependent={allowIndependentAthletes}
                    groupByCountry={!selectedFederationIds.length}
                    groupByFederation={Boolean(selectedFederationIds.length)}
                    maxTagCount={0}
                    selectionLabel="VĐV"
                    showPageControls
                    placeholder={selectedCategoryIds.length
                      ? 'Tìm và chọn vận động viên đủ điều kiện'
                      : 'Chọn hạng mục thi đấu trước'}
                    disabled={!selectedCategoryIds.length}
                    value={field.value || []}
                    onChange={field.onChange}
                  />
                </div>
              </div>
            )}
          </ControlledField> */}
          <ControlledField name="location" control={control} label="Địa điểm" error={errors.location?.message}>
            {(field) => <Input {...field} size="large" placeholder="Nhà thi đấu, thành phố" />}
          </ControlledField>
          <ControlledField name="startDate" control={control} label="Bắt đầu" error={errors.startDate?.message} required>
            {(field) => (
              <DatePicker needConfirm={false}
                showTime={{ format: 'HH:mm' }}
                format="DD/MM/YYYY HH:mm"
                size="large"
                className="w-full"
                placeholder="Chọn thời gian bắt đầu"
                value={field.value ? dayjs(field.value) : null}
                onBlur={field.onBlur}
                onChange={(value) => {
                  const nextStart = value ? value.format('YYYY-MM-DDTHH:mm') : '';
                  field.onChange(nextStart);
                  if (!eventId || (!getValues('registrationOpenAt') && !getValues('registrationCloseAt'))) {
                    const window = registrationWindowFrom(nextStart);
                    setValue('registrationOpenAt', window.open, { shouldValidate: true });
                    setValue('registrationCloseAt', window.close, { shouldValidate: true });
                  }
                }}
              />
            )}
          </ControlledField>
          <ControlledField name="endDate" control={control} label="Kết thúc" error={errors.endDate?.message} required>
            {(field) => (
              <DatePicker needConfirm={false}
                showTime={{ format: 'HH:mm' }}
                format="DD/MM/YYYY HH:mm"
                size="large"
                className="w-full"
                placeholder="Chọn thời gian kết thúc"
                value={field.value ? dayjs(field.value) : null}
                onBlur={field.onBlur}
                onChange={(value) => field.onChange(value ? value.format('YYYY-MM-DDTHH:mm') : '')}
              />
            )}
          </ControlledField>
          <Col span={24}>
            <Card size="small" className="mb-5 border-sky-500/20 bg-sky-500/[0.03]" title="Cấu hình đăng ký vận động viên">
              <Row gutter={[20, 2]}>
                <Col span={24}>
                  <Form.Item>
                    <Controller
                      name="registrationEnabled"
                      control={control}
                      render={({ field }) => (
                        <Checkbox
                          checked={field.value}
                          onChange={(event) => {
                            field.onChange(event.target.checked);
                            if (event.target.checked && (!getValues('registrationOpenAt') || !getValues('registrationCloseAt'))) {
                              const window = registrationWindowFrom(getValues('startDate'));
                              setValue('registrationOpenAt', window.open, { shouldValidate: true });
                              setValue('registrationCloseAt', window.close, { shouldValidate: true });
                            }
                          }}
                        >
                          Mở đăng ký trực tuyến cho vận động viên
                        </Checkbox>
                      )}
                    />
                  </Form.Item>
                </Col>
                <ControlledField name="registrationOpenAt" control={control} label="Mở đăng ký" error={errors.registrationOpenAt?.message} required={registrationEnabled}>
                  {(field) => (
                    <DatePicker needConfirm={false}
                      showTime={{ format: 'HH:mm' }}
                      format="DD/MM/YYYY HH:mm"
                      size="large"
                      className="w-full"
                      disabled={!registrationEnabled}
                      value={field.value ? dayjs(field.value) : null}
                      onChange={(value) => field.onChange(value ? value.format('YYYY-MM-DDTHH:mm') : '')}
                    />
                  )}
                </ControlledField>
                <ControlledField name="registrationCloseAt" control={control} label="Đóng đăng ký" error={errors.registrationCloseAt?.message} required={registrationEnabled}>
                  {(field) => (
                    <DatePicker needConfirm={false}
                      showTime={{ format: 'HH:mm' }}
                      format="DD/MM/YYYY HH:mm"
                      size="large"
                      className="w-full"
                      disabled={!registrationEnabled}
                      value={field.value ? dayjs(field.value) : null}
                      onChange={(value) => field.onChange(value ? value.format('YYYY-MM-DDTHH:mm') : '')}
                    />
                  )}
                </ControlledField>
                <ControlledField name="paymentMode" control={control} label="Hình thức thanh toán" error={errors.paymentMode?.message}>
                  {(field) => (
                    <Select
                      size="large"
                      className="w-full"
                      value={field.value}
                      onChange={field.onChange}
                      options={[
                        { value: 'FREE', label: 'Miễn phí' },
                        { value: 'MANUAL', label: 'Chuyển khoản VietQR / xác nhận thủ công' },
                        { value: 'ONLINE', label: 'Cổng thanh toán trực tuyến' },
                      ]}
                    />
                  )}
                </ControlledField>
                <ControlledField name="registrationFee" control={control} label="Lệ phí mỗi hạng đấu" error={errors.registrationFee?.message} wide>
                  {(field) => (
                    <div className="w-full max-w-xl">
                      <InputNumber<number>
                        size="large"
                        className="w-full"
                        style={{ width: '100%' }}
                        min={0}
                        step={10000}
                        precision={0}
                        formatter={formatVnd}
                        parser={parseVnd}
                        disabled={paymentMode === 'FREE'}
                        value={field.value}
                        onChange={(value) => field.onChange(value || 0)}
                        addonAfter="VND"
                      />
                    </div>
                  )}
                </ControlledField>
              </Row>
              <p className="mb-0 text-xs text-slate-500">Khung mặc định mở trước sự kiện 30 ngày và đóng lúc 23:59 ngày liền trước sự kiện; bạn vẫn có thể điều chỉnh thủ công.</p>
            </Card>
          </Col>
          <ControlledField name="bannerUrl" control={control} label="Banner sự kiện" error={errors.bannerUrl?.message}>
            {(field) => (
              <EventImageUpload
                kind="banner"
                value={field.value}
                file={bannerFile}
                onFileChange={(file) => {
                  setBannerFile(file);
                  setBannerRemoved(false);
                  if (file) field.onChange('');
                }}
                onRemove={() => {
                  setBannerFile(undefined);
                  setBannerRemoved(true);
                  field.onChange('');
                }}
                onError={toast.error}
              />
            )}
          </ControlledField>
          <ControlledField name="logoUrl" control={control} label="Logo sự kiện" error={errors.logoUrl?.message}>
            {(field) => (
              <EventImageUpload
                kind="logo"
                value={field.value}
                file={logoFile}
                onFileChange={(file) => {
                  setLogoFile(file);
                  setLogoRemoved(false);
                  if (file) field.onChange('');
                }}
                onRemove={() => {
                  setLogoFile(undefined);
                  setLogoRemoved(true);
                  field.onChange('');
                }}
                onError={toast.error}
              />
            )}
          </ControlledField>
          <ControlledField name="description" control={control} label="Mô tả" error={errors.description?.message} wide>
            {(field) => <Input.TextArea {...field} rows={5} placeholder="Thông tin giới thiệu sự kiện" />}
          </ControlledField>
          <Col span={24}>
            <Form.Item className="mb-0">
              <Controller
                name="isPublished"
                control={control}
                render={({ field }) => (
                  <Checkbox checked={field.value} onChange={(event) => field.onChange(event.target.checked)}>
                    Công khai sự kiện trên trang người dùng
                  </Checkbox>
                )}
              />
            </Form.Item>
          </Col>
        </Row>
      </Card>
      <FormActions pending={isSubmitting} label={eventId ? 'Lưu thay đổi' : 'Tạo sự kiện'} cancelHref={eventId ? returnTo : '/cms/events'} />
    </Form>
  );
}

function CategoryGroupedSelect({
  sports,
  categories,
  value = [],
  onChange,
}: {
  sports: any[];
  categories: any[];
  value?: string[];
  onChange: (value: string[]) => void;
}) {
  if (!sports.length) {
    return (
      <Select
        disabled
        size="large"
        className="w-full"
        placeholder="Chọn bộ môn trước"
      />
    );
  }

  return (
    <div className={`grid grid-cols-1 gap-3 ${sports.length > 1 ? 'xl:grid-cols-2' : ''}`}>
      {sports.map((sport) => {
        const sportCategories = categories.filter((category) => category.sportId === sport.id);
        const sportCategoryIds = new Set(sportCategories.map((category) => category.id));
        const selectedIds = value.filter((categoryId) => sportCategoryIds.has(categoryId));
        const replaceSportSelection = (nextIds: string[]) => {
          onChange([
            ...value.filter((categoryId) => !sportCategoryIds.has(categoryId)),
            ...nextIds,
          ]);
        };

        return (
          <div
            key={sport.id}
            className="event-category-card"
          >
            <div className="event-category-heading">
              <strong className="min-w-0 flex-1 truncate text-sm">
                {sport.name}
              </strong>
              <span className="event-category-count">
                {selectedIds.length}/{sportCategories.length} đã chọn
              </span>
              <button
                type="button"
                className="event-select-all"
                disabled={!sportCategories.length}
                onClick={() => replaceSportSelection(
                  selectedIds.length === sportCategories.length
                    ? []
                    : sportCategories.map((category) => category.id),
                )}
              >
                {selectedIds.length === sportCategories.length ? 'Bỏ chọn' : 'Chọn tất cả'}
              </button>
            </div>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              size="large"
              className="w-full"
              maxTagCount={1}
              maxTagTextLength={28}
              maxTagPlaceholder={() => `+${Math.max(0, selectedIds.length - 1)} hạng mục`}
              placeholder={sportCategories.length ? 'Chọn hạng mục' : 'Chưa có hạng mục'}
              disabled={!sportCategories.length}
              value={selectedIds}
              onChange={replaceSportSelection}
              options={sportCategories.map((category) => ({
                value: category.id,
                label: category.name,
              }))}
            />
          </div>
        );
      })}
    </div>
  );
}

function useObjectUrl(file?: File) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) {
      setUrl('');
      return undefined;
    }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return url;
}

function EventImageUpload({
  kind,
  value,
  file,
  onFileChange,
  onRemove,
  onError,
}: {
  kind: 'banner' | 'logo';
  value?: string;
  file?: File;
  onFileChange: (file?: File) => void;
  onRemove: () => void;
  onError: (message: string) => void;
}) {
  const objectUrl = useObjectUrl(file);
  const previewUrl = objectUrl || value;
  const label = kind === 'banner' ? 'banner' : 'logo';

  return (
    <div className={`event-image-upload event-image-upload--${kind}`}>
      <div className="event-image-preview">
        {previewUrl ? (
          <Image src={imageUrl(previewUrl, 'card')} alt={`Ảnh ${label} sự kiện`} preview={false} />
        ) : (
          <div className="event-image-empty">
            <ImagePlus className="h-6 w-6" />
            <span>Chưa có {label}</span>
          </div>
        )}
      </div>
      <div className="event-image-actions">
        <Upload
          accept="image/jpeg,image/png,image/webp"
          showUploadList={false}
          beforeUpload={(selectedFile) => {
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(selectedFile.type)) {
              onError('Ảnh chỉ hỗ trợ định dạng JPG, PNG hoặc WebP.');
              return Upload.LIST_IGNORE;
            }
            if (selectedFile.size > 6 * 1024 * 1024) {
              onError('Ảnh không được vượt quá 6 MB.');
              return Upload.LIST_IGNORE;
            }
            onFileChange(selectedFile);
            return false;
          }}
        >
          <Button htmlType="button" icon={<ImagePlus className="h-4 w-4" />}>
            {previewUrl ? 'Thay ảnh' : 'Tải ảnh lên'}
          </Button>
        </Upload>
        {previewUrl && (
          <Button
            htmlType="button"
            danger
            type="text"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={onRemove}
          >
            Xóa
          </Button>
        )}
        <span>JPG, PNG hoặc WebP · tối đa 6 MB</span>
      </div>
    </div>
  );
}

function ControlledField({ name, control, label, error, children, wide = false, required = false }: { name: keyof EventFormValues; control: any; label: string; error?: string; children: (field: any) => React.ReactElement; wide?: boolean; required?: boolean }) {
  return (
    <Col xs={24} md={wide ? 24 : 12}>
      <Form.Item label={label} validateStatus={error ? 'error' : undefined} help={error} required={required}>
        <Controller name={name} control={control} render={({ field }) => children(field)} />
      </Form.Item>
    </Col>
  );
}
