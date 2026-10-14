'use client';

import { ToastNotice } from '@/components/ToastNotice';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { Button, Card, Empty, Form, Input, InputNumber, Select, Skeleton, Spin, Table, Tag } from 'antd';
import { CalendarDays, MapPin, Radio, TicketCheck, Trophy, Users } from 'lucide-react';
import { MatchCard } from '@/components/MatchCard';
import { MATCH_STATUS_META } from '@/lib/vi-labels';
import { useEventScheduleStream } from '@/hooks/useEventScheduleStream';
import { fetcher } from '@/lib/api';
import { imageUrl } from '@/lib/image-url';
import { RegistrationRolePicker } from '@/components/RegistrationRolePicker';

interface Sport {
  id: string;
  name: string;
  code: string;
}

interface EventCategory {
  id: string;
  name: string;
  sportId?: string;
  sport?: Sport | null;
  discipline?: string | null;
  uniform?: string | null;
  beltLevel?: string | null;
}

interface MatchAthlete {
  id: string;
  fullName: string;
  photoUrl?: string | null;
  country?: { code?: string; name?: string; flagUrl?: string | null } | null;
  federation?: { id?: string; name?: string } | null;
}

interface Match {
  id: string;
  eventId: string;
  categoryId: string;
  matchNumber?: number | null;
  fop?: string | null;
  fopRecord?: { name: string } | null;
  matchDate: string;
  startTime?: string | null;
  athlete1?: MatchAthlete | null;
  athlete2?: MatchAthlete | null;
  athlete1Score?: number;
  athlete2Score?: number;
  athlete1Advantages?: number;
  athlete2Advantages?: number;
  athlete1Penalties?: number;
  athlete2Penalties?: number;
  status: 'SCHEDULED' | 'RUNNING' | 'FINISHED' | 'CANCELLED';
  matchType?: string;
  winnerId?: string | null;
  winMethod?: string | null;
  notes?: string | null;
  category?: EventCategory | null;
}

interface ScheduleDate {
  date: string;
  count: number;
}

interface ScheduleSummary {
  dates: ScheduleDate[];
  total: number;
  liveMatch?: {
    id: string;
    date: string;
    categoryId: string;
    sportId: string;
  } | null;
}

interface ScheduleFilters {
  athleteName?: string;
  opponentName?: string;
  matchNumber?: number;
  round?: number;
  status?: string;
}

interface MatchPage {
  items: Match[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor?: string | null;
  };
}

interface EventFop {
  id: string;
  name: string;
}

interface EventData {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  location?: string | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  sport?: Sport;
  sports?: Sport[];
  categories?: EventCategory[];
  fops?: EventFop[];
  _count?: { matches?: number; athletes?: number };
  registrationEnabled?: boolean;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  registrationFee?: number;
  registrationCurrency?: string;
  paymentMode?: string;
}

interface RegistrationSummaryRow {
  id: string;
  status: 'SUBMITTED' | 'CONFIRMED';
  category: EventCategory;
  athlete: {
    id: string;
    fullName: string;
    country?: { code: string; name: string } | null;
    federation?: { name: string } | null;
  };
  federation?: { name: string } | null;
}

const demoEvent: EventData = {
  id: 'ev-jjau-001',
  name: '5TH JJAU REGIONAL CHAMPIONSHIP SOUTHEAST ASIA',
  startDate: '2026-08-21T00:00:00.000Z',
  endDate: '2026-08-23T23:59:59.999Z',
  location: 'Hà Nội, Việt Nam',
  sport: { id: 'sport-jj', name: 'Ju-Jitsu', code: 'JJ' },
  _count: { matches: 1378 },
};

const disciplineLabels: Record<string, string> = {
  NEWAZA: 'Newaza',
  FIGHTING: 'Fighting',
  CONTACT: 'Contact',
  FULL_CONTACT: 'Full Contact',
  DUO: 'Duo',
  SHOW: 'Show',
};

const beltLabels: Record<string, string> = {
  WHITE: 'Đai trắng',
  BLUE: 'Đai xanh',
  PURPLE: 'Đai tím',
  BROWN: 'Đai nâu',
  BLACK: 'Đai đen',
  OPEN: 'Mở rộng',
};

function categoryLabel(category: EventCategory) {
  const details = [
    category.discipline ? disciplineLabels[category.discipline] || category.discipline : null,
    category.uniform ? (category.uniform === 'NO_GI' ? 'No-Gi' : 'Gi') : null,
    category.beltLevel ? beltLabels[category.beltLevel] || category.beltLevel : null,
  ].filter(Boolean);
  return details.length ? `${category.name} · ${details.join(' · ')}` : category.name;
}

function getRegistrationState(event: EventData) {
  const now = Date.now();
  const starts = new Date(event.startDate).getTime();
  const openAt = event.registrationOpenAt ? new Date(event.registrationOpenAt).getTime() : 0;
  const closeAt = event.registrationCloseAt ? new Date(event.registrationCloseAt).getTime() : starts;
  const expired = now > closeAt;
  if (!event.registrationEnabled) return { open: false, expired, label: 'Sự kiện chưa mở đăng ký' };
  if (now < openAt) return { open: false, expired, label: `Mở đăng ký từ ${new Date(openAt).toLocaleString('vi-VN')}` };
  if (expired) return { open: false, expired, label: 'Đã hết thời gian đăng ký' };
  return { open: true, expired, label: `Nhận đăng ký đến ${new Date(closeAt).toLocaleString('vi-VN')}` };
}

export default function EventDetailPage() {
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const refreshScheduleRef = useRef<() => Promise<unknown>>(async () => undefined);
  const scheduleRevisionRef = useRef('');
  const scheduleFetcher = useCallback((url: string) => {
    // An SSE invalidation must not reuse a browser/CDN response cached before
    // the change; keep SWR keys stable while requesting a fresh HTTP snapshot.
    if (!scheduleRevisionRef.current) return fetcher(url);
    return fetcher(`${url}${url.includes('?') ? '&' : '?'}_scheduleSync=${scheduleRevisionRef.current}`);
  }, []);
  const refreshSchedule = useCallback(() => refreshScheduleRef.current(), []);
  const { connected: scheduleConnected } = useEventScheduleStream(eventId, refreshSchedule);
  const scheduleRefreshInterval = scheduleConnected ? 0 : 30_000;
  const { data: eventResponse, isLoading: eventLoading } = useSWR<EventData>(
    eventId ? `/events/${eventId}` : null,
    fetcher,
  );
  const { data: scheduleSummary, isLoading: summaryLoading, mutate: mutateScheduleSummary } = useSWR<ScheduleSummary>(
    eventId ? `/matches/event/${eventId}/schedule-summary?hideByes=true` : null,
    scheduleFetcher,
    { refreshInterval: scheduleRefreshInterval },
  );

  const event = eventResponse || (eventId === demoEvent.id ? demoEvent : undefined);
  const dateGroups = useMemo(() => scheduleSummary?.dates || [], [scheduleSummary?.dates]);
  const [selectedDate, setSelectedDate] = useState<string>();
  const [selectedSportId, setSelectedSportId] = useState<string>();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>();
  const [selectedFopId, setSelectedFopId] = useState<string>();
  const [selectedFederationId, setSelectedFederationId] = useState<string>();
  const { data: eventFederations, isLoading: federationsLoading, error: federationsError } = useSWR<{ id: string; name: string }[]>(
    eventId ? `/events/${eventId}/federation-filters` : null, fetcher,
  );
  const [filterForm] = Form.useForm<ScheduleFilters>();
  const [matchFilters, setMatchFilters] = useState<ScheduleFilters>({});
  const hasMatchFilters = Object.values(matchFilters).some((value) => value !== undefined && value !== null && String(value).trim());
  useEffect(() => {
    if (!dateGroups.length) return;
    if (!selectedDate || (selectedDate !== 'all' && !dateGroups.some((group) => group.date === selectedDate))) {
      setSelectedDate('all');
    }
  }, [dateGroups, selectedDate]);

  const getMatchesKey = useCallback((pageIndex: number, previousPage: MatchPage | null) => {
    if (!eventId || !selectedDate) return null;
    if (previousPage && !previousPage.meta.hasMore) return null;

    const query = new URLSearchParams({
      eventId,
      pagination: 'cursor',
      limit: '50',
      hideByes: 'true',
      matchNumberOrder: 'asc',
    });
    if (pageIndex > 0 && previousPage?.meta.nextCursor) {
      query.set('cursor', previousPage.meta.nextCursor);
    }
    if (selectedDate !== 'all') query.set('date', selectedDate);
    Object.entries(matchFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) query.set(key, String(value).trim());
    });
    if (selectedSportId) query.set('sportId', selectedSportId);
    if (selectedCategoryId) query.set('categoryId', selectedCategoryId);
    if (selectedFopId) query.set('fopId', selectedFopId);
    if (selectedFederationId) query.set('federationId', selectedFederationId);
    return `/matches?${query}`;
  }, [eventId, matchFilters, selectedCategoryId, selectedDate, selectedFopId, selectedSportId, selectedFederationId]);

  const {
    data: matchPages,
    error: matchesError,
    isLoading: matchesLoading,
    isValidating: matchesValidating,
    setSize,
    mutate: mutateMatches,
  } = useSWRInfinite<MatchPage>(getMatchesKey, scheduleFetcher, {
    persistSize: false,
    revalidateFirstPage: true,
    revalidateAll: true,
    refreshInterval: scheduleRefreshInterval,
  });
  useEffect(() => {
    refreshScheduleRef.current = () => {
      scheduleRevisionRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return Promise.allSettled([mutateScheduleSummary(), mutateMatches()]);
    };
  }, [mutateScheduleSummary, mutateMatches]);
  const activeMatches = useMemo(() => {
    const uniqueMatches = new Map<string, Match>();
    matchPages?.forEach((page) => page.items.forEach((match) => uniqueMatches.set(match.id, match)));
    return Array.from(uniqueMatches.values());
  }, [matchPages]);
  const lastPage = matchPages?.[matchPages.length - 1];
  const hasMore = Boolean(lastPage?.meta.hasMore);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !matchesValidating) {
        setSize((currentSize) => currentSize + 1);
      }
    }, { rootMargin: '500px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, matchesValidating, setSize]);

  const eventSports = event?.sports?.length ? event.sports : event?.sport ? [event.sport] : [];
  const eventCategories = useMemo<EventCategory[]>(() => {
    if (event?.categories?.length) return event.categories;
    const categoryMap = new Map<string, EventCategory>();
    activeMatches.forEach((match) => {
      const category = match.category;
      if (category) categoryMap.set(category.id, category);
    });
    return Array.from(categoryMap.values());
  }, [activeMatches, event?.categories]);
  const filteredCategories = useMemo(
    () => eventCategories.filter((category) => (
      !selectedSportId || category.sportId === selectedSportId || category.sport?.id === selectedSportId
    )),
    [eventCategories, selectedSportId],
  );

  const [registrationPage, setRegistrationPage] = useState(1);
  useEffect(() => {
    setRegistrationPage(1);
  }, [selectedSportId, selectedCategoryId, selectedFopId, selectedDate, selectedFederationId]);
  const registrationSummaryKey = useMemo(() => {
    if (!eventId) return null;
    const query = new URLSearchParams();
    query.set('page', String(registrationPage));
    if (selectedSportId) query.set('sportId', selectedSportId);
    if (selectedCategoryId) query.set('categoryId', selectedCategoryId);
    if (selectedFopId) query.set('fopId', selectedFopId);
    if (selectedFederationId) query.set('federationId', selectedFederationId);
    if (selectedDate && selectedDate !== 'all') query.set('date', selectedDate);
    return `/events/${eventId}/registration-summary?${query}`;
  }, [eventId, selectedSportId, selectedCategoryId, selectedFopId, selectedDate, registrationPage, selectedFederationId]);
  const { data: registrationSummary, error: registrationSummaryError, isLoading: registrationSummaryLoading,
    mutate: mutateRegistrationSummary } = useSWR<{ items: RegistrationSummaryRow[]; total: number }>(
    registrationSummaryKey, fetcher, { refreshInterval: 15_000 },
  );

  useEffect(() => {
    if (selectedCategoryId && !filteredCategories.some((category) => category.id === selectedCategoryId)) {
      setSelectedCategoryId(undefined);
    }
  }, [filteredCategories, selectedCategoryId]);

  const totalMatches = scheduleSummary?.total ?? event?._count?.matches ?? 0;
  const liveMatchTarget = scheduleSummary?.liveMatch;
  const [pendingLiveMatchId, setPendingLiveMatchId] = useState<string>();
  const hasLiveMatches = Boolean(liveMatchTarget);
  const loading = eventLoading
    || summaryLoading
    || Boolean(dateGroups.length && !selectedDate)
    || Boolean(selectedDate && !matchPages && matchesLoading);

  useEffect(() => {
    if (!pendingLiveMatchId || loading || matchesValidating) return;
    const liveMatchElement = document.getElementById(`match-${pendingLiveMatchId}`);
    if (!liveMatchElement) {
      if (hasMore) setSize((currentSize) => currentSize + 1);
      return;
    }

    const animationFrame = requestAnimationFrame(() => {
      liveMatchElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      liveMatchElement.focus({ preventScroll: true });
      setPendingLiveMatchId(undefined);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [activeMatches, hasMore, loading, matchesValidating, pendingLiveMatchId, setSize]);

  const scrollToLiveMatch = () => {
    if (!liveMatchTarget) return;
    const targetIsVisible = activeMatches.some((match) => match.id === liveMatchTarget.id);

    if (!targetIsVisible) {
      filterForm.resetFields();
      setMatchFilters({});
      setSelectedDate(liveMatchTarget.date);
      setSelectedSportId(undefined);
      setSelectedCategoryId(undefined);
      setSelectedFopId(undefined);
      setSelectedFederationId(undefined);
      setSize(1);
    }
    setPendingLiveMatchId(liveMatchTarget.id);
  };

  const registrationState = event ? getRegistrationState(event) : { open: false, expired: false, label: '' };

  return (
    <div className="schedule-page min-h-screen pb-20">
        <section className={`event-detail-hero${event?.bannerUrl ? ' has-banner' : ''}`}>
          {event?.bannerUrl && (
            <div className="event-detail-banner-wrap">
              <div className="event-detail-banner-backdrop" style={{ backgroundImage: `url(${JSON.stringify(imageUrl(event.bannerUrl, 'hero'))})` }} aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="event-detail-banner" src={imageUrl(event.bannerUrl, 'hero')} alt={`Banner ${event.name}`} fetchPriority="high" decoding="async" />
            </div>
          )}
        <header className="event-detail-heading">
          <div className="event-detail-identity">
            <span className="event-detail-logo">
              {event?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl(event.logoUrl, 'logo')} alt={`Logo ${event.name}`} />
              ) : <Trophy aria-hidden="true" className="h-10 w-10 text-sky-500" />}
            </span>
          </div>
          <h1 className="mx-auto max-w-4xl text-xl font-black uppercase leading-tight text-slate-100 sm:text-2xl lg:text-[1.7rem]">
            {event?.name || 'Lịch thi đấu'}
          </h1>
          <p className="mt-3 text-sm text-slate-300">
            <span>{totalMatches.toLocaleString()} trận đấu</span>
            <span className="mx-2 text-slate-600">·</span>
            <span>{dateGroups.length || 1} ngày thi đấu</span>
            {(event?._count?.athletes ?? 0) > 0 && (
              <>
                <span className="mx-2 text-slate-600">·</span>
                <span>{event?._count?.athletes?.toLocaleString()} VĐV</span>
              </>
            )}
          </p>
          {eventSports.length > 0 && (
            <div className="event-detail-sports mt-3 flex flex-wrap gap-2">
              {eventSports.map((sport) => <Tag color="blue" key={sport.id}>{sport.name}</Tag>)}
            </div>
          )}
          {event && (
            <div className="event-detail-meta">
              <span><CalendarDays aria-hidden="true" size={16} />{new Date(event.startDate).toLocaleDateString('vi-VN')} – {new Date(event.endDate).toLocaleDateString('vi-VN')}</span>
              {event.location && <span><MapPin aria-hidden="true" size={16} />{event.location}</span>}
            </div>
          )}
        </header>
        </section>
      <div className="mx-auto w-full max-w-[1200px] px-3 sm:px-5">

        <Card className="schedule-registration-card registration-flow mt-7" title={<span className="flex items-center gap-2"><TicketCheck className="h-5 w-5 text-sky-400" />Tham gia sự kiện</span>} extra={<Tag color={registrationState.open ? 'success' : 'default'}>{registrationState.label}</Tag>}>
          <p className="registration-muted mb-5">Bạn tham gia với vai trò nào? Chọn bên dưới để mở thông tin đăng ký phù hợp.</p>
          <RegistrationRolePicker eventId={eventId} disabled={!registrationState.open} />
          <div className="registration-card-note"><TicketCheck size={17} /><span>Vé có mã QR được gửi qua email sau khi hồ sơ được duyệt.</span><Link href="/account">Xem hồ sơ và vé của tôi →</Link></div>
        </Card>

        <div className="event-shared-filter-label mt-7"><strong>Bộ lọc chung</strong><span>Áp dụng cho bảng đăng ký và lịch thi đấu</span></div>
        <div className="schedule-day-tabs mt-4 flex flex-wrap justify-center gap-2">
          <Button
            type={selectedDate === 'all' ? 'primary' : 'default'}
            shape="round"
            onClick={() => { setPendingLiveMatchId(undefined); setSize(1); setSelectedDate('all'); }}
          >Tất cả ngày ({totalMatches.toLocaleString()})</Button>
          {dateGroups.map((group) => {
            const active = group.date === (selectedDate || dateGroups[0]?.date);
            return (
              <Button
                key={group.date}
                type={active ? 'primary' : 'default'}
                shape="round"
                className={active ? 'schedule-day-active' : 'schedule-day-button'}
                onClick={() => {
                  setPendingLiveMatchId(undefined);
                  setSize(1);
                  setSelectedDate(group.date);
                }}
              >
                {group.date} ({group.count.toLocaleString()})
              </Button>
            );
          })}
        </div>

        <div className="schedule-filter-bar mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            aria-label="Lọc bộ môn"
            allowClear
            size="large"
            placeholder="Tất cả bộ môn"
            value={selectedSportId}
            onChange={(value) => {
              setPendingLiveMatchId(undefined);
              setSize(1);
              setSelectedSportId(value);
              setSelectedCategoryId(undefined);
            }}
            options={eventSports.map((sport) => ({ value: sport.id, label: sport.name }))}
          />
          <Select
            aria-label="Lọc hạng cân / nội dung"
            allowClear
            showSearch
            size="large"
            optionFilterProp="label"
            placeholder="Tất cả hạng cân / nội dung"
            value={selectedCategoryId}
            onChange={(value) => {
              setPendingLiveMatchId(undefined);
              setSize(1);
              setSelectedCategoryId(value);
            }}
            options={filteredCategories.map((category) => ({
              value: category.id,
              label: categoryLabel(category),
            }))}
          />
          <Select
            aria-label="Lọc sân / FOP"
            allowClear
            showSearch
            size="large"
            optionFilterProp="label"
            placeholder="Tất cả sân / FOP"
            value={selectedFopId}
            onChange={(value) => {
              setPendingLiveMatchId(undefined);
              setSize(1);
              setSelectedFopId(value);
            }}
            options={(event?.fops || []).map((fop) => ({ value: fop.id, label: fop.name }))}
          />
          <Select
            aria-label="Lọc đơn vị / CLB"
            allowClear
            showSearch
            size="large"
            optionFilterProp="label"
            placeholder="Tất cả đơn vị / CLB"
            value={selectedFederationId}
            loading={federationsLoading}
            notFoundContent={federationsError ? 'Không thể tải đơn vị / CLB' : 'Chưa có đơn vị / CLB'}
            onChange={(value) => {
              setPendingLiveMatchId(undefined);
              setSize(1);
              setSelectedFederationId(value);
            }}
            options={(eventFederations || []).map((federation) => ({ value: federation.id, label: federation.name }))}
          />
        </div>

        <Card className="event-registration-summary mt-5" title={<span className="flex items-center gap-2"><Users className="h-5 w-5 text-sky-500" />Đăng ký theo hạng cân</span>}
          extra={registrationSummary && !registrationSummaryError ? <Tag color="blue">{registrationSummary.total.toLocaleString('vi-VN')} lượt đăng ký</Tag> : undefined}>
          <p className="event-summary-note">Danh sách VĐV tham gia từng hạng cân / nội dung. Chọn hạng cân ở bộ lọc trên để xem danh sách của hạng đó.</p>
          {(selectedDate && selectedDate !== 'all' || selectedFopId) && <p className="event-summary-note">Đang hiển thị VĐV ở các hạng có lịch đấu trong ngày / sân đã chọn.</p>}
          {registrationSummaryError ? <div className="event-roster-error">Không thể tải danh sách VĐV. <Button onClick={() => mutateRegistrationSummary()}>Thử lại</Button></div> : (
            <Table<RegistrationSummaryRow> rowKey="id" size="middle" loading={registrationSummaryLoading} dataSource={registrationSummary?.items || []}
              scroll={{ x: 900 }} pagination={{ current: registrationPage, pageSize: 20, total: registrationSummary?.total || 0,
                onChange: setRegistrationPage, showSizeChanger: false, hideOnSinglePage: true }}
              locale={{ emptyText: 'Chưa có VĐV đăng ký phù hợp với bộ lọc.' }}
              columns={[
                { title: 'STT', key: 'index', width: 60, render: (_, __, index) => (registrationPage - 1) * 20 + index + 1 },
                { title: 'Vận động viên', key: 'athlete', width: 230, render: (_, row) => <strong className="event-roster-name">{row.athlete.fullName}</strong> },
                { title: 'Đơn vị / CLB', key: 'federation', width: 180, render: (_, row) => row.federation?.name || row.athlete.federation?.name || 'Tự do' },
                { title: 'Quốc gia', key: 'country', width: 130, render: (_, row) => row.athlete.country?.name || '—' },
                { title: 'Hạng cân / Nội dung', key: 'category', render: (_, row) => <Link className="event-summary-category" href={`/events/${eventId}/categories/${row.category.id}`}>{categoryLabel(row.category)}<span className="event-roster-sport">{row.category.sport?.name}</span></Link> },
                { title: 'Trạng thái', key: 'status', width: 140, render: (_, row) => <Tag color={row.status === 'CONFIRMED' ? 'success' : 'gold'}>{row.status === 'CONFIRMED' ? 'Đã xác nhận' : 'Chờ duyệt'}</Tag> },
              ]} />
          )}
        </Card>

        <div className="event-shared-filter-label mt-7"><strong>Lịch thi đấu</strong><span>Tìm kiếm chi tiết trận đấu bên dưới</span></div>
        <Card className="mt-4">
          <Form
            form={filterForm}
            layout="vertical"
            onFinish={(values: ScheduleFilters) => {
              setPendingLiveMatchId(undefined);
              setSize(1);
              setMatchFilters(values);
            }}
          >
            <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-5">
              <Form.Item name="athleteName" label="Tên VĐV">
                <Input allowClear placeholder="Nhập tên hoặc một phần tên" />
              </Form.Item>
              <Form.Item name="opponentName" label="Tên đối thủ">
                <Input allowClear placeholder="Nhập thêm tên để tìm cặp đấu" />
              </Form.Item>
              <Form.Item name="matchNumber" label="Số trận">
                <InputNumber className="!w-full" min={1} max={2147483647} precision={0} placeholder="Ví dụ: 12" />
              </Form.Item>
              <Form.Item name="round" label="Vòng đấu">
                <InputNumber className="!w-full" min={1} max={2147483647} precision={0} placeholder="Tất cả vòng" />
              </Form.Item>
              <Form.Item name="status" label="Trạng thái">
                <Select allowClear placeholder="Tất cả trạng thái" options={Object.entries(MATCH_STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))} />
              </Form.Item>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="primary" htmlType="submit">Tìm trận đấu</Button>
              <Button onClick={() => {
                filterForm.resetFields();
                setMatchFilters({});
                setSelectedSportId(undefined);
                setSelectedCategoryId(undefined);
                setSelectedFopId(undefined);
                setSelectedFederationId(undefined);
                setPendingLiveMatchId(undefined);
                setSize(1);
              }}>Xóa bộ lọc</Button>
              <span className="text-sm text-slate-500">Tìm cặp đấu theo bất kỳ thứ tự nào. Chọn “Tất cả ngày” để tìm trong toàn sự kiện.</span>
            </div>
          </Form>
        </Card>

        <main className="mt-5 space-y-5">
          {matchesError ? (
            <ToastNotice type="error" showIcon message="Không thể tải danh sách trận đấu. Vui lòng thử lại." />
          ) : loading ? (
            <ScheduleSkeleton />
          ) : activeMatches.length ? (
            <>
              {activeMatches.map((match) => (
                <MatchCard
                  key={match.id}
                  id={match.id}
                  eventId={match.eventId}
                  categoryId={match.categoryId}
                  categoryName={match.category?.name}
                  matchNumber={match.matchNumber}
                  fop={match.fopRecord?.name || match.fop}
                  matchDate={match.matchDate}
                  startTime={match.startTime}
                  athlete1={match.athlete1}
                  athlete2={match.athlete2}
                  athlete1Score={match.athlete1Score}
                  athlete2Score={match.athlete2Score}
                  athlete1Advantages={match.athlete1Advantages}
                  athlete2Advantages={match.athlete2Advantages}
                  athlete1Penalties={match.athlete1Penalties}
                  athlete2Penalties={match.athlete2Penalties}
                  status={match.status}
                  matchType={match.matchType}
                  winnerId={match.winnerId}
                  winMethod={match.winMethod}
                  notes={match.notes}
                />
              ))}
              <div ref={loadMoreRef} className="flex min-h-16 items-center justify-center py-3">
                {matchesValidating ? (
                  <Spin size="small" />
                ) : !hasMore ? (
                  <span className="text-xs font-medium text-slate-500">
                    Đã hiển thị toàn bộ {activeMatches.length.toLocaleString()} trận
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <Card className="schedule-empty-card">
              <Empty
                image={<Trophy className="mx-auto h-12 w-12 text-slate-600" />}
                description={hasMatchFilters || selectedSportId || selectedCategoryId || selectedFopId || selectedFederationId
                  ? 'Không tìm thấy trận đấu phù hợp. Thử đổi bộ lọc hoặc chọn tất cả ngày.'
                  : selectedDate === 'all' ? 'Chưa có trận đấu trong sự kiện này.' : 'Chưa có trận đấu trong ngày này.'}
              />
            </Card>
          )}
        </main>
      </div>

      {hasLiveMatches && (
        <button
          type="button"
          className="schedule-live-float"
          onClick={scrollToLiveMatch}
          aria-label="Cuộn đến trận đang thi đấu"
          title="Xem trận đang thi đấu"
        >
          <Radio className="h-3.5 w-3.5" />
          TRỰC TIẾP
        </button>
      )}
    </div>
  );
}

function ScheduleSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <Card key={index} className="schedule-match-card" styles={{ body: { padding: 20 } }}>
          <Skeleton active paragraph={{ rows: 2 }} />
        </Card>
      ))}
    </div>
  );
}
