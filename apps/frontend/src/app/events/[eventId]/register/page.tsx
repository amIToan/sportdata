'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { Button, Card, Result, Segmented, Skeleton, Tag } from 'antd';
import { ArrowLeft, CalendarDays, MapPin, TicketCheck } from 'lucide-react';
import AthleteEventRegistration from '@/components/AthleteEventRegistration';
import { NonAthleteEventRegistration } from '@/components/NonAthleteEventRegistration';
import { RegistrationRolePicker, registrationRoles } from '@/components/RegistrationRolePicker';
import { SelfAthleteRegistration } from '@/components/SelfAthleteRegistration';
import { type EventRole } from '@/lib/event-participation';
import { fetcher } from '@/lib/api';
import { getParticipantToken, participantApi } from '@/lib/participant-auth';

type EventInfo = {
  id: string; name: string; startDate: string; location?: string | null;
  registrationEnabled: boolean; registrationOpenAt?: string | null; registrationCloseAt?: string | null;
  categories?: { id: string; name: string; sport?: { name: string } | null }[];
};
type Profile = { displayName: string; hasAthleteProfile: boolean; accountTypes: string[] };

export default function EventRegistrationPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [role, setRole] = useState<EventRole>();
  const [choosingRole, setChoosingRole] = useState(true);
  const [athleteMode, setAthleteMode] = useState('SELF');
  const [signedIn, setSignedIn] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { data: event, isLoading, error } = useSWR<EventInfo>(`/events/${eventId}`, fetcher);
  const { data: profile, error: profileError } = useSWR<Profile>(signedIn ? '/participant-auth/me' : null, (url: string) => participantApi.get(url).then(({ data }) => data));

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requested = query.get('role');
    if (registrationRoles.some((item) => item.value === requested)) { setRole(requested as EventRole); setChoosingRole(false); }
    else if (query.has('mode')) { setRole('ATHLETE'); setChoosingRole(false); }
    if (query.has('mode')) setAthleteMode('OTHER');
    const sync = () => setSignedIn(Boolean(getParticipantToken()));
    sync();
    window.addEventListener('participant-session-change', sync);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(timer); window.removeEventListener('participant-session-change', sync); };
  }, []);

  const selectRole = (value: EventRole) => {
    setRole(value); setChoosingRole(false);
    const url = new URL(window.location.href);
    url.searchParams.set('role', value); url.searchParams.delete('mode');
    window.history.replaceState(null, '', url);
  };
  if (isLoading) return <div className="registration-flow mx-auto min-h-[70vh] max-w-6xl px-4 py-10"><Skeleton active /></div>;
  if (error || !event) return <Result status="404" title="Không thể tải sự kiện" extra={<Link href="/events"><Button>Xem các sự kiện</Button></Link>} />;
  const open = event.registrationEnabled && (!event.registrationOpenAt || now >= Date.parse(event.registrationOpenAt)) && now <= Date.parse(event.registrationCloseAt || event.startDate);
  const selection = registrationRoles.find((item) => item.value === role);
  const canUseProfile = profile?.hasAthleteProfile && profile.accountTypes.includes('ATHLETE');
  const date = new Date(event.startDate).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  return <div className="registration-flow mx-auto min-h-[calc(100vh-84px)] max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
    <Link className="registration-back" href={`/events/${eventId}`}><ArrowLeft size={17} /> Quay lại sự kiện</Link>
    <header className="registration-flow-header">
      <div><p className="registration-eyebrow">ĐĂNG KÝ THAM GIA</p><h1>{event.name}</h1><div className="registration-event-meta"><span><CalendarDays size={16} />{date}</span>{event.location && <span><MapPin size={16} />{event.location}</span>}</div>{event.registrationCloseAt && <p className="registration-muted mt-3 text-sm">Hạn đăng ký: {new Date(event.registrationCloseAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>}</div>
      <Tag color={open ? 'success' : 'default'}>{open ? 'Đang nhận đăng ký' : 'Chưa mở hoặc đã hết hạn đăng ký'}</Tag>
    </header>
    <Card className="registration-step-card mb-6">
      <div className="registration-step-heading"><span className="registration-step-number">1</span><div><h2>{choosingRole ? 'Chọn vai trò của bạn' : 'Vai trò tham gia'}</h2>{choosingRole && <p>Mỗi vai trò có thông tin đăng ký riêng cho sự kiện này.</p>}</div>{!choosingRole && <Button onClick={() => setChoosingRole(true)}>Đổi vai trò</Button>}</div>
      {choosingRole ? <RegistrationRolePicker eventId={eventId} value={role} onSelect={selectRole} /> : selection && <div className="registration-selected-role"><selection.icon size={24} /><div><strong>{selection.label}</strong><p>{selection.description}</p></div></div>}
    </Card>
    {role ? <section aria-label="Thông tin đăng ký" className="registration-form-section">
      <div className="registration-step-heading mb-5"><span className="registration-step-number">2</span><div><h2>Hoàn tất thông tin đăng ký</h2><p>{role === 'ATHLETE' ? 'Chọn cách đăng ký, nội dung thi đấu và chuẩn bị hồ sơ VĐV.' : 'Điền thông tin liên hệ, đơn vị, giấy tờ định danh và ảnh thẻ.'}</p></div></div>
      {role === 'ATHLETE' ? <>
        {canUseProfile && <Segmented className="mb-5" block value={athleteMode} onChange={(value) => setAthleteMode(String(value))} options={[{ value: 'SELF', label: 'Dùng hồ sơ VĐV của tôi' }, { value: 'OTHER', label: 'Nhập hồ sơ VĐV / danh sách đội' }]} />}
        {signedIn && !profile && !profileError ? <Skeleton active /> : canUseProfile && athleteMode === 'SELF' ? <SelfAthleteRegistration eventId={eventId} categories={event.categories || []} open={open} onMore={() => setAthleteMode('OTHER')} /> : <AthleteEventRegistration embedded />}
      </> : <NonAthleteEventRegistration key={role} eventId={eventId} role={role} embedded />}
    </section> : <div className="registration-next-hint"><TicketCheck size={21} /><p>Chọn một vai trò ở trên để bắt đầu. Vé có mã QR sẽ được phát hành và gửi qua email sau khi hồ sơ được duyệt.</p></div>}
  </div>;
}
