'use client';

import { ToastNotice } from '@/components/ToastNotice';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import useSWR, { useSWRConfig } from 'swr';
import { Button, Card, Empty, InputNumber, Modal, Select, Space, Tag } from 'antd';
import { api, fetcher } from '@/lib/api';
import type { BracketDraw } from '@/components/brackets/SportdataBracket';
import { useSportDataToast } from '@/hooks/useSportDataToast';

const SportdataBracket = dynamic(() => import('@/components/brackets/SportdataBracket').then((module) => module.SportdataBracket), { ssr: false });

type Pair = { entry1Id: string; entry2Id: string };
type Configuration = {
  pairs: Pair[];
  revision: number;
  seedingMode: string;
  groupCount?: number;
  name?: string;
  stale: boolean;
  previewedAt?: string;
  preview: BracketDraw[];
};

type Props = {
  event: any;
  categoryId: string;
  drawType: 'MAIN_TREE' | 'DOUBLE_ELIMINATION' | 'REPECHAGE' | 'REPECHAGE_ROUND_OF_16' | 'ROUND_ROBIN_POOL';
  actorId: string;
  entries: any[];
  name?: string;
  onSeedingMode: (mode: string) => void;
  onGroupCount: (count: number) => void;
  onBusy: (busy: boolean) => void;
};

export function DrawPreconfiguration({ event, categoryId, drawType, actorId, entries, name, onSeedingMode, onGroupCount, onBusy }: Props) {
  const toast = useSportDataToast();
  const { mutate: mutateGlobal } = useSWRConfig();
  const base = `/matches/event/${event.id}/category/${categoryId}`;
  const { data, error, isLoading, mutate } = useSWR<Configuration>(
    [`${base}/preconfiguration?drawType=${drawType}`, actorId], ([url]) => fetcher(url),
  );
  const [pairs, setPairs] = useState<Pair[]>([]);
  const syncedRevision = useRef<number | null>(null);
  const [mode, setMode] = useState('STANDARD');
  const [groupCount, setGroupCount] = useState(1);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const partial = pairs.some((pair) => !pair.entry1Id || !pair.entry2Id);
  const busy = saving || previewing || isLoading || !!error;
  const minimumEntries = drawType === 'DOUBLE_ELIMINATION' ? 4 : 2;
  const isRepechage = drawType === 'REPECHAGE' || drawType === 'REPECHAGE_ROUND_OF_16';
  const usesRoundRobin = drawType === 'ROUND_ROBIN_POOL' || (isRepechage && entries.length < 6);
  const stale = !!data && (data.stale || data.name !== name);

  useEffect(() => {
    if (!data || syncedRevision.current === data.revision) return;
    syncedRevision.current = data.revision;
    setPairs(data.pairs);
    setMode(data.seedingMode);
    onSeedingMode(data.seedingMode);
    setGroupCount(data.groupCount || 1);
    onGroupCount(data.groupCount || 1);
    setSaveError('');
  }, [data, onSeedingMode, onGroupCount]);
  useEffect(() => {
    onBusy(busy || partial || !!saveError || (!!data?.revision && stale));
    return () => onBusy(false);
  }, [busy, partial, saveError, data?.revision, stale, onBusy]);
  const rosterVersion = JSON.stringify(entries.map((entry) => [entry.id, entry.seed, entry.status, entry.updatedAt]));
  useEffect(() => { void mutate(); }, [rosterVersion, mutate]);

  const save = async (nextPairs: Pair[], nextMode = mode, nextGroupCount = groupCount) => {
    if (!data || busy) return;
    setSaving(true);
    setSaveError('');
    try {
      const response = await api.patch<Configuration>(`${base}/preconfiguration`, {
        drawType, pairs: nextPairs.filter((pair) => pair.entry1Id && pair.entry2Id),
        seedingMode: nextMode, groupCount: nextGroupCount, revision: data.revision,
      });
      // Keep unfinished selections when the same revision is revalidated.
      syncedRevision.current = response.data.revision;
      await mutate(response.data, { revalidate: false });
      setPairs(nextPairs);
      setMode(nextMode);
      onSeedingMode(nextMode);
      setGroupCount(nextGroupCount);
      onGroupCount(nextGroupCount);
    } catch (failure: any) {
      setSaveError(failure.response?.data?.message || 'Không thể lưu cặp đặt trước');
    } finally { setSaving(false); }
  };

  const reload = async () => {
    const fresh = await mutate();
    if (!fresh) return;
    syncedRevision.current = fresh.revision;
    setPairs(fresh.pairs);
    setMode(fresh.seedingMode);
    onSeedingMode(fresh.seedingMode);
    setGroupCount(fresh.groupCount || 1);
    onGroupCount(fresh.groupCount || 1);
    setSaveError('');
  };

  const changePair = (index: number, side: keyof Pair, id: string | undefined) => {
    const next = pairs.map((pair, position) => position === index ? { ...pair, [side]: id || '' } : pair);
    setPairs(next);
    if (next[index].entry1Id && next[index].entry2Id) void save(next);
    // Clearing an existing pair also removes it from the persisted configuration.
    else if (data?.pairs[index]) void save(next);
  };

  const preview = async () => {
    if (!data || busy || partial || saveError) return;
    setPreviewing(true);
    try {
      const rosterUrl = `/competitions/events/${event.id}/categories/${categoryId}/entries`;
      const currentEntries: any[] = await fetcher(rosterUrl);
      await mutateGlobal(rosterUrl, currentEntries, { revalidate: false });
      const athleteIds = currentEntries.filter((entry) => entry.status === 'VERIFIED'
        && (entry.type === 'INDIVIDUAL' && entry.athlete?.id || entry.type === 'TEAM' && entry.team?.members?.length === 2)).map((entry) => entry.athlete?.id || entry.team.id);
      const response = await api.post<Configuration>(`${base}/preview-draw`, {
        type: drawType, athleteIds,
        seedingMode: mode, groupCount: isRepechage ? 1 : groupCount, revision: data.revision, name,
        fops: event.fops?.length ? event.fops.map((fop: any) => fop.name) : undefined,
      });
      await mutate(response.data, { revalidate: false });
      setPreviewOpen(true);
      toast.success('Đã lưu phương án preview. Sinh nhánh sẽ sử dụng đúng phương án này.');
    } catch (failure: any) {
      toast.error(failure.response?.data?.message || 'Không thể preview cây đấu');
    } finally { setPreviewing(false); }
  };

  const openHistory = async () => {
    setHistoryLoading(true);
    try { setHistory(await fetcher(`${base}/preconfiguration/history?drawType=${drawType}`)); }
    catch (failure: any) { toast.error(failure.response?.data?.message || 'Không thể tải lịch sử'); }
    finally { setHistoryLoading(false); }
  };

  const entryOptions = (index: number, side: keyof Pair) => {
    const used = new Set(pairs.flatMap((pair, position) => position === index
      ? [pair[side === 'entry1Id' ? 'entry2Id' : 'entry1Id']] : [pair.entry1Id, pair.entry2Id]));
    return entries.map((entry) => ({ value: entry.id, disabled: used.has(entry.id),
      label: `${entry.athlete?.fullName || entry.team?.members?.map((member: any) => member.athlete.fullName).join(' / ')} · ${entry.athlete?.federation?.name || entry.country?.code || 'VĐV tự do'}` }));
  };

  return (
    <Card title="Pre-matches · Cặp đặt trước" loading={isLoading} extra={<Tag color={saving ? 'processing' : saveError ? 'error' : 'success'}>{saving ? 'Đang lưu…' : saveError ? 'Lưu thất bại' : partial ? 'Chọn đủ hai VĐV để lưu' : 'Đã lưu'}</Tag>}>
      {error && <ToastNotice type="error" className="mb-4" message="Không thể tải cấu hình" action={<Button onClick={() => void reload()}>Tải lại</Button>} />}
      {saveError && <ToastNotice type="error" className="mb-4" message={saveError} action={<Space><Button onClick={() => void save(pairs)}>Thử lưu lại</Button><Button onClick={() => void reload()}>Tải lại</Button></Space>} />}
      <p className="mb-4 text-sm text-slate-500">Cặp đặt trước ưu tiên hơn hạt giống, CLB và quốc gia. Chọn đủ hai VĐV hoặc xóa cặp để tự lưu. {usesRoundRobin ? 'Cặp áp dụng ở lượt đầu, hai VĐV được xếp vào cùng bảng.' : 'Cặp áp dụng ở vòng đầu nhánh chính.'}</p>
      <div className={`mb-4 grid items-center gap-4 ${drawType === 'ROUND_ROBIN_POOL' ? 'max-w-2xl sm:grid-cols-[180px_minmax(0,1fr)]' : 'max-w-sm'}`}>
        {drawType === 'ROUND_ROBIN_POOL' && <div className="min-w-0">
          <InputNumber rootClassName="!w-full" className="!w-full min-w-0" aria-label="Số bảng" min={1} max={Math.max(1, Math.min(16, Math.floor(entries.length / 2)))} value={groupCount} disabled={busy || partial} addonBefore="Số bảng" onChange={(value) => { const next = value || 1; setGroupCount(next); void save(pairs, mode, next); }} />
        </div>}
        <Select className="!w-full min-w-0" aria-label="Cách xếp hạt giống" value={mode} disabled={busy || partial} onChange={(value) => { setMode(value); void save(pairs, value); }} options={[
          { value: 'STANDARD', label: 'Xếp hạt giống chuẩn' }, { value: 'ORDERED', label: 'Theo thứ tự' },
          { value: 'RANDOM', label: 'Ngẫu nhiên' }, { value: 'COUNTRY_SEPARATED', label: 'Tách quốc gia' },
          { value: 'FEDERATION_SEPARATED', label: 'Tách đơn vị / CLB' },
        ]} />
      </div>
      <div className="space-y-3">
        {pairs.map((pair, index) => <div key={index} className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
          <Select aria-label={`VĐV thứ nhất cặp ${index + 1}`} showSearch allowClear optionFilterProp="label" placeholder="VĐV thứ nhất" className="!w-full min-w-0" value={pair.entry1Id || undefined} disabled={busy} options={entryOptions(index, 'entry1Id')} onChange={(id) => changePair(index, 'entry1Id', id)} />
          <span aria-hidden="true" className="hidden md:block">–</span>
          <Select aria-label={`VĐV thứ hai cặp ${index + 1}`} showSearch allowClear optionFilterProp="label" placeholder="VĐV thứ hai" className="!w-full min-w-0" value={pair.entry2Id || undefined} disabled={busy} options={entryOptions(index, 'entry2Id')} onChange={(id) => changePair(index, 'entry2Id', id)} />
          <Button className="justify-self-start" danger disabled={busy} onClick={() => { const next = pairs.filter((_, position) => position !== index); setPairs(next); void save(next); }}>Xóa cặp</Button>
        </div>)}
      </div>
      <Space wrap className="mt-4">
        <Button disabled={busy || partial || !!saveError || !data} onClick={() => setPairs([...pairs, { entry1Id: '', entry2Id: '' }])}>Thêm cặp</Button>
        <Button loading={previewing} disabled={busy || partial || !!saveError || !data || entries.length < minimumEntries} onClick={() => void preview()}>Preview cây đấu</Button>
        {!!data?.preview.length && !stale && <Button onClick={() => setPreviewOpen(true)}>Xem phương án đã lưu</Button>}
        <Button loading={historyLoading} onClick={() => void openHistory()}>Lịch sử thay đổi</Button>
      </Space>
      {data && <ToastNotice className="!mt-4" showIcon type={stale ? 'warning' : 'success'} message={stale ? 'Cần preview lại trước khi sinh nhánh.' : `Phương án đã lưu · phiên bản ${data.revision}`} />}
      <Modal open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={null} width="95vw" title="Preview cây đấu">
        {data?.preview.length ? data.preview.map((draw) => <SportdataBracket key={draw.id} draw={draw} sourceMatches={data.preview.flatMap((item) => item.matches)} />) : <Empty description="Dữ liệu đã thay đổi. Hãy preview lại." />}
      </Modal>
      <Modal open={history !== null} onCancel={() => setHistory(null)} footer={null} width={850} title="Lịch sử cấu hình & preview">
        {history?.length ? history.map((item) => <details key={item.id} className="mb-3 rounded border border-slate-300/20 p-3">
          <summary className="cursor-pointer">{new Date(item.createdAt).toLocaleString('vi-VN')} · {item.action} · phiên bản {item.revision} · {item.actorUserId}</summary>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(item.snapshot, null, 2)}</pre>
        </details>) : <Empty description="Chưa có thay đổi" />}
      </Modal>
    </Card>
  );
}
