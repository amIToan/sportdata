'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Button, Card, Input, InputNumber, Select, Spin, Tag } from 'antd';
import { api, fetcher } from '@/lib/api';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { RESULT_STATUS_META } from '@/lib/vi-labels';

type PairTeam = { id: string; name: string; members?: { athlete: { fullName: string } }[] };
type PairResult = { resultVersion: number; resultStatus: string; athlete1Score: number; athlete2Score: number; winnerTeamId?: string | null };
const teamName = (team?: PairTeam | null) => team?.members?.map((member) => member.athlete.fullName).join(' / ') || team?.name || 'Chờ xác định cặp';

export function PairMatchResult({ matchId }: { matchId: string }) {
  const toast = useSportDataToast();
  const { data: match } = useSWR<{ team1?: PairTeam | null; team2?: PairTeam | null }>(`/matches/${matchId}`, fetcher);
  const { data: result, mutate } = useSWR<PairResult>(`/results/matches/${matchId}`, fetcher, { refreshInterval: 5000 });
  const { data: user } = useSWR<{ role: string }>('/auth/profile', fetcher);
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [winner, setWinner] = useState<string>();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!result) return;
    setScores([result.athlete1Score, result.athlete2Score]);
    setWinner(result.winnerTeamId || undefined);
  }, [result, matchId]);
  const canEdit = ['ADMIN', 'GAMES_ADMIN'].includes(user?.role || '');
  const editable = result && ['DRAFT', 'ENTERED', 'REFEREE_CONFIRMED'].includes(result.resultStatus);
  const save = async (action: string) => {
    if (!result) return;
    if (action === 'enter' && (!winner || result.resultVersion > 0 && !reason.trim())) {
      toast.error(!winner ? 'Chọn cặp thắng trước khi lưu.' : 'Nhập lý do cập nhật kết quả.'); return;
    }
    setSaving(true);
    try {
      await api.post(`/results/matches/${matchId}/${action}`, { expectedVersion: result.resultVersion, reason: reason.trim() || undefined,
        ...(action === 'enter' ? { athlete1Score: scores[0], athlete2Score: scores[1], winnerTeamId: winner, winMethod: 'POINTS' } : {}) });
      await mutate();
      toast.success('Đã cập nhật kết quả cặp thi đấu.');
    } catch (error: any) { toast.error(error.response?.data?.message || 'Không thể cập nhật kết quả.'); }
    finally { setSaving(false); }
  };
  const next = ({ ENTERED: ['referee-confirm', 'Trọng tài xác nhận'], REFEREE_CONFIRMED: ['approve', 'Phê duyệt kết quả'],
    APPROVED: ['publish', 'Công bố kết quả'], PUBLISHED: ['lock', 'Khóa kết quả'] } as Record<string, string[]>)[result?.resultStatus || ''];
  return <Card title="Kết quả DUO / SHOW" className="mb-5" extra={result && <Tag color={RESULT_STATUS_META[result.resultStatus]?.color}>{RESULT_STATUS_META[result.resultStatus]?.label || result.resultStatus}</Tag>}>
    {!match || !result ? <Spin /> : <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">{[match.team1, match.team2].map((team, index) => <div key={index} className="rounded-xl border border-sky-200 bg-sky-50 p-4">
        <div className="mb-3 font-semibold text-sky-950">{teamName(team)}</div>
        <label className="mb-2 block text-sm">Điểm cặp {index + 1}</label>
        <InputNumber className="!w-full" size="large" min={0} precision={2} value={scores[index]} disabled={!canEdit || !editable || saving}
          onChange={(value) => setScores((current) => index === 0 ? [value ?? 0, current[1]] : [current[0], value ?? 0])} />
      </div>)}</div>
      <div><label className="mb-2 block font-semibold">Cặp thắng</label><Select className="w-full" size="large" value={winner} disabled={!canEdit || !editable || saving}
        onChange={setWinner} placeholder="Chọn cặp thắng theo biên bản trọng tài" options={[match.team1, match.team2].filter((team): team is PairTeam => Boolean(team)).map((team) => ({ value: team.id, label: teamName(team) }))} /></div>
      {canEdit && <><Input.TextArea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Lý do / ghi chú (bắt buộc khi cập nhật kết quả đã có)" rows={2} />
        <div className="flex flex-wrap gap-2">{editable && <Button type="primary" loading={saving} disabled={!match.team1 || !match.team2} onClick={() => void save('enter')}>Lưu kết quả cặp</Button>}
          {next && <Button loading={saving} onClick={() => void save(next[0])}>{next[1]}</Button>}
          {user?.role === 'ADMIN' && ['APPROVED', 'PUBLISHED', 'LOCKED'].includes(result.resultStatus) && <Button disabled={!reason.trim()} loading={saving} onClick={() => void save('reopen')}>Mở lại để sửa</Button>}
        </div></>}
    </div>}
  </Card>;
}
