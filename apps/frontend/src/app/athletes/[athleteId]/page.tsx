'use client';

import { imageUrl } from '@/lib/image-url';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { Alert, Button, Card, Empty, Pagination, Skeleton, Statistic, Tag } from 'antd';
import {
  ArrowLeft,
  Calendar,
  Scale,
  Ruler,
  MapPin,
  Building2,
  Trophy,
  Swords,
  TrendingUp,
  Target,
  Users,
} from 'lucide-react';
import { fetcher } from '@/lib/api';
import { calculateAge, formatDate, cn } from '@/lib/utils';
import { MatchCard } from '@/components/MatchCard';
import { AthleteEventHistory, type AthletePerformance } from '@/components/AthleteEventHistory';

type MatchResponse = { items: any[]; meta: { total: number } };

export default function AthleteProfilePage() {
  const params = useParams();
  const athleteId = (params as any).athleteId as string;

  const swrAthlete = useSWR(athleteId ? '/athletes/' + athleteId : null, fetcher);
  const athlete = swrAthlete.data as any;
  const athleteLoading = swrAthlete.isLoading;

  const [resultPage, setResultPage] = useState(1);
  const performanceQuery = useSWR<AthletePerformance>(athleteId ? `/athletes/${athleteId}/performance` : null, fetcher);
  const performance = performanceQuery.data;
  const matchUrl = athleteId ? `/matches?athleteId=${encodeURIComponent(athleteId)}&hideByes=true` : null;
  const scheduledQuery = useSWR<MatchResponse>(matchUrl ? `${matchUrl}&status=SCHEDULED&limit=10` : null, fetcher);
  const runningQuery = useSWR<MatchResponse>(matchUrl ? `${matchUrl}&status=RUNNING&limit=10` : null, fetcher);
  const resultsQuery = useSWR<MatchResponse>(matchUrl ? `${matchUrl}&status=FINISHED&limit=10&page=${resultPage}` : null, fetcher);
  const scheduledMatches = useMemo(
    () => [...(runningQuery.data?.items || []), ...(scheduledQuery.data?.items || [])],
    [runningQuery.data, scheduledQuery.data],
  );
  const completedMatches = resultsQuery.data?.items || [];

  const isLoading = athleteLoading;

  if (isLoading && !athlete) {
    return <ProfileSkeleton />;
  }

  if (!athlete) {
    return (
      <Card className="public-surface mx-auto mt-16 max-w-3xl">
        <Empty
          image={<Users className="mx-auto h-12 w-12 text-slate-600" />}
          description="Không tìm thấy vận động viên"
        >
          <Link href="/rankings"><Button type="primary" icon={<ArrowLeft className="h-4 w-4" />}>Xem bảng xếp hạng</Button></Link>
        </Empty>
      </Card>
    );
  }

  const overallStat = performance;
  const totalMatches = performance?.totalMatches ?? '—';
  const wins = performance?.wins ?? '—';
  const losses = performance?.losses ?? '—';
  const winRate = performance?.winRate;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/rankings">
        <Button type="text" icon={<ArrowLeft className="h-4 w-4" />}>Bảng xếp hạng</Button>
      </Link>

      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 rounded-none lg:rounded-b-3xl overflow-hidden">
        <div className="relative h-56 sm:h-64 bg-gradient-to-br from-sdark-800 via-sdark-900 to-sdark-950">
          <div className="absolute inset-0 p-6 sm:p-8 lg:p-10 flex items-end gap-6">
            <div className="relative flex-shrink-0">
              <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-3xl bg-sdark-800 border-4 border-sdark-950 overflow-hidden shadow-2xl">
                {athlete.photoUrl ? (
                  <Image src={imageUrl(athlete.photoUrl, 'portrait')!} sizes="(max-width: 768px) 160px, 240px" alt={athlete.fullName} fill className="object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-600">
                    <Users className="w-16 h-16" />
                  </div>
                )}
              </div>
              {athlete.country && (
                <div className="absolute -bottom-2 -right-2 grid h-11 w-14 place-items-center overflow-hidden rounded-xl border-2 border-sdark-950 bg-sdark-800 shadow-xl">
                  <CountryFlag country={athlete.country} />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 pb-2">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {(athlete.categories || []).slice(0, 3).map(function (c: any) {
                  return (
                    <Tag key={c.id} color="blue" icon={<Target className="h-3 w-3" />}>
                      {c.name}
                    </Tag>
                  );
                })}
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-slate-100 tracking-tight drop-shadow-lg">
                {athlete.fullName}
              </h1>
              <p className="mt-1 text-slate-300 text-base sm:text-lg font-medium flex flex-wrap items-center gap-3">
                {athlete.country?.name}
                {athlete.federation?.name && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-sblue-400" />
                    {athlete.federation.name}
                  </span>
                )}
              </p>
            </div>

            <div className="hidden md:flex flex-col items-end gap-2 pb-2">
              <Tag color="gold" icon={<Trophy className="h-4 w-4" />}>Thành tích nổi bật</Tag>
              <div className="flex gap-2 text-2xl font-black">
                <span className="text-yellow-400">{overallStat?.goldMedals ?? '—'}</span>
                <span className="text-slate-300">/</span>
                <span className="text-slate-300">{overallStat?.silverMedals ?? '—'}</span>
                <span className="text-slate-300">/</span>
                <span className="text-amber-700">{overallStat?.bronzeMedals ?? '—'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <Card className="public-surface" title={<span className="flex items-center gap-2"><Users className="h-5 w-5 text-sblue-400" />Thông tin cá nhân</span>}>
            <div className="space-y-3.5">
              <InfoStat
                icon={<Calendar className="w-4 h-4 text-sblue-400" />}
                label="Ngày sinh"
                value={formatDate(athlete.birthDate) || '—'}
                sub={athlete.birthDate ? calculateAge(athlete.birthDate) + ' tuổi' : undefined}
              />
              <InfoStat
                icon={<Users className="w-4 h-4 text-sblue-400" />}
                label="Giới tính"
                value={athlete.gender === 'FEMALE' ? 'Nữ' : athlete.gender === 'MIXED' ? 'Hỗn hợp' : 'Nam'}
              />
              {athlete.height != null && <InfoStat
                icon={<Ruler className="w-4 h-4 text-sblue-400" />}
                label="Chiều cao"
                value={athlete.height + ' cm'}
              />}
              {athlete.weight != null && <InfoStat
                icon={<Scale className="w-4 h-4 text-sblue-400" />}
                label="Cân nặng"
                value={athlete.weight + ' kg'}
              />}
              <InfoStat
                icon={<MapPin className="w-4 h-4 text-sblue-400" />}
                label="Quốc tịch"
                value={athlete.country?.name || '—'}
                sub={athlete.country?.code}
              />
              <InfoStat
                icon={<Building2 className="w-4 h-4 text-sblue-400" />}
                label="Liên đoàn / CLB"
                value={athlete.federation?.name || '—'}
              />
            </div>
          </Card>

          <Card className="public-surface" title={<span className="flex items-center gap-2"><Trophy className="h-5 w-5 text-sgold-400" />Thành tích huy chương</span>}>
            <div className="grid grid-cols-3 gap-3">
              <MedalTile label="Vàng" color="from-yellow-400 to-amber-500" value={overallStat?.goldMedals || 0} />
              <MedalTile label="Bạc" color="from-slate-300 to-slate-400" value={overallStat?.silverMedals || 0} />
              <MedalTile label="Đồng" color="from-amber-700 to-amber-900" value={overallStat?.bronzeMedals || 0} />
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Tổng trận"
              value={totalMatches}
              icon={<Swords className="w-5 h-5" />}
              color="from-sblue-500 to-blue-600"
            />
            <StatCard
              label="Thắng"
              value={wins}
              icon={<TrendingUp className="w-5 h-5" />}
              color="from-emerald-500 to-green-600"
            />
            <StatCard
              label="Thua"
              value={losses}
              icon={<Swords className="w-5 h-5 rotate-180" />}
              color="from-rose-500 to-red-600"
            />
            <StatCard
              label="Tỷ lệ thắng"
              value={winRate == null ? '—' : winRate + '%'}
              icon={<Target className="w-5 h-5" />}
              color="from-sgold-500 to-amber-600"
            />
          </div>

          {performanceQuery.error && <Alert type="error" showIcon title="Không tải được thống kê thi đấu" action={<Button onClick={() => void performanceQuery.mutate()}>Thử lại</Button>} />}
          {performance && <>
            <p className="text-sm text-slate-500">Đã ghi nhận {performance.totalMatches} trận hoàn thành; có mặt trong danh sách {performance.eventCount} sự kiện. Thắng/thua và tỷ lệ thắng tính theo kết quả đã công bố; không tính lượt miễn đấu hoặc trận bị hủy.{performance.pendingResults > 0 ? ` Có ${performance.pendingResults} trận đang chờ công bố kết quả.` : ''}</p>
            <AthleteEventHistory events={performance.events} />
          </>}

          <MatchList
            title="Lịch thi đấu"
            subtitle="Trận đang diễn ra và sắp tới"
            matches={scheduledMatches}
            loading={scheduledQuery.isLoading || runningQuery.isLoading}
            emptyText="Chưa có lịch thi đấu sắp tới."
          />
          <MatchList
            title="Lịch sử kết quả thi đấu"
            subtitle="Các trận đã hoàn thành"
            matches={completedMatches}
            loading={resultsQuery.isLoading}
            emptyText="Chưa có kết quả thi đấu."
          />
          {(resultsQuery.data?.meta?.total || 0) > 10 && <div className="flex justify-end"><Pagination current={resultPage} pageSize={10} total={resultsQuery.data.meta.total} showSizeChanger={false} onChange={setResultPage} /></div>}
        </div>
      </div>
    </div>
  );
}

function CountryFlag({ country }: { country: { code?: string; name?: string; flagUrl?: string } }) {
  const [imageFailed, setImageFailed] = useState(false);
  const flagUrl = country.flagUrl || '';
  const alpha2 = flagUrl.match(/\/([a-z]{2})\.png(?:\?|$)/i)?.[1];
  const emoji = alpha2
    ? alpha2.toUpperCase().replace(/[A-Z]/g, (letter) =>
        String.fromCodePoint(127397 + letter.charCodeAt(0)))
    : '🌐';

  if (!flagUrl || imageFailed) {
    return <span className="text-2xl leading-none" role="img" aria-label={`Cờ ${country.name || country.code || ''}`}>{emoji}</span>;
  }

  return (
    // Country flag URLs are data-managed and may use arbitrary federation hosts.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={flagUrl}
      alt={`Cờ ${country.name || country.code || ''}`}
      className="h-full w-full object-cover"
      onError={() => setImageFailed(true)}
    />
  );
}

function MatchList({
  title,
  subtitle,
  matches,
  loading,
  emptyText,
}: {
  title: string;
  subtitle: string;
  matches: any[];
  loading: boolean;
  emptyText: string;
}) {
  return (
    <Card className="public-surface">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-sblue-500/10 text-sblue-400">
          <Swords className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-bold text-slate-100">{title}</h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <span className="ml-auto text-xs font-semibold text-slate-500">{matches.length} trận</span>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 gap-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index} className="public-surface h-36"><Skeleton active avatar paragraph={{ rows: 2 }} /></Card>
          ))}
        </div>
      ) : matches.length === 0 ? (
        <Empty image={<Calendar className="mx-auto h-9 w-9 text-slate-700" />} description={emptyText} />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {matches.map((match) => (
            <div key={match.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {match.event?.name && <Link href={`/events/${match.eventId}`} className="text-sky-500 hover:underline">{match.event.name}</Link>}
              {match.status === 'FINISHED' && !['PUBLISHED', 'LOCKED'].includes(match.resultStatus) && <Tag color="orange">Chờ công bố kết quả</Tag>}
            </div>
            <MatchCard
              key={match.id}
              id={match.id}
              eventId={match.eventId}
              categoryId={match.categoryId}
              categoryName={match.category?.name}
              matchNumber={match.matchNumber}
              fop={match.fop}
              matchDate={match.matchDate}
              startTime={match.startTime}
              athlete1={match.athlete1 || (match.team1 && { ...match.team1, fullName: match.team1.members?.map((member: any) => member.athlete?.fullName).join(' / ') || match.team1.name })}
              athlete2={match.athlete2 || (match.team2 && { ...match.team2, fullName: match.team2.members?.map((member: any) => member.athlete?.fullName).join(' / ') || match.team2.name })}
              athlete1Score={match.athlete1Score}
              athlete2Score={match.athlete2Score}
              athlete1Advantages={match.athlete1Advantages}
              athlete2Advantages={match.athlete2Advantages}
              athlete1Penalties={match.athlete1Penalties}
              athlete2Penalties={match.athlete2Penalties}
              status={match.status}
              matchType={match.matchType}
              winnerId={match.winnerTeamId || match.winnerId}
              winMethod={match.winMethod}
              notes={match.notes}
              pool={match.pool}
            />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function InfoStat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 w-9 h-9 rounded-xl bg-sdark-800/70 border border-sdark-700 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
        <div className="font-semibold text-slate-100 mt-0.5 leading-tight">{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Card className="public-surface relative overflow-hidden">
      <div className={cn('absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-30 bg-gradient-to-br', color)} />
      <div className="relative flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-400">{label}</span>
        <div className={cn('w-9 h-9 rounded-xl text-white flex items-center justify-center bg-gradient-to-br shadow-lg', color)}>
          {icon}
        </div>
      </div>
      <Statistic value={value} valueStyle={{ color: '#f1f5f9', fontWeight: 900 }} />
    </Card>
  );
}

function MedalTile({
  label,
  color,
  value,
}: {
  label: string;
  color: string;
  value: number;
}) {
  return (
    <Card size="small" className="public-surface text-center">
      <div className={cn('w-10 h-10 mx-auto rounded-full bg-gradient-to-br shadow-lg mb-2.5', color)} />
      <div className="text-xs font-semibold text-slate-400 mb-1">{label}</div>
      <Statistic value={value} valueStyle={{ color: '#f1f5f9', fontSize: 24, fontWeight: 900 }} />
    </Card>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton.Button active size="small" />
      <Card className="public-surface"><Skeleton active avatar={{ size: 144 }} paragraph={{ rows: 3 }} /></Card>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="public-surface"><Skeleton active avatar paragraph={{ rows: 8 }} /></Card>
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map(function (_, i) {
              return <Card key={i} className="public-surface h-28"><Skeleton active paragraph={{ rows: 1 }} /></Card>;
            })}
          </div>
          <Card className="public-surface"><Skeleton active avatar paragraph={{ rows: 6 }} /></Card>
        </div>
      </div>
    </div>
  );
}
