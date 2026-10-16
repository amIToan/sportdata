'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { Avatar, Button, Card, Empty, Skeleton, Table, Tag, type TableProps } from 'antd';
import {
  ArrowLeft,
  Crown,
  Medal,
  RefreshCw,
  Swords,
  Trophy,
} from 'lucide-react';
import { SportdataBracket } from '@/components/brackets/SportdataBracket';
import { fetcher } from '@/lib/api';
import { categoryMedalStandings } from '@/lib/category-standings';
import { cn, formatTime } from '@/lib/utils';
import { MATCH_STATUS_META, MATCH_TYPE_LABELS, WIN_METHOD_LABELS, labelOf, statusMeta } from '@/lib/vi-labels';

interface Country {
  code?: string;
  name?: string;
  flagUrl?: string | null;
}

interface Federation {
  id?: string;
  name?: string;
}

interface Athlete {
  isTeam?: boolean;
  id: string;
  fullName: string;
  photoUrl?: string | null;
  country?: Country | null;
  federation?: Federation | null;
}

interface Division {
  id: string;
  name: string;
  _count?: { matches?: number };
}

interface CategoryData {
  id: string;
  name: string;
  gender?: string;
  discipline?: string | null;
  uniform?: string | null;
  beltLevel?: string | null;
  matchDurationSeconds?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
  minWeight?: number | null;
  maxWeight?: number | null;
  sport?: { id: string; name: string; code: string } | null;
  divisions?: Division[];
  _count?: { matches?: number };
}

interface EventData {
  id: string;
  name: string;
  ageLimitMode?: 'CATEGORY' | 'UNRESTRICTED' | 'CUSTOM';
  minAge?: number | null;
  maxAge?: number | null;
}

interface Standing {
  rank: number;
  athlete: Athlete;
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  winRate: number;
}

interface StandingsResponse {
  eventId: string;
  categoryId?: string | null;
  totalMatches: number;
  standings: Standing[];
}

interface MatchData {
  id: string;
  matchNumber?: number | null;
  fop?: string | null;
  matchDate: string;
  startTime?: string | null;
  team1?: { id: string; name: string; country?: Athlete['country']; members?: { athlete: { fullName: string } }[] } | null;
  team2?: MatchData['team1'];
  winnerTeamId?: string | null;
  athlete1?: Athlete | null;
  athlete2?: Athlete | null;
  athlete1Score: number;
  athlete2Score: number;
  athlete1Advantages?: number;
  athlete2Advantages?: number;
  athlete1Penalties?: number;
  athlete2Penalties?: number;
  winnerId?: string | null;
  status: string;
  matchType: string;
  winMethod?: string | null;
  round?: number | null;
  drawId?: string | null;
  bracketPosition?: number | null;
  winnerToMatchId?: string | null;
  winnerToSide?: 'ATHLETE1' | 'ATHLETE2' | null;
  loserToMatchId?: string | null;
  loserToSide?: 'ATHLETE1' | 'ATHLETE2' | null;
  pool?: string | null;
  notes?: string | null;
  division?: Division | null;
}

interface MatchesResponse {
  items: MatchData[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor?: string | null;
  };
}

interface DrawData {
  id: string;
  name: string;
  type: 'ROUND_ROBIN_POOL' | 'MAIN_TREE' | 'POOL_WINNER_TREE' | 'REPECHAGE' | 'REPECHAGE_QUARTERFINALS' | 'DOUBLE_ELIMINATION';
  bracketSize?: number | null;
  sortOrder: number;
  matches: MatchData[];
}

interface DrawsResponse {
  eventId: string;
  categoryId: string;
  draws: DrawData[];
}

const disciplineLabels: Record<string, string> = {
  NEWAZA: 'Newaza · Địa chiến',
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
  OPEN: 'Không giới hạn đai',
};

export default function CategoryDetailPage() {
  const params = useParams<{ eventId: string; categoryId: string }>();
  const { eventId, categoryId } = params;

  const {
    data: category,
    isLoading: categoryLoading,
    mutate: refreshCategory,
  } = useSWR<CategoryData>(categoryId ? `/categories/${categoryId}` : null, fetcher);
  const {
    data: event,
    isLoading: eventLoading,
    mutate: refreshEvent,
  } = useSWR<EventData>(eventId ? `/events/${eventId}` : null, fetcher);
  const {
    data: standingsResponse,
    isLoading: standingsLoading,
    mutate: refreshStandings,
  } = useSWR<StandingsResponse>(
    eventId && categoryId
      ? `/statistics/events/${eventId}/standings?categoryId=${encodeURIComponent(categoryId)}`
      : null,
    fetcher,
  );
  const getMatchesKey = useCallback((pageIndex: number, previousPage: MatchesResponse | null) => {
    if (!eventId || !categoryId || (previousPage && !previousPage.meta.hasMore)) return null;
    const query = new URLSearchParams({
      eventId,
      categoryId,
      pagination: 'cursor',
      limit: '50',
    });
    if (pageIndex > 0 && previousPage?.meta.nextCursor) {
      query.set('cursor', previousPage.meta.nextCursor);
    }
    return `/matches?${query}`;
  }, [categoryId, eventId]);
  const {
    data: matchPages,
    isLoading: matchesLoading,
    isValidating: matchesValidating,
    mutate: refreshMatches,
    setSize: setMatchPageCount,
  } = useSWRInfinite<MatchesResponse>(getMatchesKey, fetcher, {
    persistSize: false,
    revalidateFirstPage: true,
    revalidateAll: true,
    refreshInterval: 5000,
  });
  const {
    data: drawsResponse,
    isLoading: drawsLoading,
    mutate: refreshDraws,
  } = useSWR<DrawsResponse>(
    eventId && categoryId
      ? `/matches/event/${encodeURIComponent(eventId)}/category/${encodeURIComponent(categoryId)}/draws`
      : null,
    fetcher,
    { refreshInterval: 5000 },
  );

  const standings = standingsResponse?.standings || [];
  const isPointsCategory = ['DUO', 'SHOW'].includes(category?.discipline || '')
    || /\b(DUO|SHOW)\b/i.test(category?.name || '');
  const matches = useMemo(
    () => [...(matchPages?.flatMap((page) => page.items) || [])]
      .sort((left, right) => (left.matchNumber || 0) - (right.matchNumber || 0)),
    [matchPages],
  );
  const matchesHaveMore = Boolean(matchPages?.at(-1)?.meta.hasMore);
  const draws = useMemo(
    () => [...(drawsResponse?.draws || [])].sort((left, right) => left.sortOrder - right.sortOrder),
    [drawsResponse],
  );
  const poolMatches = useMemo(() => matches.filter((match) => !match.drawId), [matches]);
  const finalStandings = (isPointsCategory ? standings : categoryMedalStandings(standings, draws))
    .slice(0, isPointsCategory ? 10 : 5);

  const isLoading = categoryLoading || eventLoading || standingsLoading || matchesLoading || drawsLoading;
  const mainDivision = category?.divisions?.find((division) => division.name.includes('MAIN TREE'));
  const divisionSuffix = mainDivision?.name.replace(category?.name || '', '').trim() || 'MAIN TREE POOL 1';
  const divisionLabel = `${category?.name || 'Hạng thi đấu'} - ${divisionSuffix}`;

  const refreshAll = () => {
    void Promise.all([
      refreshCategory(),
      refreshEvent(),
      refreshStandings(),
      refreshMatches(),
      refreshDraws(),
    ]);
  };

  return (
    <div className="category-page min-h-screen pb-20">
      <div className="mx-auto w-full max-w-[1900px] px-3 pt-4 sm:px-5 lg:px-8">
        <div className="flex items-center justify-between">
          <Button
            href={`/events/${eventId}`}
            type="text"
            icon={<ArrowLeft className="h-4 w-4" />}
            className="category-back-button"
          >
            Lịch thi đấu
          </Button>
          <Button
            type="text"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={refreshAll}
            aria-label="Làm mới dữ liệu"
            className="category-back-button"
          />
        </div>

        <header className="category-hero">
          <div className="category-crest">
            <Trophy className="h-9 w-9" />
            <span>JJ</span>
          </div>
          <h1>{event?.name || 'GIẢI ĐẤU JU-JITSU'}</h1>
          <h2>{category?.name || 'Hạng thi đấu'}</h2>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {category?.sport && <Tag color="blue">{category.sport.name}</Tag>}
            {category?.discipline && <Tag color="cyan">{disciplineLabels[category.discipline] || category.discipline}</Tag>}
            {category?.uniform && <Tag>{category.uniform === 'NO_GI' ? 'No-Gi' : 'Gi'}</Tag>}
            {category?.beltLevel && <Tag color="gold">{beltLabels[category.beltLevel] || category.beltLevel}</Tag>}
            {category?.gender && <Tag>{category.gender}</Tag>}
            {category?.maxWeight && <Tag>Đến {category.maxWeight} kg</Tag>}
            {event?.ageLimitMode === 'UNRESTRICTED' ? null : event?.ageLimitMode === 'CUSTOM' ? (
              <>
                {event.minAge != null && <Tag>Từ {event.minAge} tuổi</Tag>}
                {event.maxAge != null && <Tag>Tối đa {event.maxAge} tuổi</Tag>}
              </>
            ) : (
              <>
                {category?.minAge != null && <Tag>Từ {category.minAge} tuổi</Tag>}
                {category?.maxAge != null && <Tag>Tối đa {category.maxAge} tuổi</Tag>}
              </>
            )}
            {category?.matchDurationSeconds && <Tag>{Math.round(category.matchDurationSeconds / 60)} phút</Tag>}
          </div>
        </header>

        {isLoading ? (
          <CategorySkeleton />
        ) : (
          <>
            <section className="category-standings">
              <div className="category-section-title">{divisionLabel}</div>
              <div className="category-standings-label">
                <Medal className="h-4 w-4" />
                BẢNG XẾP HẠNG CHUNG CUỘC
              </div>
              {finalStandings.length ? (
                <Card className="category-standings-card" styles={{ body: { padding: 0 } }}>
                  <StandingsTable standings={finalStandings} expanded={isPointsCategory} />
                </Card>
              ) : (
                <Empty description="Chưa có kết quả xếp hạng" />
              )}
            </section>

            <section className="category-bracket-section">
              <div className="mb-5 flex items-center gap-3">
                <div className="category-section-icon">
                  <Swords className="h-5 w-5" />
                </div>
                <div>
                  <h3>{isPointsCategory ? 'Toàn bộ biên bản trận' : 'Cây thi đấu'}</h3>
                  <p>
                    {isPointsCategory
                      ? `${matches.length} lượt chấm điểm của hạng mục`
                      : `${draws.length} cấu trúc cây · ${poolMatches.length} biên bản ngoài cây`}
                  </p>
                </div>
              </div>
              {isPointsCategory ? (
                <MatchProtocolTable matches={matches} />
              ) : draws.length ? (
                <div className="space-y-6">
                  {draws.map((draw) => <SportdataBracket key={draw.id} draw={draw} sourceMatches={draws.flatMap((item) => item.matches)} />)}
                  {poolMatches.length > 0 && (
                    <div className="category-pool-protocols">
                      <div className="category-subsection-heading">
                        <h4>Biên bản vòng bảng</h4>
                        <span>{poolMatches.length} trận không thuộc nhánh loại trực tiếp</span>
                      </div>
                      <MatchProtocolTable matches={poolMatches} />
                    </div>
                  )}
                </div>
              ) : (
                <Card className="category-empty-card">
                  <Empty description="Hạng mục chưa có cấu trúc cây thi đấu" />
                </Card>
              )}
              {matchesHaveMore && (
                <div className="mt-5 flex justify-center">
                  <Button
                    loading={matchesValidating}
                    onClick={() => setMatchPageCount((current) => current + 1)}
                  >
                    Tải thêm 50 trận
                  </Button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function StandingsTable({ standings, expanded = false }: { standings: Standing[]; expanded?: boolean }) {
  const columns: TableProps<Standing>['columns'] = [
    {
      title: '#',
      dataIndex: 'rank',
      width: 72,
      align: 'center',
      render: (rank: number) => <RankBadge rank={rank} />,
    },
    {
      title: 'Vận động viên',
      key: 'athlete',
      render: (_, row) => {
        const content = <>
          <CountryFlag country={row.athlete.country} />
          <span>
            <strong>{row.athlete.fullName}</strong>
            <small>{row.athlete.federation?.name || row.athlete.country?.name || '—'}</small>
          </span>
        </>;
        return row.athlete.isTeam ? <div className="standing-athlete">{content}</div> : <Link href={`/athletes/${row.athlete.id}`} className="standing-athlete">{content}</Link>;
      },
    },
    {
      title: 'Quốc gia',
      key: 'country',
      width: 110,
      render: (_, row) => row.athlete.country?.code || '—',
    },
    {
      title: 'Trận',
      dataIndex: 'totalMatches',
      width: 82,
      align: 'center',
    },
    {
      title: 'Thắng',
      dataIndex: 'wins',
      width: 88,
      align: 'center',
      render: (value: number) => <Tag color="success">{value}</Tag>,
    },
    {
      title: 'Thua',
      dataIndex: 'losses',
      width: 80,
      align: 'center',
    },
    {
      title: 'Hiệu số',
      dataIndex: 'pointDifferential',
      width: 100,
      align: 'right',
      render: (value: number) => (
        <span className={value >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          {value > 0 ? '+' : ''}{value}
        </span>
      ),
    },
    ...(expanded
      ? [
          {
            title: 'Điểm ghi',
            dataIndex: 'pointsFor',
            width: 100,
            align: 'right' as const,
          },
          {
            title: 'Điểm thua',
            dataIndex: 'pointsAgainst',
            width: 100,
            align: 'right' as const,
          },
        ]
      : []),
  ];

  return (
    <Table
      rowKey={(row) => row.athlete.id}
      columns={columns}
      dataSource={standings}
      pagination={false}
      scroll={{ x: 760 }}
      size="middle"
    />
  );
}

function MatchProtocolTable({
  matches,
  compact = false,
}: {
  matches: MatchData[];
  compact?: boolean;
}) {
  const pointMatches = matches.filter((match) => ['POOL', 'GROUP_STAGE'].includes(match.matchType));
  const dataSource = compact ? pointMatches.slice(0, 20) : matches;
  const columns: TableProps<MatchData>['columns'] = [
    {
      title: 'Trận',
      key: 'number',
      width: 105,
      fixed: 'left',
      render: (_, match) => (
        <div className="protocol-match-number">
          <strong>{match.matchNumber ? `#${match.matchNumber}` : '—'}</strong>
          <small>{match.fop || 'Chưa xếp sân'}</small>
        </div>
      ),
    },
    {
      title: 'Vòng đấu',
      key: 'stage',
      width: 145,
      render: (_, match) => (
        <div className="protocol-stage">
          <strong>{labelOf(MATCH_TYPE_LABELS, match.matchType, 'Vòng đấu')}</strong>
          <small>{match.pool || match.division?.name || '—'}</small>
        </div>
      ),
    },
    {
      title: 'Giờ',
      key: 'time',
      width: 78,
      align: 'center',
      render: (_, match) => formatTime(match.startTime || match.matchDate) || '—',
    },
    {
      title: 'Vận động viên 1',
      key: 'athlete1',
      width: 300,
      render: (_, match) => (
        <ProtocolAthlete athlete={match.athlete1 || (match.team1 ? { ...match.team1, isTeam: true, fullName: match.team1.members?.map((member) => member.athlete.fullName).join(' / ') || match.team1.name } : null)} winner={Boolean(match.winnerId && match.winnerId === match.athlete1?.id || match.winnerTeamId && match.winnerTeamId === match.team1?.id)} />
      ),
    },
    {
      title: 'Kết quả',
      key: 'score',
      width: 125,
      align: 'center',
      render: (_, match) => (
        <div className="protocol-result">
          <strong>
            {['FINISHED', 'RUNNING'].includes(match.status)
              ? `${match.athlete1Score} : ${match.athlete2Score}`
              : '— : —'}
          </strong>
          <small>
            {match.winMethod
              ? labelOf(WIN_METHOD_LABELS, match.winMethod, 'Chưa xác định')
              : match.notes || '—'}
          </small>
        </div>
      ),
    },
    {
      title: 'Vận động viên 2',
      key: 'athlete2',
      width: 300,
      render: (_, match) => (
        <ProtocolAthlete athlete={match.athlete2 || (match.team2 ? { ...match.team2, isTeam: true, fullName: match.team2.members?.map((member) => member.athlete.fullName).join(' / ') || match.team2.name } : null)} winner={Boolean(match.winnerId && match.winnerId === match.athlete2?.id || match.winnerTeamId && match.winnerTeamId === match.team2?.id)} reverse />
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      align: 'center',
      render: (status: string) => {
        const item = statusMeta(MATCH_STATUS_META, status);
        return <Tag bordered={false} color={item.color}>{item.shortLabel || item.label}</Tag>;
      },
    },
  ];

  if (!dataSource.length) {
    return (
      <Card className="category-empty-card">
        <Empty description="Chưa có biên bản trận đấu" />
      </Card>
    );
  }

  return (
    <Card className="category-protocol-card" styles={{ body: { padding: 0 } }}>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={dataSource}
        pagination={compact ? false : { pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 1170 }}
        size="middle"
      />
    </Card>
  );
}

function ProtocolAthlete({
  athlete,
  winner,
  reverse = false,
}: {
  athlete?: Athlete | null;
  winner: boolean;
  reverse?: boolean;
}) {
  if (!athlete) {
    return <span className="text-slate-500">Chờ xác định</span>;
  }

  const content = <>
    <CountryFlag country={athlete.country} />
    <span><strong>{athlete.fullName}</strong><small>{athlete.federation?.name || athlete.country?.name || '—'}</small></span>
    {winner && <Crown className="h-3.5 w-3.5 shrink-0" />}
  </>;
  const className = cn('protocol-athlete', reverse && 'is-reverse', winner && 'is-winner');
  return athlete.isTeam ? <div className={className}>{content}</div> : <Link href={`/athletes/${athlete.id}`} className={className}>{content}</Link>;
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span className={cn('standing-rank', rank <= 3 && `is-rank-${rank}`)}>
      {rank === 1 ? <Crown className="h-4 w-4" /> : rank}
    </span>
  );
}

function CountryFlag({ country }: { country?: Country | null }) {
  if (country?.flagUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={country.flagUrl} alt={country.code || ''} className="bracket-country-flag" />
    );
  }

  return <span className="bracket-country-fallback">{country?.code?.slice(0, 2) || '—'}</span>;
}

function CategorySkeleton() {
  return (
    <div className="space-y-6">
      <Card className="category-empty-card">
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
      <Card className="category-empty-card">
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    </div>
  );
}
