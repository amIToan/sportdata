'use client';

import { ToastNotice } from '@/components/ToastNotice';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Button,
  Card,
  DatePicker,
  Image,
  Input,
  Result,
  Segmented,
  Select,
  Spin,
  Tag,
  Upload,
} from 'antd';
import { Download, FileImage, ImageIcon, Loader2, Plus, RefreshCw, Send, Trash2, UploadCloud, Users } from 'lucide-react';
import { RegistrationDisciplines, registrationCategoryLabel, type DisciplineEntry, type RegistrationCategory } from '@/components/RegistrationDisciplines';
import { CameraCaptureButton } from '@/components/CameraCaptureButton';
import { IssuedAthleteTicket } from '@/components/IssuedAthleteTicket';
import { distinctAthleteTickets, isTicketIssued } from '@/lib/athlete-tickets';
import type { TicketDesign } from '@/lib/ticket-design';
import { PaymentCheckout } from '@/components/PaymentCheckout';
import { IdentityOcrReviewModal, type IdentityOcrFields, type IdentityOcrResult } from '@/components/IdentityOcrReviewModal';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { fetcher } from '@/lib/api';
import { getParticipantAccount, getParticipantToken, participantApi, participantError, type SportDataAccount } from '@/lib/participant-auth';
import type { ParticipationTicket } from '@/lib/ticket-types';
import { vietnamCountryId } from '@/lib/countries';
import { capitalizeRegistrationName } from '@/lib/registration-names';
import { optimizeRegistrationMedia } from '@/lib/registration-media';

type RegistrationMode = 'INDIVIDUAL' | 'GROUP';
type IdentityType = 'CCCD' | 'PASSPORT';
type Country = { id: string; code: string; name: string };
type Federation = { id: string; name: string; countryId: string };
type Category = RegistrationCategory & {
  gender: string;
  minAge?: number | null;
  maxAge?: number | null;
  minWeight?: number | null;
  maxWeight?: number | null;
};
type EventData = {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  location?: string | null;
  ticketBackgroundUrl?: string | null;
  ticketDesign?: TicketDesign | null;
  ticketThemePreset?: string | null;
  ticketLayout?: string | null;
  ticketPrimaryColor?: string | null;
  ticketSecondaryColor?: string | null;
  ticketAccentColor?: string | null;
  paymentMode?: 'FREE' | 'MANUAL' | 'ONLINE';
  paymentProviders?: Array<'MOMO' | 'VNPAY' | 'BANK_QR' | 'VISA'>;
  categories: Category[];
};
type AthleteDraft = {
  source?: 'NEW' | 'DATABASE';
  reuseToken?: string;
  hasAvatar?: boolean;
  hasIdentity?: boolean;
  documentNumber?: string;
  phone?: string;
  key: string;
  fullName: string;
  birthDate: Dayjs | null;
  gender?: 'MALE' | 'FEMALE';
  countryId?: string;
  federationId?: string;
  entries: DisciplineEntry[];
  identityType: IdentityType;
  avatar?: File;
  cccdFront?: File;
  cccdBack?: File;
  passport?: File;
  identityOcr?: IdentityOcrResult & { userConfirmed: true };
};
type SubmissionResult = {
  hasExistingRegistrations?: boolean;
  referenceCode: string | null;
  ticketEmailSent?: boolean;
  ticketEmailQueued?: boolean;
  registrations: { id: string; categoryId: string; athleteIndex: number; athleteId: string; athleteName: string; ticketCode: string; status: string; paymentStatus: string; feeAmount: number; currency: string; paymentDueAt?: string | null }[];
};
type FederationSessionProfile = {
  email: string;
  displayName: string;
  phone?: string | null;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  federation: { id: string; name: string; countryId: string };
};
type ParticipantSessionProfile = {
  email: string;
  displayName: string;
  phone?: string | null;
};
type MediaUploadReference = { id: string; token: string; expiresAt: string };

const emptyAthlete = (key: string): AthleteDraft => ({
  key,
  fullName: '',
  birthDate: null,
  identityType: 'CCCD',
  entries: [{}],
});

function DocumentPicker({
  label,
  file,
  required,
  facingMode = 'environment',
  allowPdf = true,
  onChange,
  reading,
}: {
  label: string;
  file?: File;
  required?: boolean;
  facingMode?: 'user' | 'environment';
  allowPdf?: boolean;
  onChange: (file?: File) => void;
  reading?: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string>();
  const isImage = Boolean(file?.type.startsWith('image/'));

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPreviewUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <div className="registration-document-picker">
      <label className="registration-document-label mb-2 block text-sm font-semibold text-slate-300">
        {label} {required && <span className="text-red-400">*</span>}
      </label>

      {file && (
        <div className={`registration-document-preview ${facingMode === 'user' ? 'is-portrait' : ''}`}>
          {isImage && previewUrl ? (
            <Image
              alt={`${label} đã chọn`}
              className="registration-document-image"
              preview={{ mask: 'Xem ảnh' }}
              src={previewUrl}
            />
          ) : (
            <div className="registration-document-pdf">
              <FileImage className="h-9 w-9" />
              <strong>Tệp PDF đã chọn</strong>
              <span>Có thể thay thế hoặc xóa tệp bên dưới</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Upload
          accept={allowPdf ? 'image/jpeg,image/png,image/webp,application/pdf' : 'image/jpeg,image/png,image/webp'}
          maxCount={1}
          showUploadList={false}
          beforeUpload={(selectedFile) => {
            onChange(selectedFile as File);
            return false;
          }}
        >
          <Button icon={file ? <RefreshCw className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}>
            {file ? (isImage ? 'Thay ảnh' : 'Thay tệp') : (allowPdf ? 'Chọn ảnh / PDF' : 'Chọn ảnh')}
          </Button>
        </Upload>
        <CameraCaptureButton facingMode={facingMode} onCapture={(capturedFile) => onChange(capturedFile)} />
        {file && (
          <Button danger icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(undefined)}>
            Xóa
          </Button>
        )}
        {reading && <span className="flex items-center gap-2 self-center text-xs text-sky-400"><Loader2 className="h-4 w-4 animate-spin" /> Đang đọc giấy tờ...</span>}
      </div>
      {!file && (
        <div className="registration-document-empty mt-2">
          <ImageIcon className="h-5 w-5" />
          <span>Ảnh sẽ hiển thị tại đây sau khi chọn hoặc chụp</span>
        </div>
      )}
    </div>
  );
}

export default function AthleteEventRegistration({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const toast = useSportDataToast();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const nextKey = useRef(2);
  const [mode, setMode] = useState<RegistrationMode>('INDIVIDUAL');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [athletes, setAthletes] = useState<AthleteDraft[]>([emptyAthlete('athlete-1')]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmissionResult>();
  const [ocrReview, setOcrReview] = useState<{ athleteKey: string; result: IdentityOcrResult }>();
  const [ocrReadingKey, setOcrReadingKey] = useState<string>();
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [sessionAccount, setSessionAccount] = useState<SportDataAccount | null>(null);
  const isTeamRegistration = Boolean(getParticipantToken() && sessionAccount?.accountTypes?.includes('TEAM_LEADER') && sessionAccount.federationId && mode === 'GROUP');
  const isSportDataAccount = Boolean(getParticipantToken() && !isTeamRegistration && sessionAccount);
  const { data: event, isLoading } = useSWR<EventData>(eventId ? `/events/${eventId}` : null, fetcher);
  const { data: countries = [] } = useSWR<Country[]>('/countries', fetcher);
  const { data: federations = [] } = useSWR<Federation[]>('/federations', fetcher);
  const defaultCountryId = useMemo(() => vietnamCountryId(countries), [countries]);
  const { data: teamProfile } = useSWR<FederationSessionProfile>(
    isTeamRegistration ? '/participant-auth/team/me' : null,
    (url: string) => participantApi.get(url).then((response) => response.data),
  );
  const { data: participantProfile } = useSWR<ParticipantSessionProfile>(
    isSportDataAccount ? '/participant-auth/me' : null,
    (url: string) => participantApi.get(url).then((response) => response.data),
  );

  useEffect(() => {
    if (!defaultCountryId || teamProfile) return;
    setAthletes((current) => current.map((athlete) => (
      athlete.countryId ? athlete : { ...athlete, countryId: defaultCountryId }
    )));
  }, [defaultCountryId, teamProfile]);

  useEffect(() => {
    const syncSession = () => {
      setSessionAccount(getParticipantToken() ? getParticipantAccount() : null);
    };
    syncSession();
    window.addEventListener('participant-session-change', syncSession);
    window.addEventListener('storage', syncSession);
    return () => {
      window.removeEventListener('participant-session-change', syncSession);
      window.removeEventListener('storage', syncSession);
    };
  }, []);

  useEffect(() => {
    const requestedMode = new URLSearchParams(window.location.search).get('mode');
    if (requestedMode === 'group') setMode('GROUP');
  }, []);

  useEffect(() => {
    if (!teamProfile) return;
    setMode('GROUP');
    setContactName(teamProfile.displayName);
    setContactEmail(teamProfile.email);
    setContactPhone(teamProfile.phone || '');
    setOrganizationName(teamProfile.federation.name);
    setAthletes((current) => current.map((athlete) => ({
      ...athlete,
      countryId: teamProfile.federation.countryId,
      federationId: teamProfile.federation.id,
    })));
  }, [teamProfile]);

  useEffect(() => {
    if (!participantProfile || isTeamRegistration) return;
    setContactName(participantProfile.displayName);
    setContactEmail(participantProfile.email);
    setContactPhone(participantProfile.phone || '');
  }, [isTeamRegistration, participantProfile]);

  const activeAthletes = useMemo(
    () => {
      if (mode === 'GROUP') return athletes;
      const keys = new Set(athletes.slice(0, 1).map((athlete) => athlete.key));
      let changed = true;
      while (changed) {
        changed = false;
        for (const athlete of athletes.filter((item) => keys.has(item.key))) for (const entry of athlete.entries) {
          if (entry.partnerKey && !keys.has(entry.partnerKey)) { keys.add(entry.partnerKey); changed = true; }
        }
      }
      return athletes.filter((athlete) => keys.has(athlete.key));
    },
    [athletes, mode],
  );

  const updateAthlete = (key: string, patch: Partial<AthleteDraft>) => {
    setAthletes((current) => current.map((athlete) => athlete.key === key ? { ...athlete, ...patch } : athlete));
  };

  const [lookupKey, setLookupKey] = useState<string>();
  const lookupSavedAthlete = async (athlete: AthleteDraft) => {
    if (!athlete.documentNumber?.trim()) { toast.error('Nhập số giấy tờ để tìm hồ sơ đã lưu.'); return; }
    setLookupKey(athlete.key);
    try {
      const { data } = await participantApi.post('/participant-auth/identity/lookup', {
        eventId, identityType: athlete.identityType, documentNumber: athlete.documentNumber,
        countryId: athlete.countryId, phone: athlete.phone || contactPhone,
        fullName: athlete.fullName || undefined, birthDate: athlete.birthDate?.format('YYYY-MM-DD'),
      });
      if (!data.reuseToken) {
        toast.error(data.message || 'Chưa tìm thấy hồ sơ. Bạn có thể chuyển sang khai báo mới.');
        return;
      }
      updateAthlete(athlete.key, { ...data.athlete, birthDate: dayjs(data.athlete.birthDate), reuseToken: data.reuseToken });
      toast.success('Đã chọn hồ sơ VĐV được lưu.');
    } catch (error) { toast.error(participantError(error, 'Không thể tìm hồ sơ VĐV.')); }
    finally { setLookupKey(undefined); }
  };
  const addPartner = (athlete: AthleteDraft, entryIndex: number, source: 'NEW' | 'DATABASE') => {
    if (athletes.length >= 30) { toast.error('Mỗi hồ sơ tối đa 30 VĐV.'); return; }
    const key = `athlete-${nextKey.current++}`;
    setAthletes((current) => [...current.map((item) => item.key === athlete.key ? { ...item,
      entries: item.entries.map((entry, index) => index === entryIndex ? { ...entry, partnerKey: key } : entry),
    } : item), { ...emptyAthlete(key), entries: [], source,
      countryId: athlete.countryId || defaultCountryId, federationId: athlete.federationId }]);
    window.setTimeout(() => document.getElementById(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  };

  const selectIdentityFile = async (
    athleteKey: string,
    file: File | undefined,
    fileField: 'cccdFront' | 'cccdBack' | 'passport',
    mediaType: 'CCCD_FRONT' | 'CCCD_BACK' | 'PASSPORT',
  ) => {
    if (!file) {
      updateAthlete(athleteKey, { [fileField]: undefined, ...(fileField !== 'cccdBack' ? { identityOcr: undefined } : {}) });
      return;
    }
    let optimizedFile: File;
    try {
      optimizedFile = await optimizeRegistrationMedia(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể tối ưu tệp đã chọn.');
      return;
    }
    updateAthlete(athleteKey, { [fileField]: optimizedFile, ...(fileField !== 'cccdBack' ? { identityOcr: undefined } : {}) });
    if (mediaType === 'CCCD_BACK') return;
    const form = new FormData();
    form.append('type', mediaType);
    form.append('file', optimizedFile);
    setOcrReadingKey(athleteKey);
    if (isTeamRegistration && teamProfile?.verificationStatus !== 'VERIFIED') {
      toast.warning('Tài khoản Trưởng đoàn phải được SportData duyệt trước khi gửi danh sách vận động viên.');
      setOcrReadingKey(undefined);
      return;
    }
    try {
      const response = await participantApi.post<IdentityOcrResult>('/participant-auth/ocr/preview', form);
      if (response.data.status === 'COMPLETED') {
        setOcrReview({ athleteKey, result: response.data });
      } else if (response.data.message) {
        toast.warning(response.data.message);
      }
    } catch (requestError) {
      toast.error(participantError(requestError, 'Không thể đọc dữ liệu giấy tờ'));
    } finally {
      setOcrReadingKey(undefined);
    }
  };

  const confirmGuestOcr = async (fields: IdentityOcrFields, applyToProfile: boolean) => {
    if (!ocrReview) return;
    const patch: Partial<AthleteDraft> = {
      identityOcr: { ...ocrReview.result, fields, userConfirmed: true },
      documentNumber: fields.documentNumber,
    };
    if (applyToProfile) {
      if (fields.fullName) patch.fullName = capitalizeRegistrationName(fields.fullName);
      if (fields.dateOfBirth && dayjs(fields.dateOfBirth).isValid()) patch.birthDate = dayjs(fields.dateOfBirth);
      const normalizedSex = fields.sex?.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (normalizedSex === 'nam' || normalizedSex === 'male' || normalizedSex === 'm') patch.gender = 'MALE';
      if (normalizedSex === 'nu' || normalizedSex === 'female' || normalizedSex === 'f') patch.gender = 'FEMALE';
    }
    updateAthlete(ocrReview.athleteKey, patch);
    setOcrReview(undefined);
  };

  const downloadSubmissionPdf = async (submission: SubmissionResult) => {
    if (!submission.referenceCode) return;
    setDownloadingPdf(true);
    try {
      const response = await participantApi.post(
        `/participant-auth/submissions/${encodeURIComponent(submission.referenceCode)}/tickets.pdf`,
        { contactEmail },
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sportdata-${submission.referenceCode}-A6.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      toast.error(participantError(requestError, 'Chưa thể tải PDF thẻ. Vui lòng kiểm tra trạng thái duyệt của tất cả hồ sơ.'));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const submit = async () => {
    if (!contactName.trim() || !contactEmail.trim() || !contactPhone.trim()) {
      toast.error('Vui lòng nhập đủ người liên hệ, email và số điện thoại.');
      return;
    }
    if (mode === 'GROUP' && !organizationName.trim()) {
      toast.error('Vui lòng nhập tên đội, CLB hoặc đơn vị đăng ký.');
      return;
    }
    const missingIndex = activeAthletes.findIndex((athlete) => (
      !athlete.fullName.trim()
      || !athlete.documentNumber?.trim()
      || !athlete.birthDate
      || !athlete.gender
      || !athlete.countryId
      || (!athlete.entries.length && !activeAthletes.some((item) => item.entries.some((entry) => entry.partnerKey === athlete.key)))
      || athlete.entries.some((entry) => !entry.categoryId)
    ));
    if (missingIndex >= 0) {
      const message = `${activeAthletes.length === 1 ? 'Vận động viên' : `Vận động viên ${missingIndex + 1}`} chưa đủ họ tên, số giấy tờ, ngày sinh, giới tính, quốc gia hoặc nội dung thi đấu.`;
      toast.error(message);
      return;
    }

    const pairs = activeAthletes.flatMap((athlete, athleteIndex) => athlete.entries.flatMap((entry) => {
      const category = event?.categories.find((item) => item.id === entry.categoryId);
      return ['DUO', 'SHOW'].includes(category?.discipline || '') ? [{ categoryId: entry.categoryId,
        athleteIndex, partnerIndex: activeAthletes.findIndex((item) => item.key === entry.partnerKey) }] : [];
    }));
    if (pairs.some((pair) => pair.partnerIndex < 0 || pair.partnerIndex === pair.athleteIndex)) {
      toast.error('Chọn đồng đội cho từng nội dung DUO/SHOW.'); return;
    }
    if (activeAthletes.some((athlete) => athlete.source === 'DATABASE' && !athlete.reuseToken)) {
      toast.error('Vui lòng tìm và xác nhận hồ sơ đồng đội đã lưu.'); return;
    }
    setSubmitting(true);
    try {
      for (const athlete of activeAthletes) {
        if (athlete.reuseToken) continue;
        await participantApi.post('/participant-auth/identity/check', {
          fullName: capitalizeRegistrationName(athlete.fullName), birthDate: athlete.birthDate!.format('YYYY-MM-DD'),
          gender: athlete.gender, countryId: athlete.countryId, federationId: athlete.federationId,
          identityType: athlete.identityType, documentNumber: athlete.documentNumber,
          phone: athlete.phone || contactPhone,
        });
      }
      const missingMediaIndex = activeAthletes.findIndex((athlete) => (
        (!athlete.avatar && !athlete.hasAvatar)
        || (!athlete.hasIdentity && (athlete.identityType === 'CCCD' ? !athlete.cccdFront || !athlete.cccdBack : !athlete.passport))
      ));
      if (missingMediaIndex >= 0) {
        const message = `${activeAthletes.length === 1 ? 'Vận động viên' : `Vận động viên ${missingMediaIndex + 1}`} chưa đủ ảnh đại diện hoặc giấy tờ định danh.`;
        toast.error(message);
        return;
      }
      const uploadMedia = async (file: File, type: 'AVATAR' | 'CCCD_FRONT' | 'CCCD_BACK' | 'PASSPORT') => {
        const optimizedFile = await optimizeRegistrationMedia(file);
        const upload = new FormData();
        upload.append('type', type);
        upload.append('file', optimizedFile);
        const response = await participantApi.post<MediaUploadReference>('/participant-auth/media-uploads', upload);
        return response.data;
      };
      const athletesWithUploads = [];
      for (const athlete of activeAthletes) {
        const [avatar, cccdFront, cccdBack, passport] = await Promise.all([
          athlete.avatar ? uploadMedia(athlete.avatar, 'AVATAR') : undefined,
          athlete.cccdFront ? uploadMedia(athlete.cccdFront, 'CCCD_FRONT') : undefined,
          athlete.cccdBack ? uploadMedia(athlete.cccdBack, 'CCCD_BACK') : undefined,
          athlete.passport ? uploadMedia(athlete.passport, 'PASSPORT') : undefined,
        ]);
        athletesWithUploads.push({
          reuseToken: athlete.reuseToken,
          profileConfirmed: Boolean(athlete.reuseToken),
          fullName: capitalizeRegistrationName(athlete.fullName),
          documentNumber: athlete.documentNumber,
          phone: athlete.phone || undefined,
          birthDate: athlete.birthDate!.format('YYYY-MM-DD'),
          gender: athlete.gender,
          countryId: athlete.countryId,
          federationId: athlete.federationId || undefined,
          categoryIds: athlete.entries.map((entry) => entry.categoryId),
          identityType: athlete.identityType,
          identityOcr: athlete.identityOcr,
          mediaUploads: { avatar, cccdFront, cccdBack, passport },
        });
      }
      const endpoint = isTeamRegistration
        ? '/participant-auth/team/registrations'
        : isSportDataAccount
          ? '/participant-auth/assisted-registrations'
          : '/participant-auth/guest-registrations';
      const response = await participantApi.post<SubmissionResult>(endpoint, {
        eventId,
        type: mode,
        contactName: capitalizeRegistrationName(contactName),
        contactEmail,
        contactPhone,
        organizationName: mode === 'GROUP' ? capitalizeRegistrationName(organizationName) : undefined,
        athletes: athletesWithUploads,
        pairs,
      });
      const payableRegistration = response.data.registrations.length === 1
        ? response.data.registrations[0]
        : undefined;
      if (payableRegistration?.paymentStatus === 'PENDING' && payableRegistration.feeAmount > 0) {
        toast.success('Đã tiếp nhận hồ sơ. Đang mở mã QR thanh toán; thẻ sẽ được phát hành sau khi hồ sơ được duyệt.');
        router.push(`/tickets/${encodeURIComponent(payableRegistration.ticketCode)}?payment=1`);
        return;
      }
      const allTicketsIssued = response.data.registrations.every((registration) => (
        registration.status === 'CONFIRMED'
        && (registration.paymentStatus === 'PAID' || registration.paymentStatus === 'NOT_REQUIRED')
      ));
      toast.success(allTicketsIssued
        ? response.data.ticketEmailSent
          ? 'Hồ sơ đã được duyệt. Bộ thẻ đã được gửi về email và đang được tải xuống.'
          : response.data.ticketEmailQueued
            ? 'Hồ sơ đã được duyệt. Bộ thẻ đã sẵn sàng và sẽ được gửi về email.'
            : 'Hồ sơ đã được duyệt. Bộ thẻ đã sẵn sàng để tải.'
        : 'Đã tiếp nhận hồ sơ. Thẻ sẽ được phát hành và gửi email sau khi hồ sơ được duyệt.');
      setResult(response.data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (allTicketsIssued && response.data.referenceCode && !response.data.hasExistingRegistrations) await downloadSubmissionPdf(response.data);
    } catch (requestError) {
      const message = participantError(requestError, 'Không thể gửi hồ sơ đăng ký');
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !event) return <main className="grid min-h-[60vh] place-items-center"><Spin size="large" /></main>;
  if (result) {
    const ticketRows = distinctAthleteTickets(result.registrations, (item) => item.athleteId);
    const athleteCount = new Set(result.registrations.map((item) => item.athleteId)).size;
    const allTicketsIssued = result.registrations.every((registration) => (
      registration.status === 'CONFIRMED'
      && (registration.paymentStatus === 'PAID' || registration.paymentStatus === 'NOT_REQUIRED')
    ));
    return (
      <main className="mx-auto min-h-[70vh] max-w-4xl px-4 py-12">
        <Card>
          <Result
            status="success"
            title="Đã tiếp nhận hồ sơ đăng ký"
            subTitle={result.referenceCode ? `Mã hồ sơ ${result.referenceCode}. Thẻ được phát hành khi giấy tờ và thanh toán đã hoàn tất.` : 'Các hồ sơ đã có tại sự kiện. Mở từng thẻ bên dưới để xem trạng thái hoặc tiếp tục thanh toán.'}
            extra={[
              ...(allTicketsIssued && result.referenceCode && !result.hasExistingRegistrations ? [
                <Button key="pdf" type="primary" loading={downloadingPdf} icon={<Download className="h-4 w-4" />} onClick={() => void downloadSubmissionPdf(result)}>
                  {athleteCount > 1 ? `Tải bộ ${athleteCount} thẻ PDF` : 'Tải thẻ PDF'}
                </Button>,
              ] : []),
              <Link key="event" href={`/events/${eventId}`}><Button>Quay lại sự kiện</Button></Link>,
            ]}
          />
          {!allTicketsIssued ? (
            <ToastNotice
              className="mb-6"
              showIcon
              type="info"
              message="Đang chờ phát hành thẻ"
              description="Bạn có thể hoàn tất thanh toán và theo dõi từng hồ sơ bên dưới. Khi được duyệt, thẻ và mã QR check-in mới xuất hiện, đồng thời được gửi về email đăng ký."
            />
          ) : result.registrations.length > 1 && (
            <ToastNotice className="mb-6" showIcon type="info" message="Mỗi vận động viên có một thẻ và QR chung" description="Các nội dung đã được duyệt và hoàn tất thanh toán trong cùng giải được gộp trên một thẻ của vận động viên." />
          )}
          <div className="mx-auto max-w-3xl space-y-7">
            {ticketRows.map((registration) => {
              const athlete = activeAthletes[registration.athleteIndex];
              const category = event.categories.find((item) => item.id === registration.categoryId);
              const country = countries.find((item) => item.id === athlete?.countryId);
              const federation = federations.find((item) => item.id === athlete?.federationId);
              const ticket: ParticipationTicket = {
                ticketCode: registration.ticketCode,
                status: registration.status,
                paymentStatus: registration.paymentStatus,
                feeAmount: registration.feeAmount,
                currency: registration.currency,
                paymentDueAt: registration.paymentDueAt,
                event: {
                  id: event.id,
                  name: event.name,
                  startDate: event.startDate,
                  endDate: event.endDate,
                  location: event.location,
                  ticketBackgroundUrl: event.ticketBackgroundUrl,
                  ticketDesign: event.ticketDesign,
                  ticketThemePreset: event.ticketThemePreset,
                  ticketLayout: event.ticketLayout,
                  ticketPrimaryColor: event.ticketPrimaryColor,
                  ticketSecondaryColor: event.ticketSecondaryColor,
                  ticketAccentColor: event.ticketAccentColor,
                  paymentMode: event.paymentMode,
                  paymentProviders: event.paymentProviders,
                },
                sport: category?.sport || null,
                category: { ...category, name: category?.name || 'Hạng đấu đang cập nhật' },
                athlete: {
                  id: registration.athleteId,
                  fullName: registration.athleteName,
                  birthDate: athlete?.birthDate?.format('YYYY-MM-DD'),
                  gender: athlete?.gender,
                  country,
                  federation,
                  avatarUrl: `/api/participant-auth/avatar/${registration.athleteId}`,
                },
              };
              const ticketIssued = isTicketIssued(registration);
              return (
                <div key={registration.id}>
                  {!ticketIssued && category && <h3 className="mb-3 font-semibold">{registrationCategoryLabel(category)}</h3>}
                  <PaymentCheckout ticket={ticket} />
                  {ticketIssued ? (
                    <IssuedAthleteTicket code={registration.ticketCode} />
                  ) : (
                    <Card size="small" className="border-sky-500/20">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <strong>{registration.athleteName}</strong>
                          <p className="mt-1 text-sm text-slate-500">{category?.name || 'Hạng đấu đang cập nhật'} · Mã hồ sơ {registration.ticketCode}</p>
                        </div>
                        <Tag color={registration.status === 'REJECTED' ? 'error' : 'processing'}>
                          {registration.status === 'REJECTED' ? 'Hồ sơ bị từ chối' : 'Chờ duyệt hồ sơ'}
                        </Tag>
                      </div>
                    </Card>
                  )}
                  <div className="mt-3 flex justify-end">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/tickets/${encodeURIComponent(registration.ticketCode)}`} target="_blank">
                        <Button>{ticketIssued ? 'Xem thẻ' : 'Theo dõi hồ sơ'}</Button>
                      </Link>
                      {registration.paymentStatus === 'PENDING' && registration.feeAmount > 0 ? (
                        <Link href={`/tickets/${encodeURIComponent(registration.ticketCode)}?payment=1`}><Button type="primary">Thanh toán {new Intl.NumberFormat('vi-VN').format(registration.feeAmount)} {registration.currency}</Button></Link>
                      ) : null}
                      {ticketIssued ? (
                        <Button href={`/api/participant-auth/tickets/${encodeURIComponent(registration.ticketCode)}/pdf`} icon={<Download className="h-4 w-4" />}>Tải PDF riêng</Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className={embedded ? 'guest-registration-page' : 'guest-registration-page mx-auto min-h-screen max-w-6xl px-4 py-10'}>
      {!embedded && <div className="mb-7">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-sky-400">
          {isTeamRegistration
            ? 'Đăng ký bằng Tài khoản SportData · Trưởng đoàn'
            : isSportDataAccount
              ? 'Đăng ký hộ bằng tài khoản SportData'
              : 'Đăng ký không cần tài khoản'}
        </p>
        <h1 className="mt-2 text-3xl font-black text-white">{event.name}</h1>
        <p className="mt-2 text-slate-400">
          {isSportDataAccount
            ? 'Tài khoản của bạn là người liên hệ. Mỗi VĐV được đăng ký hộ có hồ sơ, giấy tờ và thẻ riêng.'
            : 'Đăng ký cá nhân hoặc gửi danh sách cho đội/CLB. Mọi giấy tờ đều chuyển sang trạng thái chờ xác thực.'}
        </p>
      </div>

      }
      {isTeamRegistration && (
        <ToastNotice
          className="mb-6"
          showIcon
          type={teamProfile?.verificationStatus === 'VERIFIED' ? 'success' : 'warning'}
          message={teamProfile?.verificationStatus === 'VERIFIED' ? `Đăng ký với tư cách ${teamProfile.federation.name}` : 'Tài khoản Trưởng đoàn đang chờ SportData duyệt'}
          description="Thông tin đơn vị và người liên hệ được lấy từ tài khoản; mỗi vận động viên vẫn cần đủ hồ sơ và giấy tờ."
        />
      )}
      {isSportDataAccount && (
        <ToastNotice
          className="mb-6"
          showIcon
          type="info"
          message={`Bạn đang đăng ký hộ với tài khoản ${participantProfile?.displayName || sessionAccount?.displayName || 'SportData'}`}
          description="Hồ sơ VĐV được tạo độc lập, không thay đổi thông tin VĐV cá nhân của bạn. Thẻ và email xác nhận sẽ được quản lý bằng tài khoản đang đăng nhập."
        />
      )}
      <Card className="mb-6" title="Hình thức đăng ký">
        <Segmented
          block
          value={mode}
          onChange={(value) => setMode(value as RegistrationMode)}
          options={[
            { value: 'INDIVIDUAL', label: 'Cá nhân / cặp thi đấu', icon: <FileImage className="h-4 w-4" /> },
            { value: 'GROUP', label: 'Danh sách đội / CLB', icon: <Users className="h-4 w-4" /> },
          ]}
        />
      </Card>

      <Card className="mb-6" title="Người liên hệ hồ sơ">
        <div className="grid gap-4 md:grid-cols-2">
          <div><label className="mb-2 block text-sm font-semibold">Họ tên người liên hệ *</label><Input disabled={isTeamRegistration || isSportDataAccount} size="large" autoCapitalize="words" value={contactName} onChange={(event) => setContactName(event.target.value)} onBlur={(event) => setContactName(capitalizeRegistrationName(event.target.value))} /></div>
          <div><label className="mb-2 block text-sm font-semibold">Email *</label><Input disabled={isTeamRegistration || isSportDataAccount} size="large" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></div>
          <div><label className="mb-2 block text-sm font-semibold">Số điện thoại *</label><Input disabled={isTeamRegistration} size="large" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></div>
          {mode === 'GROUP' && <div><label className="mb-2 block text-sm font-semibold">Đội / CLB / đơn vị *</label><Input disabled={isTeamRegistration} size="large" autoCapitalize="words" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} onBlur={(event) => setOrganizationName(capitalizeRegistrationName(event.target.value))} /></div>}
        </div>
      </Card>

      <div className="space-y-6">
        {activeAthletes.map((athlete, index) => {
          const availableFederations = federations.filter((item) => item.countryId === athlete.countryId);
          return (
            <Card
              key={athlete.key}
              id={athlete.key}
              title={activeAthletes.length === 1 ? 'Vận động viên' : `Vận động viên ${index + 1}`}
              extra={mode === 'GROUP' && activeAthletes.length > 1
                ? <Button danger type="text" icon={<Trash2 className="h-4 w-4" />} onClick={() => setAthletes((current) => current.filter((item) => item.key !== athlete.key))}>Xóa</Button>
                : undefined}
            >
              <div className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-4">
                <div className="mb-3 font-semibold text-sky-900">{index === 0 ? 'Hồ sơ VĐV đăng ký' : 'Hồ sơ đồng đội / VĐV'}</div>
                <Segmented value={athlete.source || 'NEW'} options={[{ value: 'NEW', label: 'Khai báo mới' }, { value: 'DATABASE', label: 'Hồ sơ đã lưu' }]}
                  onChange={(value) => updateAthlete(athlete.key, { source: value as 'NEW' | 'DATABASE', reuseToken: undefined, hasAvatar: false, hasIdentity: false })} />
                {athlete.source === 'DATABASE' && <p className="mb-0 mt-3 text-sm text-sky-800">Nhập số giấy tờ và SĐT đã dùng trước đây, hoặc họ tên cùng ngày sinh, rồi tìm hồ sơ. Chọn hồ sơ sẽ sử dụng lại thông tin và giấy tờ đã lưu.</p>}
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div><label className="mb-2 block text-sm font-semibold">Loại giấy tờ *</label><Select className="w-full" size="large" value={athlete.identityType} onChange={(value) => updateAthlete(athlete.key, { identityType: value, documentNumber: '', identityOcr: undefined })} options={[{ value: 'CCCD', label: 'CCCD' }, { value: 'PASSPORT', label: 'Hộ chiếu' }]} /></div>
                <div className="lg:col-span-2"><label className="mb-2 block text-sm font-semibold">Số {athlete.identityType === 'CCCD' ? 'CCCD' : 'hộ chiếu'} *</label><Input size="large" maxLength={30} value={athlete.documentNumber} placeholder={athlete.identityType === 'CCCD' ? '12 chữ số theo CCCD' : 'Số hộ chiếu theo giấy tờ'} onChange={(event) => updateAthlete(athlete.key, { documentNumber: event.target.value })} /></div>
                <div className="lg:col-span-2"><label className="mb-2 block text-sm font-semibold">Họ và tên theo giấy tờ *</label><Input size="large" autoCapitalize="words" value={athlete.fullName} onChange={(event) => updateAthlete(athlete.key, { fullName: event.target.value })} onBlur={(event) => updateAthlete(athlete.key, { fullName: capitalizeRegistrationName(event.target.value) })} /></div>
                <div><label className="mb-2 block text-sm font-semibold">Ngày sinh *</label><DatePicker className="w-full" size="large" format="DD/MM/YYYY" value={athlete.birthDate} disabledDate={(date) => date.isAfter(dayjs(), 'day')} onChange={(value) => updateAthlete(athlete.key, { birthDate: value })} /></div>
                <div><label className="mb-2 block text-sm font-semibold">Số điện thoại VĐV</label><Input size="large" type="tel" maxLength={30} value={athlete.phone} placeholder="Để trống nếu dùng số liên hệ" onChange={(event) => updateAthlete(athlete.key, { phone: event.target.value })} /></div>
                <div><label className="mb-2 block text-sm font-semibold">Giới tính *</label><Select className="w-full" size="large" value={athlete.gender} onChange={(value) => updateAthlete(athlete.key, { gender: value })} options={[{ value: 'MALE', label: 'Nam' }, { value: 'FEMALE', label: 'Nữ' }]} /></div>
                <div><label className="mb-2 block text-sm font-semibold">Quốc gia *</label><Select disabled={isTeamRegistration} showSearch optionFilterProp="label" className="w-full" size="large" value={athlete.countryId} onChange={(value) => updateAthlete(athlete.key, { countryId: value, federationId: undefined })} options={countries.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></div>
                <div><label className="mb-2 block text-sm font-semibold">Đơn vị / CLB</label><Select allowClear showSearch optionFilterProp="label" disabled={isTeamRegistration || !athlete.countryId} className="w-full" size="large" value={athlete.federationId} onChange={(value) => updateAthlete(athlete.key, { federationId: value })} placeholder="Để trống nếu đăng ký tự do" options={availableFederations.map((item) => ({ value: item.id, label: item.name }))} /></div>
              </div>

              {athlete.source === 'DATABASE' && <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button type="primary" loading={lookupKey === athlete.key} onClick={() => void lookupSavedAthlete(athlete)}>Tìm và chọn hồ sơ đã lưu</Button>
                {athlete.reuseToken && <Tag color="green">Đã chọn: {athlete.fullName}</Tag>}
              </div>}
              {!athlete.entries.length && <p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Đồng đội tham gia nội dung do VĐV khai báo ở trên. Chỉ thêm nội dung dưới đây nếu đăng ký thi đấu thêm.</p>}
              <RegistrationDisciplines declarantName={athlete.fullName} partners={athletes.filter((item) => item.key !== athlete.key).map((item) => ({ key: item.key, name: item.fullName || `VĐV ${athletes.indexOf(item) + 1}` }))}
                onAddPartner={(entryIndex, source) => addPartner(athlete, entryIndex, source)} categories={event.categories || []} entries={athlete.entries} existingRegistrations={[]}
                onChange={(entries) => updateAthlete(athlete.key, { entries })} />

              {athlete.reuseToken && athlete.hasAvatar && athlete.hasIdentity ? <p className="mt-5 text-sm text-emerald-700">Ảnh và giấy tờ sẽ được lấy từ hồ sơ đã lưu.</p> : <div className="mt-6 border-t border-white/10 pt-6">
                <h3 className="mb-4 font-bold">Ảnh và giấy tờ xác minh</h3>
                <div className="grid gap-5 md:grid-cols-2">
                  <DocumentPicker label="Ảnh đại diện" required facingMode="user" allowPdf={false} file={athlete.avatar} onChange={(file) => updateAthlete(athlete.key, { avatar: file })} />
                  <div className="text-sm text-slate-400">Tải lên {athlete.identityType === 'CCCD' ? 'CCCD hai mặt' : 'hộ chiếu'} khớp với số giấy tờ đã nhập ở trên.</div>
                  {athlete.identityType === 'CCCD' ? (
                    <>
                      <DocumentPicker label="CCCD mặt trước" required file={athlete.cccdFront} reading={ocrReadingKey === athlete.key} onChange={(file) => void selectIdentityFile(athlete.key, file, 'cccdFront', 'CCCD_FRONT')} />
                      <DocumentPicker label="CCCD mặt sau" required file={athlete.cccdBack} onChange={(file) => updateAthlete(athlete.key, { cccdBack: file })} />
                    </>
                  ) : (
                    <DocumentPicker label="Hộ chiếu" required file={athlete.passport} reading={ocrReadingKey === athlete.key} onChange={(file) => void selectIdentityFile(athlete.key, file, 'passport', 'PASSPORT')} />
                  )}
                </div>
              </div>}
            </Card>
          );
        })}
      </div>

      {mode === 'GROUP' && athletes.length < 30 && (
        <Button className="mt-5" size="large" icon={<Plus className="h-4 w-4" />} onClick={() => setAthletes((current) => [...current, {
          ...emptyAthlete(`athlete-${nextKey.current++}`),
          ...(teamProfile
            ? { countryId: teamProfile.federation.countryId, federationId: teamProfile.federation.id }
            : { countryId: defaultCountryId }),
        }])}>Thêm vận động viên</Button>
      )}
      <p className="mt-6 text-sm text-slate-500">Lệ phí tính theo nội dung của người khai báo. Với DUO/SHOW, người khai báo đóng phí; đồng đội được ghép vào cặp không đóng thêm. Mỗi VĐV có thẻ cá nhân khi hồ sơ được duyệt.</p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Link href={`/events/${eventId}`}><Button size="large">Hủy</Button></Link>
        <Button type="primary" size="large" loading={submitting}
          icon={<Send className="h-4 w-4" />} onClick={submit}>Gửi hồ sơ</Button>
      </div>
      <IdentityOcrReviewModal
        open={Boolean(ocrReview)}
        result={ocrReview?.result}
        applyLabel="Điền họ tên, ngày sinh và giới tính vào hồ sơ VĐV này"
        onCancel={() => setOcrReview(undefined)}
        onConfirm={confirmGuestOcr}
      />
    </main>
  );
}
