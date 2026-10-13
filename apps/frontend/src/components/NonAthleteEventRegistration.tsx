'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Button, Card, Form, Input, Result, Select, Spin, Tag } from 'antd';
import { fetcher } from '@/lib/api';
import { ParticipationTicketActions } from './ParticipationTicketActions';
import { getParticipantToken, participantApi, participantError } from '@/lib/participant-auth';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { eventRoleLabel, participationStatusLabels, type EventParticipation, type ParticipationRole } from '@/lib/event-participation';
import { optimizeRegistrationMedia } from '@/lib/registration-media';
import { RegistrationMediaPicker } from './RegistrationMediaPicker';

type EventInfo = {
  id: string;
  name: string;
  startDate: string;
  registrationEnabled: boolean;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  participatingFederations?: { id: string }[];
};
type Federation = { id: string; name: string; country?: { code: string } };
type Profile = { displayName: string; email: string; phone?: string | null; federationId?: string | null };
type RegistrationValues = {
  contactName: string; contactEmail: string; contactPhone?: string; federationId?: string;
  identityType: 'CCCD' | 'PASSPORT'; documentNumber: string;
  avatar: File; cccdFront?: File; cccdBack?: File; passport?: File;
};
type MediaUploadReference = { id: string; token: string };

export function NonAthleteEventRegistration({ eventId, role, embedded = false }: { eventId: string; role: ParticipationRole; embedded?: boolean }) {
  const [form] = Form.useForm();
  const toast = useSportDataToast();
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<EventParticipation>();
  const [now, setNow] = useState(() => Date.now());
  const { data: event, isLoading } = useSWR<EventInfo>(`/events/${eventId}`, fetcher);
  const { data: federations = [] } = useSWR<Federation[]>('/federations', fetcher);
  const { data: profile } = useSWR<Profile>(getParticipantToken() ? '/participant-auth/me' : null, (url: string) => participantApi.get(url).then(({ data }) => data));
  const { data: mine = [], mutate } = useSWR<EventParticipation[]>(getParticipantToken() ? `/participant-auth/event-participations?eventId=${eventId}` : null, (url: string) => participantApi.get(url).then(({ data }) => data), { refreshInterval: 30_000 });
  const existing = mine.find((item) => item.role === role);
  const identityType = Form.useWatch('identityType', form) || 'CCCD';
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (profile) form.setFieldsValue({ contactName: profile.displayName, contactEmail: profile.email, contactPhone: profile.phone || '', federationId: profile.federationId || undefined });
  }, [profile, form]);

  const submit = async (values: RegistrationValues) => {
    setSubmitting(true);
    try {
      const upload = async (file: File, type: string) => {
        const body = new FormData();
        body.append('file', await optimizeRegistrationMedia(file));
        body.append('type', type);
        const { data } = await participantApi.post<MediaUploadReference>('/participant-auth/media-uploads', body);
        return { id: data.id, token: data.token };
      };
      const [avatar, cccdFront, cccdBack, passport] = await Promise.all([
        upload(values.avatar, 'AVATAR'),
        values.identityType === 'CCCD' ? upload(values.cccdFront!, 'CCCD_FRONT') : undefined,
        values.identityType === 'CCCD' ? upload(values.cccdBack!, 'CCCD_BACK') : undefined,
        values.identityType === 'PASSPORT' ? upload(values.passport!, 'PASSPORT') : undefined,
      ]);
      const { data } = await participantApi.post<EventParticipation>('/participant-auth/event-participations', {
        eventId, role, contactName: values.contactName, contactEmail: values.contactEmail,
        contactPhone: values.contactPhone, federationId: values.federationId,
        identityType: values.identityType, documentNumber: values.documentNumber,
        mediaUploads: { avatar, cccdFront, cccdBack, passport },
      });
      setReceipt(data);
      await mutate();
      toast.success('Đã gửi hồ sơ đăng ký tham gia sự kiện.');
    } catch (error) {
      toast.error(participantError(error, 'Không thể đăng ký tham gia sự kiện'));
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) return <main className="grid min-h-[40vh] place-items-center"><Spin /></main>;
  if (!event) return <main className="mx-auto max-w-6xl p-4"><Card>Không thể tải sự kiện. Vui lòng thử lại.</Card></main>;
  const open = event.registrationEnabled && (!event.registrationOpenAt || now >= Date.parse(event.registrationOpenAt))
    && now <= Date.parse(event.registrationCloseAt || event.startDate);
  const record = existing || receipt;
  const eligibleFederations = event.participatingFederations?.length
    ? federations.filter((item) => event.participatingFederations!.some((unit) => unit.id === item.id)) : federations;
  return (
    <main className={embedded ? 'registration-contact-form' : 'mx-auto max-w-6xl px-4 py-6'}>
      <Card title={embedded ? 'Thông tin người tham gia' : `${event.name} · ${eventRoleLabel(role)}`}>
        {record ? <Result status={record.status === 'REJECTED' ? 'warning' : 'success'} title={participationStatusLabels[record.status]} subTitle={<>
          <p>Mã hồ sơ: {record.referenceCode}</p>
          {record.federation && <p>Đơn vị / CLB: {record.federation.name}</p>}
          {record.statusReason && <p>{record.statusReason}</p>}
          <p>Vé được phát hành và gửi tới email đăng ký sau khi hồ sơ được duyệt.</p>
        </>} extra={<div className="flex flex-wrap justify-center gap-3"><ParticipationTicketActions code={record.referenceCode} status={record.status} /><Link href={`/events/${eventId}`}><Button>Xem sự kiện</Button></Link></div>} /> : <>
          <p className="registration-muted mb-6">{profile ? `Đăng ký bằng tài khoản ${profile.displayName}. Vé sẽ được gửi tới ${profile.email}.` : 'Nhập thông tin liên hệ của bạn. Vé được gửi tới email này sau khi hồ sơ được duyệt.'}</p>
          {!open && <Tag className="mb-4" color="warning">Sự kiện hiện chưa mở hoặc đã hết hạn đăng ký</Tag>}
          <Form form={form} layout="vertical" onFinish={submit} initialValues={{ identityType: 'CCCD' }} disabled={submitting}>
            <Form.Item name="contactName" label="Họ và tên" rules={[{ required: true, whitespace: true, min: 2, max: 200 }]}><Input size="large" disabled={Boolean(profile)} autoComplete="name" /></Form.Item>
            <Form.Item name="contactEmail" label="Email liên hệ" rules={[{ required: true }, { type: 'email' }]}><Input size="large" disabled={Boolean(profile)} autoComplete="email" /></Form.Item>
            <Form.Item name="contactPhone" label="Số điện thoại"><Input size="large" maxLength={30} autoComplete="tel" /></Form.Item>
            <Form.Item name="federationId" label="Đơn vị / CLB" rules={[{ required: role === 'TEAM_LEADER' || role === 'REFEREE', message: 'Vui lòng chọn đơn vị / CLB' }]}>
              <Select size="large" showSearch allowClear optionFilterProp="label" placeholder="Chọn đơn vị / CLB" options={eligibleFederations.map((item) => ({ value: item.id, label: `${item.name}${item.country?.code ? ` · ${item.country.code}` : ''}` }))} />
            </Form.Item>
            <Form.Item name="identityType" label="Loại giấy tờ" rules={[{ required: true }]}>
              <Select size="large" options={[{ value: 'CCCD', label: 'Căn cước công dân' }, { value: 'PASSPORT', label: 'Hộ chiếu' }]} onChange={() => form.setFieldsValue({ documentNumber: undefined, cccdFront: undefined, cccdBack: undefined, passport: undefined })} />
            </Form.Item>
            <Form.Item name="documentNumber" label={identityType === 'CCCD' ? 'Số căn cước công dân' : 'Số hộ chiếu'} rules={[
              { required: true, whitespace: true, message: 'Vui lòng nhập số giấy tờ' },
              { validator: (_, value) => {
                const number = (value || '').toUpperCase().replace(/[\s.-]/g, '');
                return (identityType === 'CCCD' ? /^\d{12}$/ : /^[A-Z0-9]{5,20}$/).test(number)
                  ? Promise.resolve() : Promise.reject(new Error(identityType === 'CCCD' ? 'Số căn cước phải có 12 chữ số' : 'Số hộ chiếu phải có 5–20 ký tự chữ hoặc số'));
              } },
            ]}><Input size="large" maxLength={30} /></Form.Item>
            <Form.Item name="avatar" label="Ảnh thẻ / ảnh đại diện" rules={[{ required: true, message: 'Vui lòng chọn ảnh thẻ' }]}>
              <RegistrationMediaPicker allowPdf={false} />
            </Form.Item>
            <p className="registration-muted mb-4">Tải lên giấy tờ khớp với số đã nhập. Hỗ trợ ảnh JPG, PNG, WebP hoặc PDF.</p>
            {identityType === 'CCCD' ? <div className="grid gap-4 sm:grid-cols-2">
              <Form.Item name="cccdFront" label="Căn cước mặt trước" rules={[{ required: true, message: 'Vui lòng chọn căn cước mặt trước' }]}><RegistrationMediaPicker /></Form.Item>
              <Form.Item name="cccdBack" label="Căn cước mặt sau" rules={[{ required: true, message: 'Vui lòng chọn căn cước mặt sau' }]}><RegistrationMediaPicker /></Form.Item>
            </div> : <Form.Item name="passport" label="Hộ chiếu" rules={[{ required: true, message: 'Vui lòng chọn hộ chiếu' }]}><RegistrationMediaPicker /></Form.Item>}
            <Button block type="primary" size="large" htmlType="submit" loading={submitting} disabled={!open}>Gửi đăng ký · {eventRoleLabel(role)}</Button>
          </Form>
        </>}
      </Card>
    </main>
  );
}
