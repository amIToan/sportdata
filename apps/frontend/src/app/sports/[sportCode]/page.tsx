'use client';

import { imageUrl } from '@/lib/image-url';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import useSWR from 'swr';
import { Button, Card, Empty, Skeleton, Tag } from 'antd';
import { ArrowRight, CalendarDays, Clock3, MapPin, Trophy } from 'lucide-react';
import { fetcher } from '@/lib/api';
import { formatDateRange } from '@/lib/utils';

type Sport = {
  id: string;
  name: string;
  code: string;
  description?: string;
  logoUrl?: string;
  displayName?: string;
  subtitle?: string;
  backgroundUrl?: string;
  isVisible?: boolean;
  categories?: Category[];
};
type Category = { id: string; name: string; discipline?: string; uniform?: string; minAge?: number; maxAge?: number; minWeight?: number; maxWeight?: number };
type EventItem = {
  id: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  location?: string;
  registrationEnabled: boolean;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  paymentMode: string;
  registrationFee: number;
  registrationCurrency: string;
  organizer?: { name: string };
};

function registrationState(event: EventItem) {
  const now = Date.now();
  const start = new Date(event.startDate).getTime();
  const end = new Date(event.endDate).getTime();
  const open = event.registrationOpenAt ? new Date(event.registrationOpenAt).getTime() : 0;
  const close = event.registrationCloseAt ? new Date(event.registrationCloseAt).getTime() : start;
  if (now > end) return { key: 'completed', label: 'Đã tổ chức', color: 'default' as const };
  if (!event.registrationEnabled || now > close) return { key: 'closed', label: 'Đã hết đăng ký', color: 'error' as const };
  if (now < open) return { key: 'upcoming', label: 'Sắp mở đăng ký', color: 'processing' as const };
  return { key: 'open', label: 'Đang mở đăng ký', color: 'success' as const };
}

export default function SportPlatformPage() {
  const params = useParams<{ sportCode: string }>();
  const code = decodeURIComponent(params.sportCode || '').toUpperCase();
  const { data: sports = [], isLoading: sportsLoading } = useSWR<Sport[]>('/sports', fetcher);
  const sport = sports.find((item) => item.code.toUpperCase() === code && item.isVisible !== false);
  const { data: response, isLoading: eventsLoading } = useSWR<{ items: EventItem[] }>(
    sport ? `/events?isPublished=true&sportId=${sport.id}&limit=100` : null,
    fetcher,
  );
  const events = useMemo(() => response?.items || [], [response]);
  const groups = useMemo(() => ({
    open: events.filter((item) => registrationState(item).key === 'open'),
    upcoming: events.filter((item) => registrationState(item).key === 'upcoming'),
    closed: events.filter((item) => registrationState(item).key === 'closed'),
    completed: events.filter((item) => registrationState(item).key === 'completed'),
  }), [events]);
  const isJiuJitsu = sport && /(JU|JIU|JJ)/i.test(`${sport.code} ${sport.name}`);


  if (sportsLoading || (sport && eventsLoading)) {
    return <main className="mx-auto max-w-7xl px-4 py-12"><Skeleton active paragraph={{ rows: 10 }} /></main>;
  }
  if (!sport) {
    return <main className="mx-auto max-w-4xl px-4 py-16"><Empty description="Không tìm thấy nền tảng bộ môn" /></main>;
  }

  return (
    <main className="sport-platform-page min-h-screen pb-20">
      <section
        className="sport-platform-hero relative overflow-hidden border-b border-white/10 bg-cover bg-center"
        style={{
          backgroundImage: sport.backgroundUrl
            ? `linear-gradient(110deg, rgba(8,15,30,.97), rgba(8,15,30,.74)), url("${imageUrl(sport.backgroundUrl, 'hero')!.replace(/"/g, '%22')}")`
            : 'linear-gradient(135deg, #111827, #0b1e36 52%, #082f49)',
        }}
      >
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,#38bdf8_0,transparent_35%),radial-gradient(circle_at_80%_60%,#22d3ee_0,transparent_30%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_.8fr] lg:px-8 lg:py-24">
          <div>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.22em] text-sky-400">Nền tảng bộ môn</p>
            <h1 className="text-5xl font-black tracking-tight text-white sm:text-6xl">{sport.displayName || sport.name}</h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
              {sport.subtitle || sport.description || (isJiuJitsu
                ? 'Đăng ký giải, quản lý hạng cân, lịch thi đấu và thẻ tham dự Ju‑Jitsu trên một nền tảng thống nhất.'
                : `Theo dõi và đăng ký các sự kiện ${sport.name}.`)}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button type="primary" size="large" href="#events" icon={<CalendarDays className="h-4 w-4" />}>Xem sự kiện</Button>
            </div>
          </div>
          <Card className="sport-platform-metrics border-sky-400/20 bg-slate-950/50 backdrop-blur">
            <div className="text-center">
              <div className="rounded-xl bg-white/5 p-5"><strong className="block text-3xl text-white">{events.length}</strong><span className="text-sm text-slate-400">Sự kiện</span></div>
            </div>
          </Card>
        </div>
      </section>

      <div id="events" className="sport-platform-events mx-auto max-w-7xl space-y-12 px-4 py-12 sm:px-6 lg:px-8">
        {([
          ['open', 'Đang mở đăng ký'],
          ['upcoming', 'Sắp mở đăng ký'],
          ['closed', 'Đã hết thời gian đăng ký'],
          ['completed', 'Sự kiện đã tổ chức'],
        ] as const).map(([key, title]) => groups[key].length ? (
          <section key={key}>
            <div className="mb-5 flex items-center gap-3"><Trophy className="h-5 w-5 text-sky-400" /><h2 className="text-2xl font-black text-white">{title}</h2><Tag>{groups[key].length}</Tag></div>
            <div className="grid gap-5 lg:grid-cols-2">
              {groups[key].map((event) => {
                const state = registrationState(event);
                return (
                  <Card key={event.id} className="h-full" title={event.name} extra={<Tag color={state.color}>{state.label}</Tag>}>
                    {event.description && <p className="mb-4 line-clamp-2 text-slate-400">{event.description}</p>}
                    <div className="space-y-2 text-sm text-slate-300">
                      <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-sky-400" />{formatDateRange(event.startDate, event.endDate)}</p>
                      {event.location && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-sky-400" />{event.location}</p>}
                      {event.registrationCloseAt && <p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-sky-400" />Hạn đăng ký: {new Date(event.registrationCloseAt).toLocaleString('vi-VN')}</p>}
                    </div>
                    <div className="mt-5 flex items-center justify-between gap-3">
                      <span className="font-semibold text-emerald-400">{event.paymentMode === 'FREE' ? 'Miễn phí' : `${event.registrationFee.toLocaleString('vi-VN')} ${event.registrationCurrency}`}</span>
                      <Link href={`/events/${event.id}`}><Button type={key === 'open' ? 'primary' : 'default'}>Xem chi tiết <ArrowRight className="ml-1 inline h-4 w-4" /></Button></Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ) : null)}
        {!events.length && <Card><Empty description="Chưa có sự kiện công khai cho bộ môn này" /></Card>}
      </div>
    </main>
  );
}
