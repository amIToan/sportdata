'use client';

import useSWR from 'swr';
import { Spin, Button } from 'antd';
import { fetcher } from '@/lib/api';
import { PairMatchResult } from '@/components/cms/PairMatchResult';
import { useParams } from 'next/navigation';
import { MatchScoreboard } from '@/components/cms/MatchScoreboard';

export default function ScoreboardPage() {
  const { id } = useParams<{ id: string }>();
  const { data: match, isLoading } = useSWR<{ team1Id?: string | null; team2Id?: string | null; eventId: string }>(`/matches/${id}`, fetcher);
  if (isLoading) return <Spin />;
  if (match?.team1Id || match?.team2Id) return <div className="mx-auto max-w-4xl space-y-5 p-5"><Button href={`/cms/events/${match.eventId}?tab=matches`}>Quay lại lịch thi đấu</Button><PairMatchResult matchId={id} /></div>;
  return <MatchScoreboard matchId={id} />;
}
