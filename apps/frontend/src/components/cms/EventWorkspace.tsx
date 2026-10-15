'use client';

import { ToastNotice } from '@/components/ToastNotice';

import { imageUrl } from '@/lib/image-url';

import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { DateTimeFields } from '@/components/DateTimeFields';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import useSWR, { useSWRConfig } from 'swr';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Upload,
  Tooltip,
} from 'antd';
import type { UploadProps } from 'antd';
import type { ColumnType } from 'antd/es/table';
import {
  BadgeDollarSign,
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  Images,
  List,
  MapPin,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  TicketCheck,
  Trash2,
  UploadCloud,
  UserRound,
} from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { EventParticipationTickets } from './EventParticipationTickets';
import { EventPersonnelTab } from './EventPersonnelTab';
import { optimizeRegistrationMedia } from '@/lib/registration-media';
import { MatchSchedulingWorkspace } from './scheduling/MatchSchedulingWorkspace';
import { navigateSchedule } from './scheduling/schedule-ui';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { ticketDesign, validateTicketDesign, type TicketDesign } from '@/lib/ticket-design';
import type { BracketDraw } from '@/components/brackets/SportdataBracket';
import type { ParticipationTicket } from '@/lib/ticket-types';
import { eventRoleLabel } from '@/lib/event-participation';
import { DrawPreconfiguration } from '@/components/cms/DrawPreconfiguration';
import { AthleteQuickViewModal } from '@/components/cms/AthleteQuickViewModal';
import { RemoteAthleteSelect } from '@/components/cms/RemoteAthleteSelect';
import { ExistingAthleteRegistrationPicker, type SelectedRegistrationAthlete, type BatchRegistrationResult } from '@/components/cms/ExistingAthleteRegistrationPicker';
import { withCmsReturnTo } from '@/lib/cms-navigation';
import { MATCH_STATUS_META } from '@/lib/vi-labels';
import { registrationDisciplineKey, registrationDisciplineLabel, type RegistrationCategory } from '@/lib/registration-table';

const TicketDesignEditor = dynamic(() => import('@/components/cms/TicketDesignEditor').then((module) => module.TicketDesignEditor), { ssr: false });
const SportdataBracket = dynamic(() => import('@/components/brackets/SportdataBracket').then((module) => module.SportdataBracket), { ssr: false });

type EventWorkspaceProps = {
  event: any;
  onRefresh: () => Promise<any>;
};

type Registration = {
  teamId?: string | null;
  isPairPayer?: boolean;
  team?: { members: { athlete: { id: string; fullName: string } }[]; registrations: { status: string; paymentStatus: string }[] } | null;
  id: string;
  ticketCode: string;
  status: string;
  paymentStatus: string;
  feeAmount: number;
  currency: string;
  statusReason?: string | null;
  paymentStatusReason?: string | null;
  createdAt?: string;
  event: { id: string; name: string };
  category: RegistrationCategory;
  athlete: {
    id: string;
    fullName: string;
    gender: 'MALE' | 'FEMALE' | 'MIXED';
    email?: string | null;
    phone?: string | null;
    photoUrl?: string | null;
    weight?: number;
    country?: { code: string };
    federation?: { name: string };
    media: Array<{ type: string; verificationStatus?: string | null }>;
  };
  submission?: {
    type: string;
    organizationName?: string | null;
    contactName: string;
    contactEmail?: string | null;
    contactPhone?: string | null;
    referenceCode: string;
    createdAt?: string;
  } | null;
  account?: { displayName: string; email: string; phone?: string | null } | null;
  paymentTransactions?: Array<{
    orderId: string;
    provider: 'MOMO' | 'VNPAY' | 'BANK_QR' | 'VISA';
    status: string;
    amount: number;
    currency: string;
    createdAt: string;
  }>;
  competitionEntry?: { id: string; seed?: number | null; status: string } | null;
};

type RegistrationFilters = Partial<Record<'athlete' | 'category' | 'seed' | 'documents' | 'source' | 'payment' | 'ticketCode' | 'status', string>>;

type RegistrationIdentityDocument = 'CCCD_FRONT' | 'CCCD_BACK' | 'PASSPORT';

const paymentStatusLabels: Record<string, { label: string; color: string }> = {
  NOT_REQUIRED: { label: 'Miễn thanh toán', color: 'success' },
  PENDING: { label: 'Chờ thanh toán', color: 'processing' },
  PAID: { label: 'Đã duyệt', color: 'success' },
  FAILED: { label: 'Thanh toán thất bại', color: 'error' },
};

const registrationStatusLabels: Record<string, { label: string; color: string }> = {
  SUBMITTED: { label: 'Chờ duyệt', color: 'processing' },
  CONFIRMED: { label: 'Đã xác nhận', color: 'success' },
  REJECTED: { label: 'Từ chối', color: 'error' },
  CANCELLED: { label: 'Đã hủy', color: 'default' },
};

const paymentModeOptions = [
  { value: 'FREE', label: 'Miễn phí' },
  { value: 'MANUAL', label: 'Chuyển khoản QR · đối soát thủ công' },
  { value: 'ONLINE', label: 'Cổng thanh toán trực tuyến' },
];

const paymentProviderOptions = [
  { value: 'MOMO', label: 'Ví MoMo' },
  { value: 'VNPAY', label: 'VNPAY QR / ngân hàng' },
  { value: 'VISA', label: 'Visa / Mastercard qua VNPAY' },
  { value: 'BANK_QR', label: 'Chuyển khoản VietQR' },
];

const eventTabKeys = ['overview', 'registrations', 'personnel', 'fops', 'matches', 'payment', 'ticket', 'bracket'] as const;
type EventTabKey = typeof eventTabKeys[number];

function SeedInput({ value, disabled, onSave }: { value?: number | null; disabled?: boolean; onSave: (value: number | null) => void }) {
  const [draft, setDraft] = useState<number | null>(value ?? null);
  useEffect(() => setDraft(value ?? null), [value]);
  return (
    <InputNumber
      min={1}
      precision={0}
      value={draft}
      disabled={disabled}
      placeholder="Seed"
      className="w-full"
      onChange={(nextValue) => setDraft(nextValue == null ? null : Number(nextValue))}
      onBlur={() => {
        if ((draft ?? null) !== (value ?? null)) onSave(draft);
      }}
      onPressEnter={(event) => event.currentTarget.blur()}
    />
  );
}

function IdentityDocumentPicker({
  file,
  label,
  required,
  onChange,
  onError,
}: {
  file?: File;
  label: string;
  required?: boolean;
  onChange: (file?: File) => void;
  onError: (message: string) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string>();

  useEffect(() => {
    if (!file) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isPdf = file?.type === 'application/pdf';
  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-300/15 p-3">
      <div className="mb-2 text-sm font-semibold">{required && <span className="mr-1 text-red-500">*</span>}{label}</div>
      {file && previewUrl ? (
        <div className="mb-3 overflow-hidden rounded-lg border border-slate-300/15 bg-slate-950/30">
          {isPdf ? (
            <iframe src={`${previewUrl}#toolbar=0&navpanes=0`} title={`Xem trước ${label}`} className="h-36 w-full bg-white" />
          ) : <Image src={previewUrl} alt={`Xem trước ${label}`} width="100%" height={144} className="object-contain" />}
        </div>
      ) : (
        <div className="mb-3 grid h-36 place-items-center rounded-lg border border-dashed border-slate-300/20 bg-slate-950/20 px-3 text-center text-xs text-slate-500">
          Ảnh xem trước sẽ hiển thị tại đây
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <Upload
          accept="image/jpeg,image/png,image/webp,application/pdf"
          showUploadList={false}
          beforeUpload={(nextFile) => {
            if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(nextFile.type)) {
              onError(`${label} chỉ hỗ trợ JPG, PNG, WebP hoặc PDF.`);
              return Upload.LIST_IGNORE;
            }
            if (nextFile.size > 4 * 1024 * 1024) {
              onError(`${label} không được vượt quá 4 MB.`);
              return Upload.LIST_IGNORE;
            }
            onChange(nextFile);
            return false;
          }}
        >
          <Button icon={<UploadCloud className="h-4 w-4" />}>{file ? 'Thay tệp' : 'Chọn tệp'}</Button>
        </Upload>
        {file && <Button danger type="text" icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(undefined)}>Xóa</Button>}
      </div>
      <div className="mt-2 truncate text-xs text-slate-500" title={file?.name}>
        {file?.name || 'JPG, PNG, WebP hoặc PDF'}
      </div>
    </div>
  );
}

function AthleteAvatarPicker({ file, onChange, onError }: { file?: File; onChange: (file?: File) => void; onError: (message: string) => void }) {
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => {
    if (!file) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className="mt-4 flex flex-col gap-4 rounded-xl border border-slate-300/15 p-4 sm:flex-row sm:items-center">
      <Avatar size={96} src={previewUrl} icon={<UserRound className="h-9 w-9" />} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold"><span className="mr-1 text-red-500">*</span>Ảnh đại diện vận động viên</div>
        <div className="mt-1 text-xs text-slate-500">Ảnh chân dung JPG, PNG hoặc WebP · tối đa 8 MB</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Upload
            accept="image/jpeg,image/png,image/webp"
            showUploadList={false}
            beforeUpload={(nextFile) => {
              if (!['image/jpeg', 'image/png', 'image/webp'].includes(nextFile.type)) {
                onError('Ảnh đại diện chỉ hỗ trợ JPG, PNG hoặc WebP.');
                return Upload.LIST_IGNORE;
              }
              if (nextFile.size > 8 * 1024 * 1024) {
                onError('Ảnh đại diện không được vượt quá 8 MB.');
                return Upload.LIST_IGNORE;
              }
              onChange(nextFile);
              return false;
            }}
          >
            <Button icon={<UploadCloud className="h-4 w-4" />}>{file ? 'Thay ảnh' : 'Chọn ảnh'}</Button>
          </Upload>
          {file && <Button danger type="text" icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(undefined)}>Xóa</Button>}
        </div>
        {file && <div className="mt-2 truncate text-xs text-slate-500" title={file.name}>{file.name}</div>}
      </div>
    </div>
  );
}

export function EventWorkspace({ event, onRefresh }: EventWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: currentUser } = useSWR<any>('/auth/profile', fetcher);
  const canEditEvent = ['ADMIN', 'CONTENT', 'GAMES_ADMIN'].includes(currentUser?.role);
  const canScore = ['ADMIN', 'GAMES_ADMIN'].includes(currentUser?.role);
  const canOperate = ['ADMIN', 'GAMES_ADMIN'].includes(currentUser?.role);
  const canConfirmPayment = ['ADMIN', 'GAMES_ADMIN'].includes(currentUser?.role);
  const requestedTab = searchParams.get('tab');
  const activeTab: EventTabKey = eventTabKeys.includes(requestedTab as EventTabKey)
    ? requestedTab as EventTabKey
    : 'overview';
  const workspaceHref = (tab: EventTabKey) => `/cms/events/${event.id}?tab=${tab}`;

  const selectTab = (tab: string) => {
    if (!eventTabKeys.includes(tab as EventTabKey)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    navigateSchedule(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  return (
    <Tabs
      activeKey={activeTab}
      onChange={selectTab}
      size="large"
      destroyOnHidden={false}
      items={[
        {
          key: 'overview',
          label: <span className="flex items-center gap-2"><Settings2 className="h-4 w-4" />Tổng quan</span>,
          children: <EventOverview event={event} canEdit={canEditEvent} returnTo={workspaceHref('overview')} />,
        },
        {
          key: 'registrations',
          label: <span className="flex items-center gap-2"><TicketCheck className="h-4 w-4" />Đăng ký thi đấu</span>,
          children: <RegistrationsTab event={event} canOperate={canOperate} canConfirmPayment={canConfirmPayment} />,
        },
        {
          key: 'personnel',
          label: <span className="flex items-center gap-2"><UserRound className="h-4 w-4" />Danh sách Quản lý</span>,
          children: <EventPersonnelTab event={event} canOperate={canOperate} />,
        },
        {
          key: 'fops',
          label: <span className="flex items-center gap-2"><MapPin className="h-4 w-4" />Sàn / FOP</span>,
          children: <FopsTab event={event} canOperate={canOperate} onRefresh={onRefresh} />,
        },
        {
          key: 'matches',
          label: <span className="flex items-center gap-2"><List className="h-4 w-4" />Trận đấu/Sắp xếp</span>,
          children: <MatchesTab event={event} returnTo={workspaceHref('matches')} canOperate={canOperate} canScore={canScore} canEditMatch={canEditEvent || canOperate} canEditBracket={canOperate} />,
        },
        {
          key: 'payment',
          label: <span className="flex items-center gap-2"><CreditCard className="h-4 w-4" />Thanh toán</span>,
          children: <PaymentTab event={event} canEdit={canEditEvent} onRefresh={onRefresh} />,
        },
        {
          key: 'ticket',
          label: <span className="flex items-center gap-2"><Images className="h-4 w-4" />Thẻ</span>,
          children: <TicketDesignTab event={event} canEdit={canEditEvent} onRefresh={onRefresh} />,
        },
        {
          key: 'bracket',
          label: <span className="flex items-center gap-2"><Network className="h-4 w-4" />Thể thức & nhánh đấu</span>,
          children: <BracketTab event={event} canOperate={canOperate} preconfigureActorId={currentUser?.role === 'ADMIN' && currentUser?.permissions?.includes('DRAW_PRECONFIGURE') ? currentUser.id : undefined} />,
        },
      ]}
    />
  );
}

function EventOverview({ event, canEdit, returnTo }: { event: any; canEdit: boolean; returnTo: string }) {
  const { data: registrations } = useSWR<Registration[]>(
    `/participant-auth/admin/registrations?eventId=${event.id}`,
    fetcher,
    { refreshInterval: 10_000 },
  );
  const registrationTotal = registrations?.length ?? event._count?.registrations ?? 0;
  const confirmedTotal = registrations?.filter((item) => item.status === 'CONFIRMED').length ?? 0;
  const waitingTotal = registrations?.filter((item) => item.status === 'SUBMITTED').length ?? 0;
  const paidTotal = registrations?.filter((item) => ['PAID', 'NOT_REQUIRED'].includes(item.paymentStatus)).length ?? 0;
  const operationMetrics = [
    { label: 'Đăng ký', value: registrationTotal, color: 'text-sky-500' },
    { label: 'Đã xác nhận', value: confirmedTotal, color: 'text-emerald-500' },
    { label: 'Chờ xử lý', value: waitingTotal, color: 'text-amber-500' },
    { label: 'Đủ thanh toán', value: paidTotal, color: 'text-teal-500' },
    { label: 'Vận động viên', value: event._count?.athletes || 0, color: 'text-violet-500' },
    { label: 'Trận đấu', value: event._count?.matches || 0, color: 'text-blue-500' },
    { label: 'Hạng đấu', value: event.categories?.length || 0, color: 'text-fuchsia-500' },
    { label: 'Sân / FOP', value: event.fops?.length || 0, color: 'text-cyan-500' },
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Card title="Thông tin sự kiện" extra={canEdit ? <Button href={withCmsReturnTo(`/cms/events/${event.id}/edit`, returnTo)} icon={<Pencil className="h-4 w-4" />}>Chỉnh sửa</Button> : null}>
        <Descriptions column={{ xs: 1, md: 2 }} colon={false}>
          <Descriptions.Item label="Tên sự kiện">{event.name}</Descriptions.Item>
          <Descriptions.Item label="Địa điểm">{event.location || 'Chưa cập nhật'}</Descriptions.Item>
          <Descriptions.Item label="Bắt đầu">{new Date(event.startDate).toLocaleString('vi-VN')}</Descriptions.Item>
          <Descriptions.Item label="Kết thúc">{new Date(event.endDate).toLocaleString('vi-VN')}</Descriptions.Item>
          <Descriptions.Item label="Giới hạn tuổi" span={2}>
            {event.ageLimitMode === 'UNRESTRICTED'
              ? 'Không giới hạn tuổi'
              : event.ageLimitMode === 'CUSTOM'
                ? [event.minAge != null ? `Từ ${event.minAge} tuổi` : null, event.maxAge != null ? `Tối đa ${event.maxAge} tuổi` : null].filter(Boolean).join(' · ')
                : 'Theo độ tuổi của từng hạng đấu'}
          </Descriptions.Item>
          <Descriptions.Item label="Bộ môn" span={2}>
            <Space wrap>{(event.sports?.length ? event.sports : [event.sport]).filter(Boolean).map((sport: any) => <Tag color="blue" key={sport.id}>{sport.name}</Tag>)}</Space>
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="Dữ liệu vận hành">
        <div className="grid grid-cols-2 gap-3 text-center">
          {operationMetrics.map((metric) => (
            <div className="rounded-xl border border-slate-200/15 bg-slate-500/[0.03] p-3.5" key={metric.label}>
              <strong className={`block text-2xl tabular-nums ${metric.color}`}>{metric.value}</strong>
              <span className="text-xs text-slate-500">{metric.label}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function FopsTab({ event, canOperate, onRefresh }: EventWorkspaceProps & { canOperate: boolean }) {
  const toast = useSportDataToast();
  const { data: venues = [], isLoading: venuesLoading } = useSWR<any[]>(
    canOperate ? `/scheduling/venues?eventId=${event.id}` : null,
    fetcher,
  );
  const [form] = Form.useForm();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingFop, setEditingFop] = useState<any>();
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const fops = useMemo(
    () => [...(event.fops || [])].sort((left: any, right: any) => left.name.localeCompare(right.name, 'vi')),
    [event.fops],
  );

  const openEditor = (fop?: any) => {
    setEditingFop(fop);
    form.setFieldsValue({ name: fop?.name || '', venueId: fop?.venueId || undefined });
    setEditorOpen(true);
  };

  const save = async (values: { name: string; venueId?: string }) => {
    setSaving(true);
    try {
      const payload = { name: values.name.trim(), venueId: values.venueId || null };
      if (editingFop) await api.patch(`/events/${event.id}/fops/${editingFop.id}`, payload);
      else await api.post(`/events/${event.id}/fops`, payload);
      await onRefresh();
      toast.success(editingFop ? 'Đã cập nhật sân/FOP.' : 'Đã thêm sân/FOP vào sự kiện.');
      setEditorOpen(false);
    } catch (error: any) {
      const message = error.response?.data?.message;
      toast.error(Array.isArray(message) ? message.join('. ') : message || 'Không thể lưu sân/FOP.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (fop: any) => {
    setDeletingId(fop.id);
    try {
      await api.delete(`/events/${event.id}/fops/${fop.id}`);
      await onRefresh();
      toast.success(`Đã xóa ${fop.name}.`);
    } catch (error: any) {
      const message = error.response?.data?.message;
      toast.error(Array.isArray(message) ? message.join('. ') : message || 'Không thể xóa sân/FOP.');
    } finally {
      setDeletingId(undefined);
    }
  };

  return (
    <>
      <Card
        title={`Danh sách Sàn / FOP (${fops.length})`}
        extra={canOperate ? <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openEditor()}>Thêm Sàn / FOP</Button> : null}
        styles={{ body: { padding: 0 } }}
      >
        <Table<any>
          rowKey="id"
          dataSource={fops}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{ emptyText: <Empty description="Sự kiện chưa có Sàn / FOP." /> }}
          columns={[
            {
              title: 'Tên Sàn / FOP',
              dataIndex: 'name',
              width: 260,
              render: (name: string) => <strong>{name}</strong>,
            },
            {
              title: 'Địa điểm',
              key: 'venue',
              render: (_: unknown, fop: any) => fop.venue?.name || <Tag>Chưa gán địa điểm</Tag>,
            },
            {
              title: 'Đang sử dụng',
              key: 'usage',
              width: 240,
              render: (_: unknown, fop: any) => (
                <Space wrap size={[4, 4]}>
                  <Tag color={fop._count?.matches ? 'blue' : 'default'}>{fop._count?.matches || 0} trận</Tag>
                  <Tag color={fop._count?.timeSlots ? 'cyan' : 'default'}>{fop._count?.timeSlots || 0} khung giờ</Tag>
                  {fop._count?.draws ? <Tag color="purple">{fop._count.draws} nhánh đấu</Tag> : null}
                </Space>
              ),
            },
            {
              title: '',
              key: 'actions',
              width: 120,
              fixed: 'right' as const,
              render: (_: unknown, fop: any) => {
                const isInUse = Boolean(fop._count?.matches || fop._count?.timeSlots || fop._count?.draws);
                return canOperate ? (
                  <Space>
                    <Button type="text" aria-label={`Chỉnh sửa ${fop.name}`} icon={<Pencil className="h-4 w-4" />} onClick={() => openEditor(fop)} />
                    <Popconfirm
                      title={`Xóa ${fop.name}?`}
                      description="Sân/FOP sẽ bị xóa khỏi sự kiện."
                      okText="Xóa"
                      cancelText="Hủy"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => remove(fop)}
                    >
                      <Button
                        danger
                        type="text"
                        disabled={isInUse}
                        loading={deletingId === fop.id}
                        title={isInUse ? 'Không thể xóa Sàn/FOP đang được sử dụng' : `Xóa ${fop.name}`}
                        aria-label={`Xóa ${fop.name}`}
                        icon={<Trash2 className="h-4 w-4" />}
                      />
                    </Popconfirm>
                  </Space>
                ) : null;
              },
            },
          ]}
        />
      </Card>

      <Modal
        open={editorOpen}
        title={editingFop ? 'Chỉnh sửa Sàn / FOP' : 'Thêm Sàn / FOP'}
        okText={editingFop ? 'Lưu thay đổi' : 'Thêm Sàn / FOP'}
        cancelText="Hủy"
        confirmLoading={saving}
        destroyOnHidden
        onOk={() => form.submit()}
        onCancel={() => !saving && setEditorOpen(false)}
        afterClose={() => {
          form.resetFields();
          setEditingFop(undefined);
        }}
      >
        <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
          <Form.Item
            name="name"
            label="Tên Sàn / FOP"
            rules={[
              { required: true, whitespace: true, message: 'Nhập tên Sàn / FOP' },
              { max: 100, message: 'Tên không được vượt quá 100 ký tự' },
            ]}
          >
            <Input autoFocus placeholder="Ví dụ: FOP 1, Sân trung tâm" maxLength={100} />
          </Form.Item>
          <Form.Item name="venueId" label="Địa điểm" extra="Có thể để trống và gán địa điểm sau.">
            <Select
              allowClear
              showSearch
              loading={venuesLoading}
              optionFilterProp="label"
              placeholder="Chọn địa điểm"
              options={venues.map((venue: any) => ({ value: venue.id, label: venue.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function RegistrationsTab({ event, canOperate, canConfirmPayment }: { event: any; canOperate: boolean; canConfirmPayment: boolean }) {
  const eventId = event.id;
  const toast = useSportDataToast();
  const { mutate: mutateGlobal } = useSWRConfig();
  const { data: registrations = [], isLoading, mutate } = useSWR<Registration[]>(`/participant-auth/admin/registrations?eventId=${eventId}`, fetcher);
  const refreshRegistrationData = async () => {
    await Promise.all([
      mutate(),
      mutateGlobal((key) => {
        const url = typeof key === 'string' ? key : Array.isArray(key) ? key[0] : null;
        return typeof url === 'string' && (url.startsWith(`/competitions/events/${eventId}/categories/`)
          || url.startsWith(`/matches/event/${eventId}/category/`));
      }),
    ]);
  };
  const { data: countries = [] } = useSWR<any[]>('/countries', fetcher);
  const { data: federations = [] } = useSWR<any[]>('/federations', fetcher);
  const [reviewChange, setReviewChange] = useState<{ kind: 'registration' | 'payment'; item: Registration; nextStatus: string }>();
  const [reviewReason, setReviewReason] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [deletingRegistrationId, setDeletingRegistrationId] = useState<string>();
  const deleteRegistration = async (item: Registration) => {
    setDeletingRegistrationId(item.id);
    try {
      await api.delete(`/participant-auth/admin/registrations/${item.id}`);
      toast.success('Đã xóa lượt đăng ký thi đấu.');
      await refreshRegistrationData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể xóa lượt đăng ký thi đấu.');
      throw error;
    } finally {
      setDeletingRegistrationId(undefined);
    }
  };
  const [selectedAthleteId, setSelectedAthleteId] = useState<string>();
  const [registrationFilters, setRegistrationFilters] = useState<RegistrationFilters>({});
  const [sourceRegistration, setSourceRegistration] = useState<Registration>();
  const [registrationPage, setRegistrationPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'existing' | 'new'>('existing');
  const [batchAthletes, setBatchAthletes] = useState<SelectedRegistrationAthlete[]>([]);
  const [batchResults, setBatchResults] = useState<BatchRegistrationResult[]>([]);
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reasons: string[]; warnings: string[] }>();
  const [eligibilityChecking, setEligibilityChecking] = useState(false);
  const [registrationSaving, setRegistrationSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File>();
  const [identityFiles, setIdentityFiles] = useState<Partial<Record<RegistrationIdentityDocument, File>>>({});
  const stagedMedia = useRef(new Map<string, { file: File; id: string; token: string; expiresAt: number }>());
  const [createdRegistration, setCreatedRegistration] = useState<Registration>();
  const [registrationForm] = Form.useForm();
  const [editingRegistration, setEditingRegistration] = useState<Registration>();
  const [editingDiscipline, setEditingDiscipline] = useState<string>();
  const [editingCategoryId, setEditingCategoryId] = useState<string>();
  const [categorySaving, setCategorySaving] = useState(false);
  const selectedCountryId = Form.useWatch(['athlete', 'countryId'], registrationForm);
  const selectedPaymentStatus = Form.useWatch('paymentStatus', registrationForm) || 'PENDING';
  const selectedRegistrationCategoryId = Form.useWatch('categoryId', registrationForm);
  const selectedIdentityType = Form.useWatch(['athlete', 'identityType'], registrationForm) || 'CCCD';
  useEffect(() => { stagedMedia.current.clear(); }, [createMode, createOpen]);
  const availableFederations = federations.filter((item) => !selectedCountryId || item.countryId === selectedCountryId);
  const sourceContact = sourceRegistration?.submission
    ? { name: sourceRegistration.submission.contactName, email: sourceRegistration.submission.contactEmail, phone: sourceRegistration.submission.contactPhone }
    : sourceRegistration?.account
      ? { name: sourceRegistration.account.displayName, email: sourceRegistration.account.email, phone: sourceRegistration.account.phone }
      : { name: sourceRegistration?.athlete.fullName, email: sourceRegistration?.athlete.email, phone: sourceRegistration?.athlete.phone };
  const sourceCreatedAt = sourceRegistration?.submission?.createdAt || sourceRegistration?.createdAt;
  const filteredRegistrations = useMemo(() => {
    const matchesText = (value: string, filter?: string) => !filter || value.toLocaleLowerCase('vi').includes(filter.toLocaleLowerCase('vi'));
    return registrations.filter((item) => {
      const documentStates = new Map((item.athlete.media || []).map((media) => [media.type, media.verificationStatus]));
      const hasIdentity = (documentStates.has('CCCD_FRONT') && documentStates.has('CCCD_BACK')) || documentStates.has('PASSPORT');
      const identityVerified = (documentStates.get('CCCD_FRONT') === 'VERIFIED' && documentStates.get('CCCD_BACK') === 'VERIFIED')
        || documentStates.get('PASSPORT') === 'VERIFIED';
      const documentStatus = identityVerified ? 'VERIFIED' : hasIdentity ? 'PENDING' : 'MISSING';
      const athleteText = [item.athlete.fullName, item.athlete.email, item.athlete.phone, item.athlete.country?.code, item.athlete.federation?.name].filter(Boolean).join(' ');
      const sourceText = item.submission
        ? [item.submission.type === 'GROUP' ? 'Danh sách đội / CLB' : 'Khách', item.submission.organizationName, item.submission.contactName, item.submission.referenceCode].filter(Boolean).join(' ')
        : 'Tài khoản SportData';
      return matchesText(athleteText, registrationFilters.athlete)
        && matchesText(sourceText, registrationFilters.source)
        && matchesText(item.ticketCode, registrationFilters.ticketCode)
        && (!registrationFilters.category || item.category.id === registrationFilters.category)
        && (!registrationFilters.seed || String(item.competitionEntry?.seed ?? '') === registrationFilters.seed)
        && (!registrationFilters.status || item.status === registrationFilters.status)
        && (!registrationFilters.payment || item.paymentStatus === registrationFilters.payment)
        && (!registrationFilters.documents || documentStatus === registrationFilters.documents);
    });
  }, [registrations, registrationFilters]);
  const athleteCounts = useMemo(() => {
    const seen = new Set<string>();
    const counts = { total: 0, male: 0, female: 0, unspecified: 0 };
    for (const { athlete } of filteredRegistrations) {
      if (seen.has(athlete.id)) continue;
      seen.add(athlete.id);
      counts.total += 1;
      if (athlete.gender === 'MALE') counts.male += 1;
      else if (athlete.gender === 'FEMALE') counts.female += 1;
      else counts.unspecified += 1;
    }
    return counts;
  }, [filteredRegistrations]);
  const editableCategories: RegistrationCategory[] = (event.categories || []).filter((category: RegistrationCategory) => category.sportId === editingRegistration?.category.sportId);
  const disciplineOptions = [...new Map(editableCategories.map((category) => {
    const key = registrationDisciplineKey(category);
    const occupied = registrations.some((item) => item.athlete.id === editingRegistration?.athlete.id
      && item.id !== editingRegistration?.id && registrationDisciplineKey(item.category) === key);
    return [key, { value: key, label: registrationDisciplineLabel(category), disabled: occupied }];
  })).values()];
  const openCategoryEditor = (item: Registration) => {
    setEditingRegistration(item);
    setEditingDiscipline(registrationDisciplineKey(item.category));
    setEditingCategoryId(item.category.id);
  };
  const saveRegistrationCategory = async () => {
    if (!editingRegistration || !editingCategoryId) return;
    setCategorySaving(true);
    try {
      await api.patch(`/participant-auth/admin/registrations/${editingRegistration.id}/category`, { categoryId: editingCategoryId });
      setEditingRegistration(undefined);
      await refreshRegistrationData();
      toast.success('Đã cập nhật nội dung và hạng cân.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể cập nhật nội dung / hạng cân.');
    } finally {
      setCategorySaving(false);
    }
  };
  const clearRegistrationFilters = () => {
    setRegistrationFilters({});
    setRegistrationPage(1);
  };
  const hasRegistrationFilters = Object.values(registrationFilters).some(Boolean);
  const columnFilter = (key: keyof RegistrationFilters, label: string, kind: 'text' | 'number' = 'text'): ColumnType<Registration> => ({
    key,
    filteredValue: registrationFilters[key] ? [registrationFilters[key]!] : null,
    filterIcon: (filtered) => <Search className={`h-4 w-4 ${filtered ? 'text-blue-600' : ''}`} />,
    filterDropdown: ({ selectedKeys, setSelectedKeys, confirm, clearFilters }) => (
      <div className="space-y-3 p-3" style={{ width: 270 }} onKeyDown={(event) => event.stopPropagation()}>
        <div className="text-sm font-medium">{label}</div>
        {kind === 'number' ? (
          <InputNumber
            className="!w-full"
            min={1}
            max={2147483647}
            precision={0}
            aria-label={label}
            value={selectedKeys[0] ? Number(selectedKeys[0]) : null}
            onChange={(value) => setSelectedKeys(value === null ? [] : [String(value)])}
            onPressEnter={() => confirm()}
          />
        ) : (
          <Input
            autoFocus
            allowClear
            aria-label={label}
            placeholder={label}
            value={String(selectedKeys[0] || '')}
            onChange={(event) => setSelectedKeys(event.target.value ? [event.target.value] : [])}
            onPressEnter={() => confirm()}
          />
        )}
        <Space>
          <Button type="primary" size="small" onClick={() => confirm()}>Áp dụng</Button>
          <Button size="small" onClick={() => clearFilters?.({ confirm: true, closeDropdown: true })}>Xóa</Button>
        </Space>
      </div>
    ),
  });
  const columnSelectFilter = (key: keyof RegistrationFilters, label: string, options: Array<{ value: string; label: string }>): ColumnType<Registration> => ({
    key,
    filteredValue: registrationFilters[key] ? [registrationFilters[key]!] : null,
    filterIcon: (filtered) => <Search className={`h-4 w-4 ${filtered ? 'text-blue-600' : ''}`} />,
    filterDropdown: ({ selectedKeys, setSelectedKeys, confirm, clearFilters }) => (
      <div className="space-y-3 p-3" style={{ width: 270 }} onKeyDown={(event) => event.stopPropagation()}>
        <div className="text-sm font-medium">{label}</div>
        <Select
          className="w-full"
          allowClear
          showSearch
          optionFilterProp="label"
          aria-label={label}
          placeholder={label}
          value={selectedKeys[0] ? String(selectedKeys[0]) : undefined}
          options={options}
          onChange={(value) => setSelectedKeys(value ? [value] : [])}
        />
        <Space>
          <Button type="primary" size="small" onClick={() => confirm()}>Áp dụng</Button>
          <Button size="small" onClick={() => clearFilters?.({ confirm: true, closeDropdown: true })}>Xóa</Button>
        </Space>
      </div>
    ),
  });

  const registrationPayload = async () => {
    const values = await registrationForm.validateFields();
    const fileEntries: Array<[string, File | undefined]> = [
      ['AVATAR', avatarFile],
      ['CCCD_FRONT', values.athlete?.identityType !== 'PASSPORT' ? identityFiles.CCCD_FRONT : undefined],
      ['CCCD_BACK', values.athlete?.identityType !== 'PASSPORT' ? identityFiles.CCCD_BACK : undefined],
      ['PASSPORT', values.athlete?.identityType === 'PASSPORT' ? identityFiles.PASSPORT : undefined],
    ];
    const fieldNames: Record<string, string> = { AVATAR: 'avatar', CCCD_FRONT: 'cccdFront', CCCD_BACK: 'cccdBack', PASSPORT: 'passport' };
    const uploadEntries = await Promise.all(fileEntries.map(async ([type, file]) => {
      if (!file) return null;
      let reference = stagedMedia.current.get(type);
      if (!reference || reference.file !== file || reference.expiresAt < Date.now() + 60_000) {
        const body = new FormData();
        body.append('type', type);
        body.append('file', await optimizeRegistrationMedia(file));
        const { data } = await api.post<{ id: string; token: string; expiresAt: string }>('/participant-auth/media-uploads', body, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        reference = { file, id: data.id, token: data.token, expiresAt: Date.parse(data.expiresAt) };
        stagedMedia.current.set(type, reference);
      }
      return [fieldNames[type], { id: reference.id, token: reference.token }] as const;
    }));
    const mediaUploads = Object.fromEntries(uploadEntries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)));
    const athlete = values.athlete;
    return {
      eventId,
      categoryId: values.categoryId,
      athlete: {
        ...athlete,
        fullName: `${athlete.firstName} ${athlete.lastName}`.replace(/\s+/g, ' ').trim(),
        birthDate: athlete.birthDate.format('YYYY-MM-DD'),
        federationId: athlete.federationId || undefined,
        height: athlete.height == null ? undefined : Number(athlete.height),
        weight: athlete.weight == null ? undefined : Number(athlete.weight),
      },
      mediaUploads,
      paymentStatus: event.paymentMode === 'FREE' ? undefined : values.paymentStatus || 'PENDING',
      paymentNote: values.paymentNote,
    };
  };

  const processBatchRegistration = async (create: boolean) => {
    if (!batchAthletes.length) {
      toast.error('Vui lòng chọn ít nhất một vận động viên.');
      return;
    }
    const values = await registrationForm.validateFields();
    const results: BatchRegistrationResult[] = batchResults.filter((result) => result.status === 'success');
    const remaining: SelectedRegistrationAthlete[] = [];
    setBatchResults([...results]);
    let added = 0;
    for (const athlete of batchAthletes) {
      try {
        const categoryId = athlete.categoryId || values.categoryId;
        if (!categoryId) throw new Error('Vui lòng chọn hạng đấu cho VĐV này.');
        const payload = {
          eventId,
          categoryId,
          athleteId: athlete.id,
          paymentStatus: event.paymentMode === 'FREE' ? undefined : values.paymentStatus || 'PENDING',
          paymentNote: values.paymentNote,
        };
        const { data: check } = await api.post('/participant-auth/admin/registrations/eligibility', payload);
        if (!check.eligible) throw new Error(check.reasons.join('; ') || 'VĐV chưa đủ điều kiện tham gia.');
        if (create) {
          await api.post('/participant-auth/admin/registrations', payload);
          added += 1;
        }
        results.push({ athleteId: athlete.id, fullName: athlete.fullName, status: create ? 'success' : 'eligible', message: check.warnings?.join('; ') || (create ? 'Đã xác nhận đăng ký.' : 'Hồ sơ phù hợp với hạng đấu.') });
      } catch (error: any) {
        remaining.push(athlete);
        const message = error.response?.data?.message || error.message || 'Không thể thêm VĐV. Vui lòng kiểm tra danh sách đăng ký trước khi thử lại.';
        results.push({ athleteId: athlete.id, fullName: athlete.fullName, status: 'error', message: Array.isArray(message) ? message.join('; ') : message });
      }
      setBatchResults([...results]);
    }
    if (create) {
      setBatchAthletes(remaining);
      if (added) {
        toast.success(`Đã thêm ${added} VĐV${remaining.length ? `; ${remaining.length} VĐV cần xử lý lại` : ''}.`);
        await refreshRegistrationData();
      }
    }
  };

  const checkEligibility = async () => {
    setEligibilityChecking(true);
    try {
      if (createMode === 'existing') {
        await processBatchRegistration(false);
        return;
      }
      const payload = await registrationPayload();
      const { data } = await api.post('/participant-auth/admin/registrations/eligibility', payload);
      setEligibility(data);
      return data as { eligible: boolean; reasons: string[]; warnings: string[] };
    } catch (error: any) {
      if (!error?.errorFields) toast.error(error.response?.data?.message || 'Không thể kiểm tra điều kiện tham gia.');
      return undefined;
    } finally {
      setEligibilityChecking(false);
    }
  };

  const createRegistration = async () => {
    setRegistrationSaving(true);
    try {
      if (createMode === 'existing') {
        await processBatchRegistration(true);
        return;
      }
      if (createMode === 'new' && (selectedIdentityType === 'PASSPORT' ? !identityFiles.PASSPORT : !identityFiles.CCCD_FRONT || !identityFiles.CCCD_BACK)) {
        toast.error('VĐV mới cần tải đủ CCCD hai mặt hoặc hộ chiếu theo loại giấy tờ đã chọn.');
        return;
      }
      if (createMode === 'new' && !avatarFile) {
        toast.error('VĐV mới cần tải ảnh đại diện.');
        return;
      }
      const payload = await registrationPayload();
      const { data: result } = await api.post('/participant-auth/admin/registrations/eligibility', payload);
      setEligibility(result);
      if (!result.eligible) return;
      const { data: registration } = await api.post('/participant-auth/admin/registrations', payload);
      await refreshRegistrationData();
      stagedMedia.current.clear();
      toast.success('Đã tạo VĐV, lưu giấy tờ và xác nhận đăng ký.');
      setCreatedRegistration(registration);
      setCreateOpen(false);
      setEligibility(undefined);
      setAvatarFile(undefined);
      setIdentityFiles({});
      registrationForm.resetFields();
    } catch (error: any) {
      stagedMedia.current.clear();
      if (!error?.errorFields) toast.error(error.response?.data?.message || 'Không thể thêm vận động viên đăng ký.');
    } finally {
      setRegistrationSaving(false);
    }
  };

  const submitStatusChange = async () => {
    if (!reviewChange || reviewReason.trim().length < 3) return;
    setReviewSaving(true);
    try {
      const endpoint = reviewChange.kind === 'payment'
        ? `/participant-auth/admin/registrations/${reviewChange.item.id}/payment-status`
        : `/participant-auth/admin/registrations/${reviewChange.item.id}/status`;
      await api.patch(endpoint, { status: reviewChange.nextStatus, reason: reviewReason.trim() });
      await refreshRegistrationData();
      toast.success(reviewChange.kind === 'payment'
        ? 'Đã cập nhật trạng thái thanh toán.'
        : reviewChange.nextStatus === 'CONFIRMED'
          ? 'Đã xác nhận hồ sơ và gửi lại thẻ qua email.'
          : 'Đã cập nhật trạng thái đăng ký.');
      setReviewChange(undefined);
      setReviewReason('');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể cập nhật trạng thái.');
    } finally {
      setReviewSaving(false);
    }
  };

  const updateSeed = async (item: Registration, seed: number | null) => {
    if (!item.competitionEntry) return;
    try {
      await api.patch(`/competitions/entries/${item.competitionEntry.id}/seed`, { seed });
      await refreshRegistrationData();
      toast.success(seed ? `Đã đặt ${item.athlete.fullName} là hạt giống số ${seed}.` : 'Đã xóa hạt giống.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể cập nhật hạt giống.');
    }
  };

  const viewDocument = async (athleteId: string, type: string) => {
    try {
      const response = await api.get(`/participant-auth/admin/athletes/${athleteId}/media/${type}`, { responseType: 'blob', params: { variant: 'preview' } });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error('Không thể mở giấy tờ xác minh.');
    }
  };

  const verifyDocument = async (athleteId: string, type: string, status: 'VERIFIED' | 'REJECTED') => {
    try {
      await api.patch(`/participant-auth/admin/athletes/${athleteId}/media/${type}/verification`, {
        status,
        note: status === 'REJECTED' ? 'Giấy tờ không hợp lệ hoặc không đọc được.' : undefined,
      });
      await mutate();
      toast.success(status === 'VERIFIED' ? 'Đã xác thực giấy tờ.' : 'Đã từ chối giấy tờ.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể cập nhật giấy tờ.');
    }
  };

  const renderRegistrationCategory = (item: Registration) => (
    <div className="flex items-center justify-between gap-2">
      <span>{item.category.sport?.name || ''} · {item.category.name}</span>
      {canOperate && (
        <Tooltip title="Sửa nội dung / hạng cân">
          <Button type="text" size="small" className="shrink-0" aria-label={`Sửa nội dung / hạng cân: ${item.category.name}`} icon={<Pencil className="h-4 w-4" />} onClick={() => openCategoryEditor(item)} />
        </Tooltip>
      )}
    </div>
  );

  return (
    <>
      <Card
        title={hasRegistrationFilters ? `${filteredRegistrations.length} / ${registrations.length} lượt đăng ký` : `${registrations.length} lượt đăng ký`}
        extra={<Space wrap>{canOperate && <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>Thêm VĐV đăng ký</Button>}<Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => mutate()}>Làm mới</Button></Space>}
        styles={{ body: { padding: 0 } }}
      >
        <div className="space-y-3 border-b border-slate-300/10 p-4">
          <div role="group" aria-label="Thống kê giới tính VĐV" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <span>Tổng VĐV: <strong className="text-lg tabular-nums text-slate-200">{isLoading ? '—' : athleteCounts.total}</strong></span>
            <span>Nam: <strong className="text-lg tabular-nums text-sky-500">{isLoading ? '—' : athleteCounts.male}</strong></span>
            <span>Nữ: <strong className="text-lg tabular-nums text-rose-500">{isLoading ? '—' : athleteCounts.female}</strong></span>
            {athleteCounts.unspecified > 0 && <span>Chưa xác định: <strong className="text-lg tabular-nums text-slate-200">{athleteCounts.unspecified}</strong></span>}
            <span className="text-xs">Mỗi VĐV tính một lần{hasRegistrationFilters ? ' · Theo bộ lọc hiện tại' : ''}.</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-500">Bấm biểu tượng lọc trên tiêu đề cột để tìm đăng ký.</span>
            {hasRegistrationFilters && <Button onClick={clearRegistrationFilters}>Xóa bộ lọc</Button>}
          </div>
        </div>
        <Table<Registration>
          rowKey="id"
          loading={isLoading}
          dataSource={filteredRegistrations}
          scroll={{ x: 1700 }}
          pagination={{ current: registrationPage, defaultPageSize: 15, showSizeChanger: true }}
          locale={{ emptyText: hasRegistrationFilters ? 'Không tìm thấy đăng ký phù hợp. Thử đổi hoặc xóa bộ lọc.' : 'Chưa có vận động viên đăng ký.' }}
          onChange={(pagination, tableFilters, _sorter, extra) => {
            if (extra.action === 'filter') {
              const nextFilters: RegistrationFilters = {};
              Object.entries(tableFilters).forEach(([key, values]) => {
                if (values?.[0] !== undefined && String(values[0]).trim()) {
                  Object.assign(nextFilters, { [key]: String(values[0]).trim() });
                }
              });
              setRegistrationFilters(nextFilters);
              setRegistrationPage(1);
            } else if (extra.action === 'paginate') {
              setRegistrationPage(pagination.current || 1);
            }
          }}
          columns={[
            {
              title: 'Vận động viên',
              ...columnFilter('athlete', 'Tên VĐV, quốc gia, CLB, email hoặc số điện thoại'),
              width: 250,
              render: (_, item) => (
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    size={46}
                    className="shrink-0"
                    src={imageUrl(item.athlete.photoUrl || `/api/participant-auth/avatar/${item.athlete.id}`, 'avatar')}
                    icon={<UserRound className="h-5 w-5" />}
                  />
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <Tooltip title={item.athlete.fullName} placement="topLeft">
                      <Button
                        type="link"
                        className="!block h-auto !w-full overflow-hidden !p-0 text-left font-semibold"
                        onClick={() => setSelectedAthleteId(item.athlete.id)}
                      >
                        <span className="block truncate">{item.athlete.fullName}</span>
                      </Button>
                    </Tooltip>
                    <Tooltip title={`${item.athlete.country?.code || '—'} · ${item.athlete.federation?.name || 'VĐV tự do'} · ${item.athlete.weight ? `${item.athlete.weight} kg` : 'chưa cân'}`} placement="bottomLeft">
                      <div className="truncate text-xs text-slate-500">{item.athlete.country?.code || '—'} · {item.athlete.federation?.name || 'VĐV tự do'} · {item.athlete.weight ? `${item.athlete.weight} kg` : 'chưa cân'}</div>
                    </Tooltip>
                  </div>
                </div>
              ),
            },
            { title: 'Hạng đấu', ...columnSelectFilter('category', 'Hạng đấu', (event.categories || []).map((category: RegistrationCategory) => ({ value: category.id, label: `${category.sport?.name || ''} · ${category.name}` }))), width: 240, render: (_, item) => <div>{renderRegistrationCategory(item)}{item.team && <div className="mt-2 rounded-lg bg-sky-50 p-2 text-xs text-sky-900">
              <strong>{item.team.members.map((member) => member.athlete.fullName).join(' / ')}</strong>
              <div>{item.isPairPayer ? 'Người khai báo · chịu lệ phí' : 'Đồng đội · không thu thêm phí'}</div>
              <Tag className="mt-1" color={item.competitionEntry?.status === 'VERIFIED' ? 'green' : 'orange'}>{item.competitionEntry?.status === 'VERIFIED' ? 'Cặp đủ điều kiện' : 'Cặp chưa đủ điều kiện'}</Tag>
            </div>}</div> },
            {
              title: 'Hạt giống',
              ...columnFilter('seed', 'Số hạt giống', 'number'),
              width: 130,
              render: (_, item) => (
                <SeedInput
                  value={item.competitionEntry?.seed}
                  disabled={!canOperate || !item.competitionEntry || item.status !== 'CONFIRMED'}
                  onSave={(value) => void updateSeed(item, value)}
                />
              ),
            },
            {
              title: 'Giấy tờ xác minh',
              ...columnSelectFilter('documents', 'Giấy tờ xác minh', [{ value: 'VERIFIED', label: 'Đã xác thực' }, { value: 'PENDING', label: 'Chờ xác thực' }, { value: 'MISSING', label: 'Thiếu giấy tờ' }]),
              width: 330,
              render: (_, item) => (
                <div className="space-y-1.5">
                  {(item.athlete.media || []).filter((media) => ['CCCD_FRONT', 'CCCD_BACK', 'PASSPORT'].includes(media.type)).map((media) => (
                    <div className="flex flex-wrap items-center gap-1" key={media.type}>
                      <Button size="small" icon={<Eye className="h-3 w-3" />} onClick={() => viewDocument(item.athlete.id, media.type)}>{media.type === 'CCCD_FRONT' ? 'CCCD trước' : media.type === 'CCCD_BACK' ? 'CCCD sau' : 'Hộ chiếu'}</Button>
                      <Tag color={media.verificationStatus === 'VERIFIED' ? 'success' : media.verificationStatus === 'REJECTED' ? 'error' : 'processing'}>{media.verificationStatus === 'VERIFIED' ? 'Đã xác thực' : media.verificationStatus === 'REJECTED' ? 'Từ chối' : 'Chờ xác thực'}</Tag>
                      {canOperate && media.verificationStatus !== 'VERIFIED' && <Button size="small" type="text" title="Xác thực" icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} onClick={() => verifyDocument(item.athlete.id, media.type, 'VERIFIED')} />}
                    </div>
                  ))}
                </div>
              ),
            },
            {
              title: 'Nguồn hồ sơ',
              ...columnFilter('source', 'Đội / CLB, người liên hệ hoặc mã hồ sơ'),
              width: 210,
              render: (_, item) => (
                <button
                  type="button"
                  className="block w-full cursor-pointer rounded-md text-left hover:text-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                  aria-label={`Xem thông tin nguồn hồ sơ của ${item.athlete.fullName}`}
                  title="Xem thông tin nguồn hồ sơ"
                  onClick={() => setSourceRegistration(item)}
                >
                  {item.submission ? (
                    <>
                      <Tag color={item.submission.type === 'GROUP' ? 'purple' : 'blue'}>{item.submission.type === 'GROUP' ? 'Danh sách đội / CLB' : 'Khách'}</Tag>
                      <span className="mt-1 block text-xs">{item.submission.organizationName || item.submission.contactName}</span>
                      <code className="text-xs text-slate-500">{item.submission.referenceCode}</code>
                    </>
                  ) : <Tag>Tài khoản SportData</Tag>}
                </button>
              ),
            },
            {
              title: 'Thanh toán',
              ...columnSelectFilter('payment', 'Thanh toán', Object.entries(paymentStatusLabels).map(([value, badge]) => ({ value, label: badge.label }))),
              width: 210,
              render: (_, item) => {
                const badge = paymentStatusLabels[item.paymentStatus] || { label: item.paymentStatus, color: 'default' };
                return (
                  <Space direction="vertical" size={4}>
                    {canConfirmPayment && item.paymentStatus !== 'NOT_REQUIRED' ? (
                      <Select
                        size="small"
                        value={item.paymentStatus}
                        className="min-w-40"
                        onChange={(nextStatus) => nextStatus !== item.paymentStatus && setReviewChange({ kind: 'payment', item, nextStatus })}
                        options={[
                          { value: 'PENDING', label: 'Chờ thanh toán' },
                          { value: 'PAID', label: 'Duyệt thanh toán' },
                          { value: 'FAILED', label: 'Thanh toán thất bại' },
                        ]}
                      />
                    ) : <Tag color={badge.color}>{badge.label}</Tag>}
                    {item.feeAmount > 0 ? <span className="text-xs tabular-nums text-slate-500">{new Intl.NumberFormat('vi-VN').format(item.feeAmount)} {item.currency}</span> : null}
                    {item.paymentStatusReason ? <span className="max-w-44 text-xs text-slate-500">Lý do: {item.paymentStatusReason}</span> : null}
                  </Space>
                );
              },
            },
            {
              title: 'Thẻ / mã hồ sơ',
              dataIndex: 'ticketCode',
              ...columnFilter('ticketCode', 'Mã thẻ'),
              width: 240,
              render: (value, item) => {
                const ticketIssued = item.status === 'CONFIRMED'
                  && (item.paymentStatus === 'PAID' || item.paymentStatus === 'NOT_REQUIRED');
                return (
                  <Space>
                    <code>{value}</code>
                    {ticketIssued ? (
                      <Button type="text" size="small" href={`/api/participant-auth/tickets/${encodeURIComponent(value)}/pdf`} target="_blank" icon={<Download className="h-4 w-4" />} />
                    ) : (
                      <Tag>Chưa phát hành</Tag>
                    )}
                  </Space>
                );
              },
            },
            {
              title: 'Trạng thái',
              ...columnSelectFilter('status', 'Trạng thái hồ sơ', Object.entries(registrationStatusLabels).map(([value, badge]) => ({ value, label: badge.label }))),
              fixed: 'right' as const,
              width: 212,
              render: (_, item) => {
                const states = new Map((item.athlete.media || []).map((media) => [media.type, media.verificationStatus]));
                const identityVerified = (states.get('CCCD_FRONT') === 'VERIFIED' && states.get('CCCD_BACK') === 'VERIFIED') || states.get('PASSPORT') === 'VERIFIED';
                return (
                  <div className="flex min-h-8 w-full items-center gap-2">
                    {canOperate ? (
                      <Select
                        value={item.status}
                        size="small"
                        className="min-w-0 flex-1"
                        aria-label={`Trạng thái đăng ký của ${item.athlete.fullName}`}
                        disabled={deletingRegistrationId === item.id}
                        onChange={(nextStatus) => nextStatus !== item.status && setReviewChange({ kind: 'registration', item, nextStatus })}
                        options={[
                          { value: 'SUBMITTED', label: 'Chờ duyệt' },
                          { value: 'CONFIRMED', label: 'Đã xác nhận', disabled: !identityVerified && item.status !== 'CONFIRMED' },
                          { value: 'REJECTED', label: 'Từ chối' },
                        ]}
                      />
                    ) : <Tag color={registrationStatusLabels[item.status]?.color}>{registrationStatusLabels[item.status]?.label || item.status}</Tag>}
                    {canOperate && (
                      <Popconfirm
                        title="Xóa đăng ký thi đấu?"
                        placement="topRight"
                        description={<div className="max-w-xs">{item.team ? 'Xóa đăng ký của cả cặp' : 'Xóa đăng ký của'} <strong>{item.team ? item.team.members.map((member) => member.athlete.fullName).join(' / ') : item.athlete.fullName}</strong> tại <strong>{item.category.name}</strong>, cùng thẻ và lịch sử thanh toán của lượt đăng ký này. Hồ sơ vận động viên vẫn được giữ.</div>}
                        okText="Xóa đăng ký"
                        cancelText="Hủy"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => deleteRegistration(item)}
                      >
                        <Tooltip title="Xóa đăng ký" placement="top">
                          <Button
                            danger
                            type="text"
                            size="small"
                            className="!h-8 !w-8 !min-w-8 shrink-0 !p-0"
                            aria-label={`Xóa đăng ký của ${item.athlete.fullName} tại ${item.category.name}`}
                            icon={<Trash2 className="h-4 w-4" />}
                            loading={deletingRegistrationId === item.id}
                            disabled={Boolean(deletingRegistrationId) && deletingRegistrationId !== item.id}
                          />
                        </Tooltip>
                      </Popconfirm>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      </Card>
      <Modal
        open={Boolean(sourceRegistration)}
        title="Thông tin nguồn hồ sơ"
        centered
        width={560}
        footer={<Button onClick={() => setSourceRegistration(undefined)}>Đóng</Button>}
        onCancel={() => setSourceRegistration(undefined)}
      >
        {sourceRegistration && (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="Loại hồ sơ">{sourceRegistration.submission ? sourceRegistration.submission.type === 'GROUP' ? 'Danh sách đội / CLB' : 'Khách' : 'Tài khoản SportData'}</Descriptions.Item>
            <Descriptions.Item label="Đội / CLB">{sourceRegistration.submission ? sourceRegistration.submission.organizationName || 'Chưa cung cấp' : sourceRegistration.athlete.federation?.name || 'VĐV tự do'}</Descriptions.Item>
            <Descriptions.Item label="Người liên hệ">{sourceContact.name || 'Chưa cung cấp'}</Descriptions.Item>
            <Descriptions.Item label="Số điện thoại">{sourceContact.phone ? <a href={`tel:${sourceContact.phone}`}>{sourceContact.phone}</a> : 'Chưa cung cấp'}</Descriptions.Item>
            <Descriptions.Item label="Email">{sourceContact.email ? <a className="break-all" href={`mailto:${sourceContact.email}`}>{sourceContact.email}</a> : 'Chưa cung cấp'}</Descriptions.Item>
            <Descriptions.Item label="Mã hồ sơ"><code>{sourceRegistration.submission?.referenceCode || sourceRegistration.ticketCode}</code></Descriptions.Item>
            <Descriptions.Item label="Vận động viên">{sourceRegistration.athlete.fullName}</Descriptions.Item>
            <Descriptions.Item label="Hạng đấu">{sourceRegistration.category.name}</Descriptions.Item>
            <Descriptions.Item label="Ngày đăng ký">{sourceCreatedAt ? new Date(sourceCreatedAt).toLocaleString('vi-VN') : 'Chưa cung cấp'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
      <Modal
        open={Boolean(editingRegistration)}
        title="Sửa nội dung / hạng cân"
        centered
        okText="Lưu thay đổi"
        cancelText="Hủy"
        confirmLoading={categorySaving}
        okButtonProps={{ disabled: !editingCategoryId || editingCategoryId === editingRegistration?.category.id }}
        onOk={() => void saveRegistrationCategory()}
        onCancel={() => { if (!categorySaving) setEditingRegistration(undefined); }}
      >
        <p className="mb-4">{editingRegistration?.athlete.fullName}</p>
        <div className="space-y-4">
          <div>
            <label htmlFor="registration-discipline" className="mb-1 block text-sm font-medium">Nội dung thi đấu</label>
            <Select
              id="registration-discipline"
              className="w-full"
              value={editingDiscipline}
              options={disciplineOptions}
              disabled={categorySaving}
              onChange={(value) => { setEditingDiscipline(value); setEditingCategoryId(undefined); }}
            />
          </div>
          <div>
            <label htmlFor="registration-weight-category" className="mb-1 block text-sm font-medium">Hạng đấu / hạng cân</label>
            <Select
              id="registration-weight-category"
              className="w-full"
              showSearch
              optionFilterProp="label"
              placeholder="Chọn hạng đấu phù hợp"
              value={editingCategoryId}
              disabled={categorySaving}
              options={editableCategories.filter((category) => registrationDisciplineKey(category) === editingDiscipline).map((category) => ({ value: category.id, label: category.name }))}
              onChange={setEditingCategoryId}
            />
          </div>
          <p className="text-xs text-slate-500">Hạng đấu mới phải phù hợp với giới tính, tuổi và cân nặng của VĐV. Không thể đổi khi hạng đấu đã có bốc thăm hoặc lịch thi đấu. Hạt giống sẽ được xóa khi đổi hạng đấu.</p>
        </div>
      </Modal>
      <Modal
        open={createOpen}
        title="Thêm vận động viên đăng ký thi đấu"
        width={createMode === 'existing' ? 1100 : 760}
        styles={createMode === 'existing' ? { body: { maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto' } } : undefined}
        centered
        destroyOnHidden
        okText={createMode === 'existing' ? `Thêm ${batchAthletes.length} VĐV` : 'Kiểm tra và thêm'}
        cancelText="Hủy"
        confirmLoading={registrationSaving}
        okButtonProps={{ disabled: eligibilityChecking || (createMode === 'existing' && !batchAthletes.length) }}
        onOk={() => void createRegistration()}
        onCancel={() => {
          if (registrationSaving || eligibilityChecking) return;
          setCreateOpen(false);
          setEligibility(undefined);
          setAvatarFile(undefined);
          setIdentityFiles({});
          setBatchAthletes([]);
          setBatchResults([]);
          registrationForm.resetFields();
        }}
      >
        <div className="mb-5 rounded-xl border border-slate-300/15 bg-slate-500/5 p-3">
          <Segmented
            block
            value={createMode}
            disabled={registrationSaving || eligibilityChecking}
            options={[{ value: 'existing', label: 'Chọn VĐV đang có' }, { value: 'new', label: 'Thêm VĐV mới' }]}
            onChange={(value) => {
              setCreateMode(value as 'existing' | 'new');
              setEligibility(undefined);
              setAvatarFile(undefined);
              setIdentityFiles({});
              setBatchAthletes([]);
              setBatchResults([]);
              registrationForm.resetFields(['athlete']);
            }}
          />
        </div>
        <Form
          form={registrationForm}
          layout="vertical"
          disabled={registrationSaving || eligibilityChecking}
          initialValues={{ athlete: { gender: 'MALE', identityType: 'CCCD' }, paymentStatus: 'PENDING' }}
          onValuesChange={() => {
            setEligibility(undefined);
            setBatchResults((current) => current.filter((result) => result.status === 'success'));
          }}
        >
          <ToastNotice className="!mb-4" type="info" showIcon message="Hồ sơ do quản trị viên tạo được xác nhận ngay. Thanh toán được theo dõi riêng." />
          <Form.Item name="categoryId" label={createMode === 'existing' ? 'Hạng đấu chung (có thể chỉnh riêng từng VĐV)' : 'Hạng đấu'} rules={[{ required: createMode === 'new', message: 'Vui lòng chọn hạng đấu' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn hạng đấu trong sự kiện"
              options={(event.categories || []).map((item: any) => ({
                value: item.id,
                label: `${item.sport?.name ? `${item.sport.name} · ` : ''}${item.name}`,
              }))}
            />
          </Form.Item>
          {createMode === 'existing' ? (
            <ExistingAthleteRegistrationPicker
              federations={federations}
              categories={event.categories || []}
              defaultCategoryId={selectedRegistrationCategoryId}
              selected={batchAthletes}
              results={batchResults}
              disabled={registrationSaving || eligibilityChecking}
              onChange={(selected) => {
                setBatchAthletes(selected);
                setBatchResults((current) => current.filter((result) => result.status === 'success'));
              }}
            />
          ) : (
            <div className="rounded-xl border border-slate-300/15 p-4">
              <Row gutter={[16, 0]}>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'firstName']} label="Họ" rules={[{ required: true, message: 'Vui lòng nhập họ' }]}><Input placeholder="Nguyễn" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'lastName']} label="Tên" rules={[{ required: true, message: 'Vui lòng nhập tên' }]}><Input placeholder="Minh Anh" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'email']} label="Email" rules={[{ required: true, message: 'Vui lòng nhập email' }, { type: 'email', message: 'Email không hợp lệ' }]}><Input type="email" placeholder="email@example.com" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'phone']} label="Số điện thoại" rules={[{ required: true, message: 'Vui lòng nhập số điện thoại' }, { min: 8, message: 'Số điện thoại phải có ít nhất 8 ký tự' }]}><Input type="tel" placeholder="0901234567" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'gender']} label="Giới tính" rules={[{ required: true }]}><Select options={[{ value: 'MALE', label: 'Nam' }, { value: 'FEMALE', label: 'Nữ' }, { value: 'MIXED', label: 'Khác / hỗn hợp' }]} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'birthDate']} label="Ngày sinh" rules={[{ required: true, message: 'Vui lòng chọn ngày sinh' }]}><DatePicker needConfirm={false} size="large" className="w-full" format="DD/MM/YYYY" placeholder="Chọn ngày sinh" disabledDate={(date) => date.isAfter(dayjs(), 'day')} allowClear /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'weight']} label="Cân nặng (kg, không bắt buộc)"><InputNumber min={1} max={500} className="w-full" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'height']} label="Chiều cao (cm)"><InputNumber min={1} max={300} className="w-full" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'countryId']} label="Quốc gia" rules={[{ required: true, message: 'Vui lòng chọn quốc gia' }]}><Select showSearch optionFilterProp="label" options={countries.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'federationId']} label="Đơn vị chủ quản"><Select allowClear showSearch optionFilterProp="label" placeholder="VĐV tự do" options={availableFederations.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'identityType']} label="Loại giấy tờ" rules={[{ required: true }]}><Select options={[{ value: 'CCCD', label: 'Căn cước công dân' }, { value: 'PASSPORT', label: 'Hộ chiếu' }]} onChange={() => { registrationForm.setFieldValue(['athlete', 'documentNumber'], undefined); setIdentityFiles({}); }} /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name={['athlete', 'documentNumber']} label={selectedIdentityType === 'CCCD' ? 'Số căn cước' : 'Số hộ chiếu'} rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập số giấy tờ' }]}><Input maxLength={30} /></Form.Item></Col>
              </Row>
            </div>
          )}
          {createMode === 'new' && (
            <>
              <AthleteAvatarPicker file={avatarFile} onChange={setAvatarFile} onError={(message) => toast.error(message)} />
              <div className="mt-4 rounded-xl border border-slate-300/15 p-4">
                <div className="mb-3">
                  <strong>Giấy tờ định danh</strong>
                  <div className="mt-1 text-xs text-slate-500">
                    Tải lên ảnh đại diện và giấy tờ theo loại đã chọn trước khi đăng ký.
                  </div>
                </div>
                <Row gutter={[12, 12]}>
                  {([
                    ['CCCD_FRONT', 'CCCD mặt trước'],
                    ['CCCD_BACK', 'CCCD mặt sau'],
                    ['PASSPORT', 'Hộ chiếu'],
                  ] as Array<[RegistrationIdentityDocument, string]>).filter(([type]) => selectedIdentityType === 'PASSPORT' ? type === 'PASSPORT' : type !== 'PASSPORT').map(([type, label]) => (
                    <Col xs={24} md={8} key={type}>
                      <IdentityDocumentPicker
                        file={identityFiles[type]}
                        label={label}
                        required
                        onError={(message) => toast.error(message)}
                        onChange={(file) => setIdentityFiles((current) => ({ ...current, [type]: file }))}
                      />
                    </Col>
                  ))}
                </Row>
              </div>
            </>
          )}
          {event.paymentMode !== 'FREE' && event.registrationFee > 0 && (
            <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>Lệ phí tham gia</strong>
                  <div className="mt-1 text-sm text-slate-500">{new Intl.NumberFormat('vi-VN').format(event.registrationFee)} {event.registrationCurrency || 'VND'}</div>
                </div>
                <Tag color="gold">{event.paymentMode === 'ONLINE' ? 'Thanh toán trực tuyến' : 'Chuyển khoản / đối soát'}</Tag>
              </div>
              <Form.Item className="!mb-0 !mt-4" name="paymentStatus" label="Xử lý thanh toán">
                <Segmented
                  block
                  options={[
                    { value: 'PENDING', label: 'Chờ VĐV thanh toán' },
                    { value: 'PAID', label: 'Đã thu phí thủ công' },
                  ]}
                />
              </Form.Item>
              {createMode === 'existing' && <p className="mt-2 text-xs text-slate-500">Trạng thái và ghi chú thanh toán áp dụng cho từng VĐV được chọn. Lệ phí được tính riêng cho mỗi lượt đăng ký.</p>}
              {selectedPaymentStatus === 'PAID' && (
                <Form.Item className="!mb-0 !mt-3" name="paymentNote" label="Ghi chú thu phí" rules={[{ required: true, message: 'Vui lòng nhập hình thức hoặc nội dung thu phí' }]}>
                  <Input placeholder="Ví dụ: Đã thu tiền mặt tại quầy / đã nhận chuyển khoản" />
                </Form.Item>
              )}
              {selectedPaymentStatus === 'PENDING' && <ToastNotice className="!mt-3" type="info" showIcon message="Sau khi tạo, sao chép liên kết thanh toán gửi cho VĐV. Trang thẻ sẽ hiển thị QR/MoMo/VNPAY theo cấu hình sự kiện." />}
            </div>
          )}
        </Form>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button loading={eligibilityChecking} disabled={registrationSaving || (createMode === 'existing' && !batchAthletes.length)} onClick={() => void checkEligibility()}>Kiểm tra điều kiện</Button>
          <span className="text-xs text-slate-500">Kiểm tra theo giới tính, tuổi, cân nặng, đơn vị, quốc gia và đăng ký trùng.</span>
        </div>
        {eligibility && (
          <ToastNotice
            className="!mt-4"
            showIcon
            type={eligibility.eligible ? (eligibility.warnings.length ? 'warning' : 'success') : 'error'}
            message={eligibility.eligible ? 'VĐV đủ điều kiện tham gia hạng đấu' : 'VĐV chưa đủ điều kiện tham gia'}
            description={[
              ...eligibility.reasons.map((item) => `• ${item}`),
              ...eligibility.warnings.map((item) => `• ${item}`),
            ].map((item, index) => <div key={index}>{item}</div>)}
          />
        )}
      </Modal>
      <Modal
        open={Boolean(createdRegistration)}
        title="Đã thêm vận động viên đăng ký"
        footer={null}
        centered
        onCancel={() => setCreatedRegistration(undefined)}
      >
        {createdRegistration && (
          <div className="space-y-4">
            <ToastNotice
              showIcon
              type={createdRegistration.paymentStatus === 'PENDING' ? 'warning' : 'success'}
              message={createdRegistration.paymentStatus === 'PENDING' ? 'Đã xác nhận · Chờ thanh toán' : createdRegistration.paymentStatus === 'PAID' ? 'Đã xác nhận · Đã thanh toán' : 'Đã xác nhận · Miễn thanh toán'}
              description={createdRegistration.paymentStatus === 'PENDING'
                ? `Hồ sơ đã được xác nhận. Lệ phí ${new Intl.NumberFormat('vi-VN').format(createdRegistration.feeAmount)} ${createdRegistration.currency}. Gửi liên kết dưới đây để VĐV thanh toán.`
                : 'Hồ sơ đã được quản trị viên xác nhận, không cần chờ duyệt.'}
            />
            <div className="rounded-xl border border-slate-300/15 p-4">
              <div className="text-xs text-slate-500">Mã hồ sơ / thẻ</div>
              <code className="mt-1 block text-base font-semibold">{createdRegistration.ticketCode}</code>
              <div className="mt-3 break-all text-sm text-sky-500">{`${window.location.origin}/tickets/${encodeURIComponent(createdRegistration.ticketCode)}`}</div>
            </div>
            <Space wrap>
              <Button type="primary" href={`/tickets/${encodeURIComponent(createdRegistration.ticketCode)}`} target="_blank">{createdRegistration.paymentStatus === 'PENDING' ? 'Mở trang thanh toán' : 'Mở thẻ'}</Button>
              <Button onClick={() => {
                void navigator.clipboard.writeText(`${window.location.origin}/tickets/${encodeURIComponent(createdRegistration.ticketCode)}`);
                toast.success('Đã sao chép liên kết thanh toán.');
              }}>Sao chép liên kết</Button>
              <Button onClick={() => setCreatedRegistration(undefined)}>Đóng</Button>
            </Space>
          </div>
        )}
      </Modal>
      <Modal
        className="registration-review-modal"
        open={Boolean(reviewChange)}
        title={reviewChange?.kind === 'payment' ? 'Cập nhật trạng thái thanh toán' : 'Cập nhật trạng thái đăng ký'}
        width={560}
        centered
        destroyOnHidden
        okText="Xác nhận thay đổi"
        cancelText="Hủy"
        confirmLoading={reviewSaving}
        okButtonProps={{ disabled: reviewReason.trim().length < 3 }}
        onOk={() => void submitStatusChange()}
        onCancel={() => {
          if (!reviewSaving) {
            setReviewChange(undefined);
            setReviewReason('');
          }
        }}
      >
        <p className="registration-review-description text-sm text-slate-500">
          {reviewChange?.item.athlete.fullName} · Mọi thay đổi đều được lưu lịch sử để đối soát.
        </p>
        <div className="registration-review-reason">
          <Input.TextArea
            autoFocus
            rows={3}
            maxLength={1000}
            showCount
            value={reviewReason}
            onChange={(event) => setReviewReason(event.target.value)}
            placeholder="Nhập lý do thay đổi (bắt buộc, tối thiểu 3 ký tự)"
          />
        </div>
      </Modal>
      <AthleteQuickViewModal
        athleteId={selectedAthleteId}
        open={Boolean(selectedAthleteId)}
        onClose={() => setSelectedAthleteId(undefined)}
      />
    </>
  );
}

type MatchFilters = {
  athleteName?: string;
  opponentName?: string;
  matchNumber?: number;
  round?: number;
  status?: string;
  date?: string;
  venue?: string;
};

function MatchesTab(props: { event: any; returnTo: string; canOperate: boolean; canScore: boolean; canEditMatch: boolean; canEditBracket: boolean }) {
  const [view, setView] = useState<'schedule' | 'tree'>('schedule');
  return <div className="space-y-4">
    <Segmented value={view} onChange={(value) => navigateSchedule(() => setView(value as 'schedule' | 'tree'))}
      options={[{ value: 'schedule', label: 'Sắp xếp trận đấu' }, { value: 'tree', label: 'Sơ đồ cây' }]} />
    {view === 'schedule' ? <MatchSchedulingWorkspace event={props.event} canEdit={props.canOperate} canScore={props.canScore} />
      : <LegacyMatchesTab key={view} {...props} initialView="tree" />}
  </div>;
}

function LegacyMatchesTab({ event, returnTo, canEditBracket, initialView = 'tree' }: { event: any; returnTo: string; canOperate: boolean; canScore: boolean; canEditMatch: boolean; canEditBracket: boolean; initialView?: 'tree' | 'list' }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useSportDataToast();
  const [exporting, setExporting] = useState(false);
  const requestedCategoryIds = (searchParams.get('categoryIds') || searchParams.get('categoryId') || '').split(',');
  const categoryIds: string[] = requestedCategoryIds.filter((id) => event.categories?.some((category: any) => category.id === id));
  const selectedCategories: any[] = (event.categories || []).filter((category: any) => !categoryIds.length || categoryIds.includes(category.id));
  const matchReturnTo = categoryIds.length ? `${returnTo}&categoryIds=${encodeURIComponent(categoryIds.join(','))}` : returnTo;
  const [view, setView] = useState<'tree' | 'list'>(initialView);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<MatchFilters>({});
  const [scheduleSort, setScheduleSort] = useState<'ascend' | 'descend'>('ascend');
  const [selectedAthleteId, setSelectedAthleteId] = useState<string>();
  const pageSize = 50;
  const query = new URLSearchParams({ eventId: event.id, limit: String(pageSize), page: String(page), hideByes: 'true', scheduleOrder: scheduleSort === 'descend' ? 'desc' : 'asc' });
  if (categoryIds.length) query.set('categoryIds', categoryIds.join(','));
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) query.set(key, String(value).trim());
  });
  const hasFilters = Object.values(filters).some((value) => value !== undefined && value !== null && String(value).trim());
  const isWinner = (match: any, side: 1 | 2) => Boolean(
    match.status === 'FINISHED' && match.winnerId && match.winnerId === match[`athlete${side}`]?.id,
  );
  const renderAthlete = (match: any, side: 1 | 2) => {
    const team = match[`team${side}`];
    if (team) return <span className={match.winnerTeamId === team.id ? 'font-semibold text-emerald-600' : 'font-semibold'}>{team.members?.map((member: any) => member.athlete.fullName).join(' / ') || team.name}</span>;
    const athlete = match[`athlete${side}`];
    if (!athlete) return 'Chờ xác định';
    const winner = isWinner(match, side);
    return (
      <Space size={8}>
        <Button type="link" className={`h-auto !p-0 ${winner ? '!text-emerald-500 font-semibold' : ''}`} onClick={() => setSelectedAthleteId(athlete.id)}>{athlete.fullName}</Button>
        {winner && <Tag color="success" className="!m-0 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Thắng</Tag>}
      </Space>
    );
  };
  const columnFilter = (key: keyof MatchFilters, label: string, kind: 'text' | 'number' | 'date' = 'text'): ColumnType<any> => ({
    key,
    filteredValue: filters[key] !== undefined ? [String(filters[key])] : null,
    filterIcon: (filtered) => <Search className={`h-4 w-4 ${filtered ? 'text-blue-600' : ''}`} />,
    filterDropdown: ({ selectedKeys, setSelectedKeys, confirm, clearFilters }) => (
      <div className="space-y-3 p-3" style={{ width: 270 }} onKeyDown={(event) => event.stopPropagation()}>
        <div className="text-sm font-medium">{label}</div>
        {kind === 'number' ? (
          <InputNumber
            className="!w-full"
            min={1}
            max={2147483647}
            precision={0}
            aria-label={label}
            value={selectedKeys[0] ? Number(selectedKeys[0]) : null}
            onChange={(value) => setSelectedKeys(value === null ? [] : [String(value)])}
            onPressEnter={() => confirm()}
          />
        ) : kind === 'date' ? (
          <DatePicker needConfirm={false} size="large"
            autoFocus
            allowClear
            className="w-full"
            format="DD/MM/YYYY"
            aria-label={label}
            placeholder="Chọn ngày thi đấu"
            value={selectedKeys[0] ? dayjs(String(selectedKeys[0])) : null}
            onChange={(value) => setSelectedKeys(value ? [value.format('YYYY-MM-DD')] : [])}
          />
        ) : (
          <Input
            autoFocus
            allowClear
            aria-label={label}
            placeholder={label}
            value={String(selectedKeys[0] || '')}
            onChange={(event) => setSelectedKeys(event.target.value ? [event.target.value] : [])}
            onPressEnter={() => confirm()}
          />
        )}
        <Space>
          <Button type="primary" size="small" onClick={() => confirm()}>Áp dụng</Button>
          <Button size="small" onClick={() => clearFilters?.({ confirm: true, closeDropdown: true })}>Xóa</Button>
        </Space>
      </div>
    ),
  });
  const { data, error, isLoading, mutate } = useSWR<any>(`/matches?${query}`, fetcher, { refreshInterval: 5000 });
  const drawUrls = selectedCategories.map((category) => `/matches/event/${event.id}/category/${category.id}/draws`);
  const { data: drawData, error: drawsError, isLoading: drawsLoading, mutate: mutateDraws } = useSWR<Array<{ draws: BracketDraw[] }>>(
    view === 'tree' && drawUrls.length ? drawUrls : null,
    (urls: string[]) => Promise.all(urls.map((url) => fetcher(url))),
    { refreshInterval: 5000 },
  );
  const draws = (drawData || []).flatMap((result) => [...result.draws].sort((a, b) => a.sortOrder - b.sortOrder));
  const loadError = Array.isArray(error?.response?.data?.message)
    ? error.response.data.message.join(', ')
    : error?.response?.data?.message || error?.message;
  const exportFile = async (draw?: BracketDraw, board?: HTMLElement, heading?: HTMLElement) => {
    if (!draw && exporting) return;
    if (!draw) setExporting(true);
    const params = new URLSearchParams(query);
    params.delete('page');
    params.delete('limit');
    if (categoryIds.length) params.set('categoryIds', categoryIds.join(','));
    try {
      if (draw) {
        if (!board || !heading) throw new Error('Không tìm thấy sơ đồ để xuất.');
        const { exportBracketPdf } = await import('@/lib/export-bracket-pdf');
        const filename = `${draw.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 160)}-${draw.id}.pdf`;
        await exportBracketPdf(board, heading, filename);
        toast.success(`Đã xuất PDF: ${draw.name}.`);
        return;
      }
      const endpoint = `/matches/event/${event.id}/export/matches.csv?${params}`;
      const response = await api.get(endpoint, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sportdata-danh-sach-${event.id}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Đã xuất CSV toàn bộ danh sách theo bộ lọc hiện tại.');
    } catch (error: any) {
      let detail = error.response?.data;
      if (detail instanceof Blob) {
        try { detail = JSON.parse(await detail.text()); } catch { detail = undefined; }
      }
      toast.error(Array.isArray(detail?.message) ? detail.message.join(', ') : detail?.message || 'Không thể xuất file. Vui lòng thử lại.');
    } finally { if (!draw) setExporting(false); }
  };
  return (
    <div className="space-y-5">
      <Card styles={{ body: { padding: 16 } }}>
        <div className="flex flex-wrap items-center gap-3">
          <Select mode="multiple" className="min-w-72 flex-1" aria-label="Hạng đấu" value={categoryIds.length ? categoryIds : ['ALL']} placeholder="Tất cả" maxTagCount="responsive" onChange={(values: string[]) => {
            const params = new URLSearchParams(searchParams.toString());
            const ids = values.at(-1) === 'ALL' ? [] : values.filter((value) => value !== 'ALL');
            params.delete('categoryId');
            if (ids.length) params.set('categoryIds', ids.join(','));
            else params.delete('categoryIds');
            setPage(1);
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }} options={[{ value: 'ALL', label: 'Tất cả' }, ...(event.categories || []).map((category: any) => ({ value: category.id, label: `${category.sport?.name || ''} · ${category.name}` }))]} />
          <Segmented value={view} onChange={(value) => setView(value as 'tree' | 'list')} options={[{ value: 'tree', label: 'Sơ đồ cây', icon: <Network className="h-4 w-4" /> }, { value: 'list', label: 'Danh sách', icon: <List className="h-4 w-4" /> }]} />

          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => Promise.all([mutate(), mutateDraws()])}>Làm mới</Button>
        </div>
      </Card>
      {view === 'tree' ? (
        <div className="space-y-5">
          {drawsError ? <ToastNotice type="error" showIcon message="Không thể tải sơ đồ cây" /> : drawsLoading ? <Card loading /> : draws.length ? draws.map((draw) => <SportdataBracket key={draw.id} draw={draw} onExportPdf={(board, heading) => exportFile(draw, board, heading)} sourceMatches={draws.flatMap((item) => item.matches)} readOnly={!canEditBracket} matchHref={(match) => withCmsReturnTo(`/cms/matches/${match.id}/edit`, matchReturnTo)} />) : <Card><Empty description="Chưa sinh sơ đồ cây cho hạng đấu này." /></Card>}
        </div>
      ) : (
        <Card styles={{ body: { padding: 0 } }}>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
            <span className="text-sm text-slate-500">Bấm biểu tượng lọc trên tiêu đề cột để tìm trận. Lọc cả hai cột VĐV để tìm cặp đấu theo bất kỳ thứ tự nào.</span>
            {hasFilters && <Button onClick={() => { setFilters({}); setPage(1); }}>Xóa bộ lọc</Button>}
            <Tooltip title="Xuất tất cả các trang theo bộ lọc và thứ tự hiện tại; mở được bằng Excel">
              <Button className="ml-auto" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={() => void exportFile()}>Xuất CSV</Button>
            </Tooltip>
          </div>
          {error ? (
            <ToastNotice
              className="m-4"
              type="error"
              showIcon
              message="Không thể tải danh sách trận đấu"
              description={loadError || 'Vui lòng thử làm mới danh sách.'}
            />
          ) : null}
          <Table<any>
            rowKey="id"
            loading={isLoading}
            dataSource={data?.items || []}
            className="cms-match-table"
            size="small"
            tableLayout="fixed"
            locale={{ emptyText: <Empty description={hasFilters ? 'Không tìm thấy trận đấu phù hợp. Thử đổi hoặc xóa bộ lọc.' : 'Chưa có trận đấu trong hạng đấu này.'} /> }}
            scroll={{ x: 1700 }}
            onChange={(pagination, tableFilters, sorter, extra) => {
              if (extra.action === 'filter') {
                const nextFilters: MatchFilters = {};
                Object.entries(tableFilters).forEach(([key, values]) => {
                  if (values?.[0] !== undefined && String(values[0]).trim()) {
                    Object.assign(nextFilters, { [key]: key === 'matchNumber' || key === 'round' ? Number(values[0]) : String(values[0]).trim() });
                  }
                });
                setFilters(nextFilters);
                setPage(1);
              } else if (extra.action === 'sort') {
                const selectedSort = Array.isArray(sorter) ? sorter[0] : sorter;
                setScheduleSort(selectedSort.order === 'descend' ? 'descend' : 'ascend');
                setPage(1);
              } else if (extra.action === 'paginate') {
                setPage(pagination.current || 1);
              }
            }}
            pagination={{
              current: data?.meta?.page || page,
              pageSize,
              total: data?.meta?.total || 0,
              showSizeChanger: false,
              hideOnSinglePage: true,
              showTotal: (total) => `${total} trận đấu`,
            }}
            columns={[
              { title: 'Thứ tự thi đấu', dataIndex: 'scheduleOrder', key: 'scheduleOrder', width: 140, sorter: true, sortOrder: scheduleSort, sortDirections: ['ascend', 'descend', 'ascend'], render: (value: number | null) => value ?? 'Chưa xếp giờ' },
              { title: 'Hạng đấu', key: 'category', width: 220, render: (_: unknown, match: any) => match.category?.name || '—' },
              { title: '#', dataIndex: 'matchNumber', width: 90, ...columnFilter('matchNumber', 'Số trận', 'number') },
              { title: 'Vòng', dataIndex: 'round', width: 90, ...columnFilter('round', 'Vòng đấu', 'number') },
              {
                title: 'Ngày / giờ',
                ...columnFilter('date', 'Ngày thi đấu', 'date'),
                width: 220,
                render: (_: unknown, match: any) => match.startTime
                  ? dayjs(match.startTime).tz('Asia/Ho_Chi_Minh').format('HH:mm DD/MM/YYYY')
                  : `${dayjs(match.matchDate).tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY')} · Chưa xếp giờ`,
              },
              { title: 'VĐV 1', width: 220, ...columnFilter('athleteName', 'Tên VĐV (ở bất kỳ bên nào)'), render: (_: unknown, match: any) => renderAthlete(match, 1) },
              { title: 'VĐV 2', width: 220, ...columnFilter('opponentName', 'Tên đối thủ (ở bất kỳ bên nào)'), render: (_: unknown, match: any) => renderAthlete(match, 2) },
              {
                title: 'Điểm',
                key: 'score',
                width: 180,
                align: 'center',
                render: (_: unknown, match: any) => match.athlete1 && match.athlete2 ? (
                  <div className="inline-flex min-w-[148px] items-center justify-center gap-2 whitespace-nowrap text-base font-bold leading-tight tabular-nums text-slate-100">
                    <span aria-label={isWinner(match, 1) ? `Điểm của người thắng: ${match.athlete1.fullName}` : undefined} className={`px-2 py-1 ${isWinner(match, 1) ? 'rounded-md bg-emerald-500/15 text-emerald-500 ring-1 ring-inset ring-emerald-500/30' : ''}`}>{formatScore(match.athlete1Score)}</span>
                    <span className="text-slate-500">–</span>
                    <span aria-label={isWinner(match, 2) ? `Điểm của người thắng: ${match.athlete2.fullName}` : undefined} className={`px-2 py-1 ${isWinner(match, 2) ? 'rounded-md bg-emerald-500/15 text-emerald-500 ring-1 ring-inset ring-emerald-500/30' : ''}`}>{formatScore(match.athlete2Score)}</span>
                  </div>
                ) : '—',
              },
              {
                title: 'Sân',
                dataIndex: 'fop',
                width: 170,
                ...columnFilter('venue', 'Tên sân / sàn'),
                render: (value: string, match: any) => match.fopRecord?.name || value || 'Chưa chọn sân',
              },
              { title: 'Trạng thái', key: 'status', dataIndex: 'status', width: 150, filters: Object.entries(MATCH_STATUS_META).map(([value, meta]) => ({ value, text: meta.label })), filterMultiple: false, filteredValue: filters.status ? [filters.status] : null, render: (value: string) => <Tag color={MATCH_STATUS_META[value]?.color}>{MATCH_STATUS_META[value]?.label || value}</Tag> },
            ]}
          />
        </Card>
      )}
      <AthleteQuickViewModal athleteId={selectedAthleteId} open={Boolean(selectedAthleteId)} onClose={() => setSelectedAthleteId(undefined)} />
    </div>
  );
}

function formatScore(value: unknown) {
  const score = Number(value || 0);
  return Number.isInteger(score) ? String(score) : score.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

function PaymentTab({ event, canEdit, onRefresh }: EventWorkspaceProps & { canEdit: boolean }) {
  const toast = useSportDataToast();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const paymentMode = Form.useWatch('paymentMode', form);
  const paymentProviders = Form.useWatch('paymentProviders', form) || [];
  const needsBank = paymentMode === 'MANUAL' || paymentProviders.includes('BANK_QR');
  const { data: gatewayConfig } = useSWR<{
    enabled: Record<string, boolean>;
    configured: Record<string, boolean>;
    paymentsEnabled: boolean;
    environment: string;
  }>('/payments/configuration', fetcher);

  useEffect(() => {
    form.setFieldsValue({
      registrationEnabled: event.registrationEnabled,
      registrationOpenAt: event.registrationOpenAt ? dayjs(event.registrationOpenAt) : null,
      registrationCloseAt: event.registrationCloseAt ? dayjs(event.registrationCloseAt) : null,
      paymentMode: event.paymentMode || 'FREE',
      registrationFee: event.registrationFee || 0,
      registrationCurrency: event.registrationCurrency || 'VND',
      paymentProviders: event.paymentProviders || [],
      bankCode: event.bankCode || '',
      bankAccountNumber: event.bankAccountNumber || '',
      bankAccountName: event.bankAccountName || '',
    });
  }, [event, form]);

  const save = async (values: any) => {
    setSaving(true);
    try {
      await api.patch(`/events/${event.id}`, {
        ...values,
        registrationOpenAt: values.registrationOpenAt?.toISOString() || null,
        registrationCloseAt: values.registrationCloseAt?.toISOString() || null,
        registrationFee: values.paymentMode === 'FREE' ? 0 : values.registrationFee || 0,
        registrationCurrency: 'VND',
        paymentProviders: values.paymentMode === 'FREE'
          ? []
          : values.paymentMode === 'MANUAL'
            ? ['BANK_QR']
            : values.paymentProviders,
      });
      await onRefresh();
      toast.success('Đã lưu cấu hình đăng ký và thanh toán.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể lưu cấu hình thanh toán.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={<span className="flex items-center gap-2"><BadgeDollarSign className="h-5 w-5 text-emerald-500" />Đăng ký & thanh toán</span>}>
      <Form form={form} layout="vertical" onFinish={save} disabled={!canEdit} className="max-w-4xl">
        <Form.Item name="registrationEnabled" label="Mở cổng đăng ký" valuePropName="checked"><Switch /></Form.Item>
        <div className="grid gap-4 md:grid-cols-2">
          <Form.Item name="registrationOpenAt" label="Thời gian mở đăng ký"><DateTimeFields label="Thời gian mở đăng ký" /></Form.Item>
          <Form.Item name="registrationCloseAt" label="Thời gian đóng đăng ký"><DateTimeFields label="Thời gian đóng đăng ký" /></Form.Item>
          <Form.Item name="paymentMode" label="Phương thức thanh toán"><Select options={paymentModeOptions} /></Form.Item>
          <Form.Item name="registrationFee" label="Lệ phí mỗi hạng đấu" rules={[{ validator: (_, value) => paymentMode === 'FREE' || Number(value) > 0 ? Promise.resolve() : Promise.reject(new Error('Lệ phí phải lớn hơn 0')) }]}><InputNumber<number> className="w-full" style={{ width: '100%', minWidth: 260 }} min={0} step={10000} precision={0} formatter={(value) => value == null ? '' : new Intl.NumberFormat('vi-VN').format(value)} parser={(value) => Number(String(value || '').replace(/[^0-9]/g, ''))} disabled={!canEdit || paymentMode === 'FREE'} addonAfter={Form.useWatch('registrationCurrency', form) || 'VND'} /></Form.Item>
          <Form.Item name="registrationCurrency" label="Đơn vị tiền tệ"><Select options={[{ value: 'VND', label: 'VND' }]} /></Form.Item>
        </div>

        {paymentMode === 'ONLINE' ? (
          <Form.Item
            name="paymentProviders"
            label="Cổng thanh toán hiển thị cho vận động viên"
            rules={[{ required: true, message: 'Chọn ít nhất một cổng thanh toán' }]}
          >
            <Checkbox.Group className="grid gap-3 sm:grid-cols-2" options={paymentProviderOptions.map((option) => ({
              ...option,
              label: (
                <span>
                  {option.label}{' '}
                  {gatewayConfig ? (
                    <Tag color={gatewayConfig.enabled[option.value] ? 'success' : gatewayConfig.configured[option.value] ? 'default' : 'warning'}>
                      {gatewayConfig.enabled[option.value]
                        ? 'Sẵn sàng'
                        : gatewayConfig.configured[option.value]
                          ? 'Đang tắt trong hệ thống'
                          : 'Thiếu cấu hình ENV'}
                    </Tag>
                  ) : null}
                </span>
              ),
            }))} />
          </Form.Item>
        ) : null}

        {needsBank ? (
          <Card size="small" className="mb-5" title="Tài khoản nhận chuyển khoản VietQR">
            <div className="grid gap-4 md:grid-cols-3">
              <Form.Item name="bankCode" label="Mã ngân hàng" rules={[{ required: true, message: 'Nhập mã ngân hàng' }]}>
                <Input placeholder="VD: VCB, BIDV, MB" />
              </Form.Item>
              <Form.Item name="bankAccountNumber" label="Số tài khoản" rules={[{ required: true, message: 'Nhập số tài khoản' }]}>
                <Input autoComplete="off" />
              </Form.Item>
              <Form.Item name="bankAccountName" label="Tên chủ tài khoản" rules={[{ required: true, message: 'Nhập tên chủ tài khoản' }]}>
                <Input placeholder="SPORTDATA VIET NAM" />
              </Form.Item>
            </div>
          </Card>
        ) : null}
        {canEdit && <Button htmlType="submit" type="primary" loading={saving}>Lưu cấu hình thanh toán</Button>}
      </Form>
    </Card>
  );
}

function TicketDesignTab({ event, canEdit, onRefresh }: EventWorkspaceProps & { canEdit: boolean }) {
  const toast = useSportDataToast();
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewRole, setPreviewRole] = useState('ATHLETE');
  const savedDesign = JSON.stringify(event.ticketDesign || null);
  const [design, setDesign] = useState<TicketDesign>(() => ticketDesign(event.ticketDesign));
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(ticketDesign(event.ticketDesign)));
  useEffect(() => {
    const next = ticketDesign(JSON.parse(savedDesign));
    setDesign(next);
    setSavedSnapshot(JSON.stringify(next));
  }, [event.id, savedDesign]);
  const dirty = JSON.stringify(design) !== savedSnapshot;
  const sampleTicket: ParticipationTicket = {
    ticketCode: 'SD-A6-PREVIEW', status: 'CONFIRMED',
    ...(previewRole !== 'ATHLETE' ? { role: previewRole, roleLabel: eventRoleLabel(previewRole) } : {}),
    event: { id: event.id, name: event.name, startDate: event.startDate, endDate: event.endDate, location: event.location, ticketBackgroundUrl: event.ticketBackgroundUrl },
    sport: event.sports?.[0] || event.sport,
    category: { name: previewRole === 'ATHLETE' ? event.categories?.[0]?.name || 'Hạng đấu / nội dung' : eventRoleLabel(previewRole) },
    athlete: { fullName: 'NGUYỄN VĂN ĐỘNG VIÊN', country: { name: 'Việt Nam' }, federation: { name: 'Đơn vị / CLB' } },
  };
  const save = async () => {
    setSaving(true);
    try {
      const layout = validateTicketDesign(design);
      await api.patch(`/events/${event.id}`, { ticketDesign: layout });
      setDesign(layout); setSavedSnapshot(JSON.stringify(layout));
      await onRefresh();
      toast.success('Đã lưu bố cục. Thẻ tải xuống và gửi email sẽ dùng vị trí này.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || error.message || 'Không thể lưu bố cục thẻ.');
    } finally { setSaving(false); }
  };

  const uploadProps: UploadProps = {
    accept: 'image/jpeg,image/png',
    showUploadList: false,
    disabled: !canEdit || uploading,
    beforeUpload: (file) => {
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        toast.error('Ảnh nền thẻ chỉ hỗ trợ JPG hoặc PNG.');
        return Upload.LIST_IGNORE;
      }
      if (file.size > 6 * 1024 * 1024) {
        toast.error('Ảnh nền thẻ không được vượt quá 6 MB.');
        return Upload.LIST_IGNORE;
      }
      return true;
    },
    customRequest: async ({ file, onSuccess, onError }) => {
      setUploading(true);
      try {
        const data = new FormData();
        data.append('file', file as File);
        await api.patch(`/events/${event.id}/ticket-background`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
        await onRefresh();
        toast.success('Đã cập nhật ảnh nền thẻ cho sự kiện.');
        onSuccess?.({});
      } catch (error: any) {
        toast.error(error.response?.data?.message || 'Không thể tải ảnh nền thẻ.');
        onError?.(error);
      } finally {
        setUploading(false);
      }
    },
  };

  const remove = async () => {
    try {
      await api.delete(`/events/${event.id}/ticket-background`);
      await onRefresh();
      toast.success('Đã xóa ảnh nền thẻ.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể xóa ảnh nền thẻ.');
    }
  };

  return (
    <div className="space-y-6">
      <EventParticipationTickets key={event.id} eventId={event.id} />
      <Card title="Xem trước vùng in A6" extra={<Tag color="blue">105 × 148 mm</Tag>}>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Select aria-label="Vai trò xem trước trên thẻ" value={previewRole} onChange={setPreviewRole} className="w-full sm:w-48" options={[
            { value: 'ATHLETE', label: 'Vận động viên' }, { value: 'COACH', label: 'Huấn luyện viên' },
            { value: 'REFEREE', label: 'Trọng tài' }, { value: 'TEAM_LEADER', label: 'Trưởng đoàn' },
          ]} />
          {canEdit && <>
            <Upload {...uploadProps}><Button loading={uploading} disabled={saving} icon={<UploadCloud className="h-4 w-4" />}>{event.ticketBackgroundUrl ? 'Thay ảnh nền' : 'Tải ảnh nền'}</Button></Upload>
            {event.ticketBackgroundUrl && <Popconfirm title="Xóa ảnh nền thẻ?" onConfirm={remove} okText="Xóa" cancelText="Hủy"><Button danger disabled={uploading || saving} icon={<Trash2 className="h-4 w-4" />}>Xóa nền</Button></Popconfirm>}
            <Button type="primary" loading={saving} disabled={uploading || !dirty} onClick={save}>Lưu bố cục thẻ</Button>
            {dirty && <Tag color="orange">Chưa lưu bố cục</Tag>}
          </>}
          <span className="text-sm text-slate-500">Nền JPG/PNG tối đa 6 MB, giữ nguyên màu. Nên dùng ảnh đúng tỉ lệ A6.</span>
        </div>
        <TicketDesignEditor key={event.id} ticket={sampleTicket} design={design} onChange={setDesign} disabled={!canEdit || saving} />
      </Card>
    </div>
  );
}

function BracketTab({ event, canOperate, preconfigureActorId }: { event: any; canOperate: boolean; preconfigureActorId?: string }) {
  const toast = useSportDataToast();
  const { mutate: mutateGlobal } = useSWRConfig();
  const [categoryId, setCategoryId] = useState<string>(event.categories?.[0]?.id || '');
  const [format, setFormat] = useState<'SINGLE' | 'DOUBLE' | 'REPECHAGE' | 'REPECHAGE_QUARTERFINALS' | 'ROUND_ROBIN' | 'ABSOLUTE'>('REPECHAGE_QUARTERFINALS');
  const [seedingMode, setSeedingMode] = useState('STANDARD');
  const [groupCount, setGroupCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [preconfigurationBusy, setPreconfigurationBusy] = useState(false);
  const category = event.categories?.find((item: any) => item.id === categoryId);
  const { data: entries = [], isLoading, mutate: mutateEntries } = useSWR<any[]>(categoryId ? `/competitions/events/${event.id}/categories/${categoryId}/entries` : null, fetcher);
  const { data: drawState, error: drawStateError, isLoading: drawStateLoading } = useSWR<{
    version: string; canRevert: boolean; drawCount: number; groupCount: number; matchCount: number; reason?: string;
  }>(canOperate && categoryId ? `/matches/event/${event.id}/category/${categoryId}/draw-state` : null, fetcher, { refreshInterval: 5000 });
  const hasDraws = !!drawState && (drawState.drawCount > 0 || drawState.groupCount > 0);
  const activeEntries = entries.filter((entry) => entry.status === 'VERIFIED' && (entry.type === 'INDIVIDUAL' && entry.athlete?.id || ['DUO', 'SHOW'].includes(category?.discipline) && entry.type === 'TEAM' && entry.team?.members?.length === 2));
  const isRepechage = format === 'REPECHAGE' || format === 'REPECHAGE_QUARTERFINALS';
  const usesRoundRobin = format === 'ROUND_ROBIN' || (isRepechage && activeEntries.length < 6);
  const drawType = format === 'ROUND_ROBIN' ? 'ROUND_ROBIN_POOL' : format === 'DOUBLE' ? 'DOUBLE_ELIMINATION' : isRepechage ? format : 'MAIN_TREE';
  const minimumEntries = format === 'DOUBLE' ? 4 : 2;

  const updateSeed = async (entry: any, seed: number | null) => {
    try {
      await api.patch(`/competitions/entries/${entry.id}/seed`, { seed });
      await mutateEntries();
      toast.success(seed ? `Đã đặt hạt giống số ${seed}.` : 'Đã xóa hạt giống.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể cập nhật hạt giống.');
    }
  };

  const refreshDraws = async () => {
    await Promise.all([
      mutateGlobal((key) => {
        const url = typeof key === 'string' ? key : Array.isArray(key) ? key[0] : null;
        return typeof url === 'string' && (url.startsWith(`/matches/event/${event.id}/`) || url.startsWith('/matches?'));
      }),
      mutateEntries(),
    ]);
  };

  const revert = async () => {
    if (!drawState?.canRevert || reverting || generating) return;
    setReverting(true);
    try {
      await api.post(`/matches/event/${event.id}/category/${categoryId}/revert-draw`, { version: drawState.version });
      await refreshDraws();
      toast.success('Đã thu hồi nhánh đấu. Bạn có thể chỉnh seed và chia lại các cặp trận.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể thu hồi nhánh đấu.');
      await refreshDraws();
    } finally { setReverting(false); }
  };

  const generate = async () => {
    if (!categoryId || activeEntries.length < minimumEntries) {
      toast.error(`Cần ít nhất ${minimumEntries} lượt đăng ký hợp lệ để sinh nhánh đấu.`);
      return;
    }
    if (format === 'ABSOLUTE' && (category?.minWeight != null || category?.maxWeight != null)) {
      toast.error('Hạng Tuyệt đối phải là hạng mở, không cấu hình giới hạn cân nặng.');
      return;
    }
    setGenerating(true);
    try {
      const currentEntries: any[] = await mutateEntries();
      const athleteIds = (currentEntries || []).filter((entry) => entry.status === 'VERIFIED'
        && (entry.type === 'INDIVIDUAL' && entry.athlete?.id || entry.type === 'TEAM' && entry.team?.members?.length === 2)).map((entry) => entry.athlete?.id || entry.team.id);
      await api.post(`/matches/event/${event.id}/category/${categoryId}/generate-draw`, {
        athleteIds,
        type: drawType,
        seedingMode,
        groupCount: isRepechage ? 1 : usesRoundRobin ? groupCount : undefined,
        name: format === 'ABSOLUTE' ? 'Hạng Tuyệt đối' : undefined,
        fops: event.fops?.length ? event.fops.map((fop: any) => fop.name) : undefined,
      });
      await refreshDraws();
      toast.success('Đã sinh thể thức và danh sách trận đấu tự động. Mở tab Trận đấu để xem sơ đồ cây.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Không thể sinh nhánh đấu.');
    } finally {
      setGenerating(false);
    }
  };

  const formatCards = [
    { value: 'REPECHAGE_QUARTERFINALS', title: 'Quaterfinals Repechage', description: 'Chỉ người thua tứ kết vào 2 trận vớt sau khi cả hai bán kết được xác nhận. Tranh 2 HCĐ chéo nhánh. Dưới 6 VĐV đấu vòng tròn.' },
    { value: 'REPECHAGE', title: 'Repechage Brackets', description: 'Nhánh chính tranh vàng/bạc, hai nhánh vớt tranh HCĐ. Dưới 6 VĐV tự động đấu vòng tròn.' },
    { value: 'SINGLE', title: 'Loại trực tiếp', description: 'Thua một trận bị loại. Phù hợp phần lớn giải đấu.' },
    { value: 'DOUBLE', title: 'Loại kép', description: 'Thi đấu theo nhánh thắng, nhánh thua và trận chung kết.' },
    { value: 'ROUND_ROBIN', title: 'Đấu vòng tròn', description: 'Mọi VĐV trong bảng thi đấu với nhau, phù hợp bảng nhỏ.' },
    // { value: 'ABSOLUTE', title: 'Tuyệt đối / Open Weight', description: 'Không giới hạn hạng cân; dùng cây loại trực tiếp.' },
  ] as const;

  return (
    <div className="space-y-5">
      <Card title="1. Chọn hạng đấu">
        <Select className="w-full" aria-label="Hạng đấu" value={categoryId || undefined} placeholder="Chọn hạng đấu" onChange={setCategoryId} options={(event.categories || []).map((item: any) => ({ value: item.id, label: `${item.sport?.name || ''} · ${item.name}` }))} />
      </Card>
      {preconfigureActorId && categoryId && !isLoading && <DrawPreconfiguration
        key={`${event.id}:${categoryId}:${drawType}:${format}:${preconfigureActorId}`}
        event={event} categoryId={categoryId} drawType={drawType} actorId={preconfigureActorId}
        entries={activeEntries} name={format === 'ABSOLUTE' ? 'Hạng Tuyệt đối' : undefined}
        onSeedingMode={setSeedingMode} onGroupCount={setGroupCount} onBusy={setPreconfigurationBusy}
      />}
      <Card title="2. Chọn thể thức">
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {formatCards.map((item) => (
            <button key={item.value} type="button" onClick={() => setFormat(item.value)} className={`rounded-2xl border p-4 text-left transition ${format === item.value ? 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500' : 'border-slate-300/20 hover:border-sky-500/50'}`}>
              <strong className="block">{item.title}</strong>
              <span className="mt-2 block text-sm text-slate-500">{item.description}</span>
            </button>
          ))}
        </div>
        {isRepechage && usesRoundRobin && <ToastNotice className="!mt-4" type="info" showIcon message="Dưới 6 VĐV: tự động dùng vòng tròn. Cặp đặt trước áp dụng ở lượt đấu đầu." />}
        {format === 'REPECHAGE_QUARTERFINALS' && !usesRoundRobin && <ToastNotice className="!mt-4" type="info" showIcon message="Người thua trước tứ kết bị loại. Thua TK1 gặp thua TK2 ở vớt A; thua TK3 gặp thua TK4 ở vớt B. Chỉ bắt đầu vớt sau khi cả hai bán kết hoàn tất và xác nhận kết quả. Thắng vớt A gặp thua bán kết 2; thắng vớt B gặp thua bán kết 1. Hai người thắng cùng nhận HCĐ." />}
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {preconfigureActorId ? <span className="self-center text-sm text-slate-500">Cấu hình cặp và cách xếp trong Pre-matches phía trên.</span> : format === 'ROUND_ROBIN' ? <InputNumber className="w-full" min={1} max={Math.max(1, Math.min(16, Math.floor(activeEntries.length / 2)))} value={groupCount} onChange={(value) => setGroupCount(value || 1)} addonBefore="Số bảng" /> : usesRoundRobin ? <span className="self-center text-sm text-slate-500">Thi đấu vòng tròn trong một bảng.</span> : <Select value={seedingMode} onChange={setSeedingMode} options={[{ value: 'STANDARD', label: 'Xếp hạt giống chuẩn' }, { value: 'RANDOM', label: 'Ngẫu nhiên' }, { value: 'COUNTRY_SEPARATED', label: 'Tách quốc gia' }, { value: 'FEDERATION_SEPARATED', label: 'Tách đơn vị / CLB' }]} />}
          <Space wrap>
            <Button type="primary" disabled={!canOperate || isLoading || drawStateLoading || !!drawStateError || hasDraws || reverting || activeEntries.length < minimumEntries || (!!preconfigureActorId && preconfigurationBusy)} loading={generating} onClick={generate} icon={<Network className="h-4 w-4" />}>Sinh nhánh đấu tự động</Button>
            {canOperate && hasDraws && <Popconfirm
              title="Thu hồi nhánh đấu của hạng này?"
              description="Xóa nhánh và các trận đã sinh, gồm lịch đã xếp. Danh sách VĐV và seed được giữ để chia lại."
              okText="Thu hồi nhánh" cancelText="Hủy" okButtonProps={{ danger: true }}
              disabled={!drawState.canRevert || reverting || generating} onConfirm={revert}
            >
              <Button danger disabled={!drawState.canRevert || reverting || generating} loading={reverting}>Thu hồi nhánh đấu</Button>
            </Popconfirm>}
          </Space>
        </div>
        {!usesRoundRobin && <p className="mt-3 text-sm text-slate-500">Seed 1 và 2 ở hai nửa cây; các seed tiếp theo được phân đều để gặp nhau muộn. Ngẫu nhiên và tách quốc gia/CLB vẫn giữ vị trí seed.</p>}
        {hasDraws && <ToastNotice className="!mt-4" showIcon type={drawState.canRevert ? 'info' : 'warning'}
          message={drawState.canRevert ? `Đã sinh ${drawState.matchCount} trận. Có thể thu hồi nhánh để chỉnh seed và chia lại trước khi bắt đầu thi đấu.` : drawState.reason} />}
        {drawStateError && <ToastNotice className="!mt-4" showIcon type="error" message="Không thể kiểm tra trạng thái nhánh đấu. Hãy tải lại trang." />}
      </Card>
      <Card title={`3. Danh sách đầu vào (${activeEntries.length} VĐV)`} loading={isLoading}>
        {activeEntries.length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{activeEntries.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-300/15 px-3 py-2"><div className="min-w-0"><strong className="block truncate">{entry.athlete?.fullName || entry.team?.members?.map((member: any) => member.athlete.fullName).join(' / ')}</strong><div className="truncate text-xs text-slate-500">{entry.athlete?.federation?.name || entry.country?.name || 'VĐV tự do'}</div></div><div className="w-24"><SeedInput value={entry.seed} disabled={!canOperate} onSave={(value) => void updateSeed(entry, value)} /></div></div>)}</div> : <Empty description="Chưa có lượt đăng ký đã xác nhận cho hạng đấu này." />}
      </Card>
    </div>
  );
}
