'use client';

import { ToastNotice } from '@/components/ToastNotice';

import { ProtectedImage } from '@/components/ProtectedImage';

import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import dayjs, { type Dayjs } from 'dayjs';
import { Avatar, Button, Card, Col, DatePicker, Empty, Form, Input, InputNumber, Modal, Row, Segmented, Select, Spin, Tag, Upload } from 'antd';
import { CreditCard, Download, Eye, FileCheck2, FileText, ImagePlus, Pencil, Save, ScanText, TicketCheck, UploadCloud, UserRound } from 'lucide-react';
import { CameraCaptureButton } from '@/components/CameraCaptureButton';
import { IssuedAthleteTicket } from '@/components/IssuedAthleteTicket';
import { distinctAthleteTickets, isTicketIssued } from '@/lib/athlete-tickets';
import type { TicketDesign } from '@/lib/ticket-design';
import { IdentityOcrReviewModal, type IdentityOcrFields, type IdentityOcrResult } from '@/components/IdentityOcrReviewModal';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { fetcher } from '@/lib/api';
import { clearParticipantSession, getParticipantAccount, getParticipantToken, participantApi, participantError, setParticipantSession } from '@/lib/participant-auth';
import { accountTypeLabel, type SportDataAccountType } from '@/lib/sportdata-account-types';
import { TeamAccountPanel } from '@/components/TeamAccountPanel';
import { MyEventParticipations } from '@/components/MyEventParticipations';
import type { TicketStatistics } from '@/lib/ticket-types';

type MediaType = 'AVATAR' | 'CCCD_FRONT' | 'CCCD_BACK' | 'PASSPORT';
type UploadRequestOption = Parameters<NonNullable<ComponentProps<typeof Upload>['customRequest']>>[0];
type Profile = {
  hasAthleteProfile?: boolean;
  accountTypes: SportDataAccountType[];
  federationId?: string | null;
  id: string;
  email: string;
  displayName: string;
  phone?: string | null;
  createdAt: string;
  athlete: {
    id: string;
    fullName: string;
    birthDate?: string | null;
    gender: string;
    weight?: number | null;
    height?: number | null;
    photoUrl?: string | null;
    country: { id: string; name: string; code: string };
    federation?: { id: string; name: string } | null;
    media: {
      type: MediaType;
      mimeType: string;
      size: number;
      verificationStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
      verificationNote?: string | null;
      ocrStatus?: 'NOT_REQUESTED' | 'PENDING' | 'COMPLETED' | 'FAILED';
      ocrProvider?: string | null;
      ocrConfidence?: number | null;
      ocrData?: { userConfirmed?: boolean; confirmedFields?: IdentityOcrFields; message?: string } | null;
      updatedAt: string;
    }[];
  };
};
type Country = { id: string; code: string; name: string };
type Federation = { id: string; name: string; countryId: string };
type ProfileFormValues = {
  displayName: string;
  phone?: string;
  birthDate: Dayjs;
  gender: string;
  countryId: string;
  federationId?: string;
  weight?: number;
  height?: number;
};
type MediaAsset = { url: string; mimeType: string };
type Registration = {
  id: string;
  ticketCode: string;
  status: string;
  paymentStatus: string;
  feeAmount: number;
  currency: string;
  createdAt: string;
  event: {
    id: string;
    name: string;
    startDate: string;
    endDate?: string;
    location?: string;
    sport?: { id: string; name: string };
    ticketBackgroundSize?: number | null;
    updatedAt?: string;
    ticketDesign?: TicketDesign | null;
    ticketThemePreset?: string | null;
    ticketLayout?: string | null;
    ticketPrimaryColor?: string | null;
    ticketSecondaryColor?: string | null;
    ticketAccentColor?: string | null;
  };
  category: { id: string; name: string; sport?: { id: string; name: string } };
  athlete: {
    id: string;
    fullName: string;
    birthDate?: string | null;
    gender?: string;
    weight?: number | null;
    country?: { code?: string; name?: string } | null;
    federation?: { name?: string } | null;
    statistics?: Array<TicketStatistics & { eventId?: string | null; sportId: string; categoryId?: string | null }>;
  };
};

const authFetcher = (url: string) => participantApi.get(url).then((response) => response.data);
const emptyMediaItems: Profile['athlete']['media'] = [];
const mediaLabels: Record<MediaType, string> = {
  AVATAR: 'Ảnh đại diện',
  CCCD_FRONT: 'CCCD mặt trước',
  CCCD_BACK: 'CCCD mặt sau',
  PASSPORT: 'Hộ chiếu (nếu có)',
};

export default function ParticipantAccountPage() {
  const router = useRouter();
  const toast = useSportDataToast();
  const [profileForm] = Form.useForm<ProfileFormValues>();
  const [tab, setTab] = useState<'profile' | 'tickets'>('profile');
  const [mediaAssets, setMediaAssets] = useState<Partial<Record<MediaType, MediaAsset>>>({});
  const [ocrReview, setOcrReview] = useState<{ type: MediaType; result: IdentityOcrResult }>();
  const [confirmingOcr, setConfirmingOcr] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const sessionAccount = getParticipantAccount();
  const { data: profile, error, isLoading, mutate } = useSWR<Profile>(
    getParticipantToken() ? '/participant-auth/me' : null,
    authFetcher,
    { shouldRetryOnError: false },
  );
  const { data: registrations = [], mutate: mutateRegistrations } = useSWR<Registration[]>(getParticipantToken() ? '/participant-auth/registrations' : null, authFetcher);
  const ticketRows = distinctAthleteTickets(registrations, (item) => `${item.event.id}:${item.athlete.id}`);
  const { data: countries = [] } = useSWR<Country[]>('/countries', fetcher);
  const { data: federations = [] } = useSWR<Federation[]>('/federations', fetcher);
  const selectedCountryId = Form.useWatch('countryId', profileForm);
  const mediaItems = profile?.athlete.media ?? emptyMediaItems;

  useEffect(() => {
    const token = getParticipantToken();
    const account = getParticipantAccount();
    if (profile && token && account && JSON.stringify(account.accountTypes) !== JSON.stringify(profile.accountTypes)) {
      setParticipantSession(token, { ...account, accountTypes: profile.accountTypes, federationId: profile.federationId });
    }
  }, [profile]);
  const uploadedTypes = useMemo(() => new Set(mediaItems.map((item) => item.type)), [mediaItems]);
  const mediaByType = useMemo(() => new Map(mediaItems.map((item) => [item.type, item])), [mediaItems]);
  const cccdComplete = uploadedTypes.has('CCCD_FRONT') && uploadedTypes.has('CCCD_BACK');
  const identityComplete = cccdComplete || uploadedTypes.has('PASSPORT');
  const identityVerified = (
    mediaByType.get('CCCD_FRONT')?.verificationStatus === 'VERIFIED'
    && mediaByType.get('CCCD_BACK')?.verificationStatus === 'VERIFIED'
  ) || mediaByType.get('PASSPORT')?.verificationStatus === 'VERIFIED';
  const identityRejected = mediaItems.some((item) => item.type !== 'AVATAR' && item.verificationStatus === 'REJECTED');

  useEffect(() => {
    if (!getParticipantToken()) router.replace('/account/login');
  }, [router, sessionAccount?.accountType]);

  useEffect(() => {
    if (error?.response?.status === 401) {
      clearParticipantSession();
      router.replace('/account/login');
    }
  }, [error, router]);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    const loadMedia = async () => {
      const entries = await Promise.all(mediaItems.map(async (item) => {
        try {
          const response = await participantApi.get(`/participant-auth/me/media/${item.type}`, { responseType: 'blob', params: { variant: 'card' } });
          const url = URL.createObjectURL(response.data);
          objectUrls.push(url);
          return [item.type, { url, mimeType: item.mimeType }] as const;
        } catch {
          return null;
        }
      }));
      if (!cancelled) {
        setMediaAssets(Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))));
      }
    };

    void loadMedia();
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [mediaItems]);

  const upload = async (type: MediaType, file: File) => {
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await participantApi.post<{ ocr?: IdentityOcrResult }>(`/participant-auth/me/media/${type}`, form);
      if (type !== 'AVATAR' && response.data.ocr?.status === 'COMPLETED') {
        setOcrReview({ type, result: response.data.ocr });
        toast.success('Đã đọc dữ liệu. Vui lòng kiểm tra và xác nhận thông tin trên giấy tờ.');
      } else if (type !== 'AVATAR' && response.data.ocr?.message) {
        toast.warning(response.data.ocr.message);
      } else {
        toast.success(`Đã cập nhật ${mediaLabels[type].toLowerCase()}.`);
      }
      await Promise.all([mutate(), mutateRegistrations()]);
    } catch (requestError) {
      toast.error(participantError(requestError, 'Tải tệp thất bại'));
    }
  };

  const confirmOcr = async (fields: IdentityOcrFields, applyToProfile: boolean) => {
    if (!ocrReview) return;
    setConfirmingOcr(true);
    try {
      await participantApi.patch(`/participant-auth/me/media/${ocrReview.type}/ocr-confirm`, { ...fields, applyToProfile });
      setOcrReview(undefined);
      toast.success('Đã lưu thông tin bạn xác nhận. Giấy tờ vẫn chờ CMS/eKYC xác thực.');
      await mutate();
    } catch (requestError) {
      toast.error(participantError(requestError, 'Không thể xác nhận dữ liệu OCR'));
    } finally {
      setConfirmingOcr(false);
    }
  };

  const customUpload = (type: MediaType) => async (options: UploadRequestOption) => {
    await upload(type, options.file as File);
    options.onSuccess?.({});
  };

  const openProfileEditor = () => {
    profileForm.setFieldsValue({
      displayName: profile!.athlete.fullName,
      phone: profile!.phone || undefined,
      birthDate: profile!.athlete.birthDate ? dayjs(profile!.athlete.birthDate) : undefined,
      gender: profile!.athlete.gender,
      countryId: profile!.athlete.country.id,
      federationId: profile!.athlete.federation?.id,
      weight: profile!.athlete.weight ?? undefined,
      height: profile!.athlete.height ?? undefined,
    });
    setEditingProfile(true);
  };

  const saveProfile = async (values: ProfileFormValues) => {
    setSavingProfile(true);
    try {
      const { data } = await participantApi.patch<Profile>('/participant-auth/me', {
        ...values,
        phone: values.phone?.trim() || '',
        birthDate: values.birthDate.format('YYYY-MM-DD'),
        federationId: values.federationId || null,
      });
      const token = getParticipantToken();
      if (token && sessionAccount) {
        setParticipantSession(token, { ...sessionAccount, displayName: data.displayName });
      }
      await Promise.all([mutate(data, false), mutateRegistrations()]);
      setEditingProfile(false);
      toast.success('Đã cập nhật thông tin tài khoản.');
    } catch (requestError) {
      toast.error(participantError(requestError, 'Không thể cập nhật thông tin tài khoản'));
    } finally {
      setSavingProfile(false);
    }
  };

  if (isLoading || (!profile && !error)) {
    return <main className="grid min-h-[60vh] place-items-center"><Spin size="large" /></main>;
  }

  if (!profile) {
    return (
      <main className="account-gateway-page grid min-h-[60vh] place-items-center px-4 py-10">
        <Card className="w-full max-w-lg" title="Không thể tải hồ sơ SportData">
          <ToastNotice
            showIcon
            type="error"
            message="Tài khoản chưa được liên kết với hồ sơ vận động viên"
            description="Vui lòng đăng nhập lại. Nếu lỗi vẫn còn, quản trị viên cần kiểm tra và khôi phục liên kết giữa tài khoản và hồ sơ vận động viên."
          />
          <Button
            block
            className="mt-5"
            type="primary"
            onClick={() => {
              clearParticipantSession();
              router.replace('/account/login');
            }}
          >
            Đăng nhập lại
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="participant-account-page min-h-screen px-4 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar
              size={72}
              icon={<UserRound />}
              src={mediaAssets.AVATAR?.url}
            />
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-sky-400">Tài khoản SportData</p>
              <h1 className="text-3xl font-black text-white">{profile.displayName}</h1>
              <p className="text-slate-400">{profile.email}</p>
              <div className="mt-2 flex flex-wrap gap-1">{profile.accountTypes.map((type) => <Tag key={type} color="blue">{accountTypeLabel(type)}</Tag>)}</div>
            </div>
          </div>
        </header>

        {profile.accountTypes.includes('TEAM_LEADER') && profile.federationId && <TeamAccountPanel />}
        <MyEventParticipations />

        <Segmented
          className="mb-6"
          value={tab}
          onChange={(value) => setTab(value as typeof tab)}
          options={[
            { value: 'profile', label: 'Thông tin & giấy tờ', icon: <CreditCard className="h-4 w-4" /> },
            { value: 'tickets', label: `Thẻ & hồ sơ đã đăng ký (${ticketRows.length})`, icon: <TicketCheck className="h-4 w-4" /> },
          ]}
        />

        {tab === 'profile' ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
            <Card
              title="Thông tin chi tiết tài khoản"
              extra={<Button type="text" icon={<Pencil className="h-4 w-4" />} onClick={openProfileEditor}>Chỉnh sửa</Button>}
            >
              <dl className="space-y-4 text-sm">
                <div><dt className="text-slate-500">Họ và tên</dt><dd className="font-semibold text-slate-100">{profile.athlete.fullName}</dd></div>
                <div><dt className="text-slate-500">Email</dt><dd className="break-all font-semibold text-slate-100">{profile.email}</dd></div>
                <div><dt className="text-slate-500">Số điện thoại</dt><dd className="font-semibold text-slate-100">{profile.phone || 'Chưa cập nhật'}</dd></div>
                <div><dt className="text-slate-500">Ngày sinh</dt><dd className="font-semibold text-slate-100">{profile.athlete.birthDate ? new Date(profile.athlete.birthDate).toLocaleDateString('vi-VN') : 'Chưa cập nhật'}</dd></div>
                <div><dt className="text-slate-500">Giới tính</dt><dd className="font-semibold text-slate-100">{profile.athlete.gender === 'FEMALE' ? 'Nữ' : profile.athlete.gender === 'MALE' ? 'Nam' : 'Khác'}</dd></div>
                <div><dt className="text-slate-500">Quốc gia</dt><dd className="font-semibold text-slate-100">{profile.athlete.country.name}</dd></div>
                <div><dt className="text-slate-500">Ngày tạo tài khoản</dt><dd className="font-semibold text-slate-100">{new Date(profile.createdAt).toLocaleDateString('vi-VN')}</dd></div>
                <div className="border-t border-white/10 pt-4">
                  <dt className="text-slate-500">Đơn vị/CLB tham gia</dt>
                  <dd className="font-semibold text-slate-100">{profile.athlete.federation?.name || 'Chưa liên kết'}</dd>
                </div>
                {profile.athlete.weight != null && <div><dt className="text-slate-500">Cân nặng đăng ký</dt><dd className="font-semibold text-slate-100">{profile.athlete.weight} kg</dd></div>}
                {profile.athlete.height != null && <div><dt className="text-slate-500">Chiều cao</dt><dd className="font-semibold text-slate-100">{profile.athlete.height} cm</dd></div>}
              </dl>
            </Card>
            {profile.hasAthleteProfile === false ? (
              <Card title="Thông tin Tài khoản SportData">
                <p className="text-slate-400">Thông tin cá nhân và các loại tài khoản đã được lưu. Bạn có thể chọn sự kiện để gửi hồ sơ đăng ký VĐV cho bản thân hoặc cho người khác.</p>
                <Link href="/events"><Button className="mt-4" type="primary">Xem sự kiện và đăng ký</Button></Link>
              </Card>
            ) : <Card
              title="Ảnh và giấy tờ xác minh"
              extra={identityVerified
                ? <Tag color="success">Đã xác thực</Tag>
                : identityRejected
                  ? <Tag color="error">Cần tải lại</Tag>
                  : identityComplete
                    ? <Tag color="processing">Chờ xác thực</Tag>
                    : <Tag color="warning">Thiếu giấy tờ</Tag>}
            >
              <p className="mb-5 text-sm text-slate-400">Tải lên không đồng nghĩa đã xác thực. CCCD hai mặt hoặc hộ chiếu phải được OCR/CMS đối chiếu trước khi hồ sơ được duyệt.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {(Object.keys(mediaLabels) as MediaType[]).map((type) => {
                  const asset = mediaAssets[type];
                  const media = mediaByType.get(type);
                  const isPdf = asset?.mimeType === 'application/pdf';
                  return (
                    <div key={type} className="overflow-hidden rounded-xl border border-white/10">
                      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                        <span className="font-semibold text-slate-100">{mediaLabels[type]}</span>
                        {!uploadedTypes.has(type)
                          ? <Tag>Chưa tải lên</Tag>
                          : type === 'AVATAR'
                            ? <Tag color="blue">Đã tải lên</Tag>
                            : media?.verificationStatus === 'VERIFIED'
                              ? <Tag color="success" icon={<FileCheck2 className="h-3 w-3" />}>Đã xác thực</Tag>
                              : media?.verificationStatus === 'REJECTED'
                                ? <Tag color="error">Bị từ chối</Tag>
                                : media?.ocrData?.userConfirmed
                                  ? <Tag color="cyan" icon={<ScanText className="h-3 w-3" />}>Đã xác nhận OCR</Tag>
                                  : media?.ocrStatus === 'COMPLETED'
                                    ? <Tag color="blue">Đã đọc OCR</Tag>
                                    : <Tag color="processing">Chờ xác thực</Tag>}
                      </div>
                      <div className="grid h-44 place-items-center bg-black/20">
                        {asset && !isPdf ? (
                          <div className="h-full w-full [&_.ant-image]:block [&_.ant-image]:h-full [&_.ant-image]:w-full">
                            <ProtectedImage
                              endpoint={`/participant-auth/me/media/${type}`}
                              client={participantApi}
                              src={asset.url}
                              alt={mediaLabels[type]}
                              className="!h-44 !w-full object-contain"
                              preview={{ mask: <span className="flex items-center gap-2"><Eye className="h-4 w-4" /> Xem ảnh</span> }}
                            />
                          </div>
                        ) : asset && isPdf ? (
                          <div className="text-center">
                            <FileText className="mx-auto mb-2 h-10 w-10 text-sky-400" />
                            <Button href={asset.url} target="_blank" icon={<Eye className="h-4 w-4" />}>Mở tệp PDF</Button>
                          </div>
                        ) : (
                          <div className="text-center text-slate-500">
                            {type === 'AVATAR' ? <UserRound className="mx-auto mb-2 h-10 w-10" /> : <CreditCard className="mx-auto mb-2 h-10 w-10" />}
                            <span className="text-sm">Chưa tải lên</span>
                          </div>
                        )}
                      </div>
                      {media?.verificationStatus === 'REJECTED' && media.verificationNote && (
                        <p className="px-4 pt-3 text-xs text-red-400">Lý do: {media.verificationNote}</p>
                      )}
                      <div className="flex flex-wrap gap-2 p-4">
                        <Upload accept={type === 'AVATAR' ? 'image/*' : 'image/*,application/pdf'} showUploadList={false} customRequest={customUpload(type)}>
                          <Button icon={type === 'AVATAR' ? <ImagePlus className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}>Chọn tệp</Button>
                        </Upload>
                        <CameraCaptureButton
                          facingMode={type === 'AVATAR' ? 'user' : 'environment'}
                          onCapture={(file) => upload(type, file)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>}
          </div>
        ) : registrations.length ? (
          <div className="mx-auto max-w-4xl space-y-7">
            {ticketRows.map((registration) => {
              const ticketIssued = isTicketIssued(registration);
              return (
              <div key={registration.id}>
                {ticketIssued ? (
                  <IssuedAthleteTicket code={registration.ticketCode} />
                ) : (
                  <Card className="border-sky-500/20">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-[0.12em] text-sky-500">Hồ sơ đăng ký</span>
                        <h2 className="mt-1 text-lg font-bold">{registration.event.name}</h2>
                        <p className="mt-2 text-sm text-slate-500">
                          {registration.category.name} · Mã hồ sơ {registration.ticketCode}
                        </p>
                      </div>
                      <Tag color={registration.status === 'REJECTED' ? 'error' : registration.status === 'CANCELLED' ? 'default' : 'processing'}>
                        {registration.status === 'REJECTED'
                          ? 'Hồ sơ bị từ chối'
                          : registration.status === 'CANCELLED'
                            ? 'Hồ sơ đã hủy'
                            : 'Chờ duyệt hồ sơ'}
                      </Tag>
                    </div>
                    <p className="mt-4 text-sm text-slate-500">
                      Thẻ và mã QR check-in chỉ được phát hành sau khi hồ sơ được duyệt.
                    </p>
                  </Card>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-2">
                  <p className="text-xs text-slate-500">
                    Thanh toán: {registration.paymentStatus === 'NOT_REQUIRED'
                      ? 'Miễn phí · Không cần thanh toán'
                      : registration.paymentStatus === 'PAID'
                        ? 'Đã thanh toán'
                        : registration.paymentStatus === 'FAILED'
                          ? 'Thanh toán chưa thành công'
                          : 'Chờ thanh toán'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/tickets/${encodeURIComponent(registration.ticketCode)}`} target="_blank">
                      <Button icon={<Eye className="h-4 w-4" />}>{ticketIssued ? 'Xem thẻ' : 'Theo dõi hồ sơ'}</Button>
                    </Link>
                    {ticketIssued ? (
                      <Button href={`/api/participant-auth/tickets/${encodeURIComponent(registration.ticketCode)}/pdf`} icon={<Download className="h-4 w-4" />}>Tải PDF</Button>
                    ) : null}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          <Card><Empty description="Bạn chưa có thẻ tham dự nào" /></Card>
        )}
      </div>
      <Modal
        open={editingProfile}
        title="Chỉnh sửa thông tin tài khoản"
        footer={null}
        destroyOnHidden
        onCancel={() => setEditingProfile(false)}
      >
        <Form<ProfileFormValues>
          form={profileForm}
          layout="vertical"
          requiredMark={false}
          onFinish={saveProfile}
        >
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="displayName" label="Họ và tên" rules={[{ required: true, min: 2, message: 'Vui lòng nhập họ và tên' }]}>
                <Input autoComplete="name" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="phone" label="Số điện thoại">
                <Input autoComplete="tel" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="birthDate" label="Ngày sinh" rules={[{ required: true, message: 'Vui lòng chọn ngày sinh' }]}>
                <DatePicker className="w-full" format="DD/MM/YYYY" disabledDate={(date) => date.isAfter(dayjs(), 'day')} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="gender" label="Giới tính" rules={[{ required: true, message: 'Vui lòng chọn giới tính' }]}>
                <Select options={[
                  { value: 'MALE', label: 'Nam' },
                  { value: 'FEMALE', label: 'Nữ' },
                  { value: 'OTHER', label: 'Khác' },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="countryId" label="Quốc gia" rules={[{ required: true, message: 'Vui lòng chọn quốc gia' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  onChange={() => profileForm.setFieldValue('federationId', undefined)}
                  options={countries.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="federationId" label="Đơn vị / CLB tham gia">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Để trống nếu chưa liên kết"
                  options={federations
                    .filter((item) => item.countryId === selectedCountryId)
                    .map((item) => ({ value: item.id, label: item.name }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="weight" label="Cân nặng (kg)" rules={[{ type: 'number', min: 1, max: 500, message: 'Cân nặng phải từ 1 đến 500 kg' }]}>
                <InputNumber className="w-full" min={1} max={500} step={0.1} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="height" label="Chiều cao (cm)" rules={[{ type: 'number', min: 1, max: 300, message: 'Chiều cao phải từ 1 đến 300 cm' }]}>
                <InputNumber className="w-full" min={1} max={300} step={0.1} />
              </Form.Item>
            </Col>
          </Row>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditingProfile(false)}>Hủy</Button>
            <Button type="primary" htmlType="submit" loading={savingProfile} icon={<Save className="h-4 w-4" />}>Lưu thay đổi</Button>
          </div>
        </Form>
      </Modal>
      <IdentityOcrReviewModal
        open={Boolean(ocrReview)}
        result={ocrReview?.result}
        loading={confirmingOcr}
        onCancel={() => setOcrReview(undefined)}
        onConfirm={confirmOcr}
      />
    </main>
  );
}
