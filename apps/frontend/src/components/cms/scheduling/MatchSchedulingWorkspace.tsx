'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Alert, Button, Card, Checkbox, Empty, Input, Modal, Space, Steps, Table } from 'antd';
import { api, fetcher, getAuthUser } from '@/lib/api';
import { ScheduleOverviewGrid } from './ScheduleOverviewGrid';
import { DisciplineBlockEditor } from './DisciplineBlockEditor';
import { ScheduleWindowsEditor } from './ScheduleWindowsEditor';
import { MultiDaySchedulePreview } from './MultiDaySchedulePreview';
import { ScheduleConfig, automaticScheduleConfig, errorText, localDateTime, uid } from './schedule-ui';

export function MatchSchedulingWorkspace({ event, canEdit, canScore }: {
  event: any; canEdit: boolean; canScore: boolean;
}) {
  const base = `/scheduling/events/${event.id}`;
  const { data: overview, error, mutate } = useSWR<any>(`${base}/plans/overview`, fetcher, { refreshInterval: 5000 });
  const [active, setActive] = useState<any>();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const [deleting, setDeleting] = useState<any>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [recovery, setRecovery] = useState<any>();
  const storageKey = `schedule-draft:${getAuthUser()?.id || 'user'}:${event.id}`;
  useEffect(() => { try { setRecovery(JSON.parse(localStorage.getItem(storageKey) || 'null')); } catch { /* Ignore invalid local recovery data. */ } }, [storageKey]);
  const open = async (id: string, day?: string) => {
    setOpening(true); setOpenError('');
    try { const { data } = await api.get(`${base}/plans/${id}`); setActive({ detail: data, day, mode: 'detail' }); }
    catch (error) { setOpenError(errorText(error)); }
    finally { setOpening(false); }
  };
  const deleteDraft = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true); setDeleteError('');
    try {
      await api.delete(`${base}/plans/${deleting.id}/draft`, { data: { expectedDraftVersion: deleting.draftVersion } });
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved?.plan?.id === deleting.id) { localStorage.removeItem(storageKey); setRecovery(undefined); }
      } catch { /* Ignore invalid local recovery data. */ }
      setDeleting(undefined); await mutate();
    } catch (error) { setDeleteError(errorText(error)); void mutate(); }
    finally { setDeleteBusy(false); }
  };
  if (active) return <ScheduleWizard key={active.key || active.detail?.id || 'new'} eventId={event.id} canEdit={canEdit} canScore={canScore}
    initial={active} storageKey={storageKey} onClose={() => { setActive(undefined); void mutate(); try { setRecovery(JSON.parse(localStorage.getItem(storageKey) || 'null')); } catch { setRecovery(undefined); } }} onOpen={open} />;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Sắp xếp trận đấu</h2><p className="text-sm text-slate-500">Tổng quan ngày × thảm · các lịch thi đấu độc lập</p></div>
      <Space wrap><Button onClick={() => void mutate()}>Làm mới</Button>{canEdit && <Button type="primary" onClick={() => setActive({ mode: 'edit', key: uid() })}>Tạo lịch mới</Button>}</Space>
    </div>
    {(error || openError) && <Alert type="error" showIcon title={openError || errorText(error)} action={<Button onClick={() => void mutate()}>Thử lại</Button>} />}
    {recovery && canEdit && <Alert type="info" title="Có thay đổi chưa lưu trên thiết bị này" action={<Space><Button onClick={() => setActive({ ...recovery, mode: 'edit', key: uid() })}>Tiếp tục chỉnh</Button><Button onClick={() => { localStorage.removeItem(storageKey); setRecovery(undefined); }}>Bỏ thay đổi</Button></Space>} />}
    {!event.categories?.length && <Empty description={<span>Chưa có hạng đấu. <a href="/cms/sports">Mở quản lý môn và hạng đấu</a>.</span>} />}
    {!overview || opening ? <Card loading /> : <ScheduleOverviewGrid overview={overview} canEdit={canEdit} onOpen={open}
      onCreate={(day, fopId) => setActive({ day, fopId, chooseStart: overview.segments.some((segment: any) => segment.localDate === day && segment.fopId === fopId), mode: 'edit', key: uid() })} />}
    {!!overview?.drafts.length && <Card title="Bản nháp"><div className="space-y-3">{overview.drafts.map((draft: any) => <div key={draft.id} className="flex flex-wrap items-center justify-between gap-2">
      <div><strong>{draft.name || 'Lịch chưa đặt tên'}</strong><p className="text-sm text-slate-500">{draft.updatedBy} · {localDateTime(draft.updatedAt, overview.timezone)} · {draft.errorCount == null ? 'Cần xem trước' : `${draft.errorCount} lỗi`}</p></div>
      <Space wrap><Button onClick={() => void open(draft.id)}>{canEdit ? 'Tiếp tục chỉnh' : 'Xem lịch'}</Button>
        {canEdit && <Button danger onClick={() => { setDeleting(draft); setDeleteError(''); }}>Xoá bản nháp</Button>}</Space>
    </div>)}</div><p className="mt-3 text-sm text-slate-500">Bản nháp không chiếm thảm và chưa thay đổi lịch đang sử dụng.</p></Card>}
    <Modal open={Boolean(deleting)} title="Xoá bản nháp?" okText="Xoá bản nháp" cancelText="Giữ lại" okButtonProps={{ danger: true }}
      confirmLoading={deleteBusy} closable={!deleteBusy} maskClosable={!deleteBusy} cancelButtonProps={{ disabled: deleteBusy }}
      onCancel={() => { if (!deleteBusy) setDeleting(undefined); }} onOk={() => void deleteDraft()}>
      <p>{deleting?.appliedRevisionId ? `Bỏ các thay đổi chưa áp dụng của “${deleting.name}”. Lịch đang áp dụng và lịch sử thi đấu được giữ nguyên.`
        : `Xoá “${deleting?.name || 'Lịch chưa đặt tên'}” cùng các bản xem trước chưa áp dụng.`}</p>
      {deleteError && <Alert className="mt-3" type="error" showIcon title={deleteError} />}
    </Modal>
  </div>;
}

function ScheduleWizard({ eventId, canEdit, canScore, initial, storageKey, onClose, onOpen }: {
  eventId: string; canEdit: boolean; canScore: boolean; initial: any; storageKey: string; onClose: () => void; onOpen: (id: string) => void;
}) {
  const base = `/scheduling/events/${eventId}`;
  const { data: input, error: inputError, mutate: reloadInput } = useSWR<any>(`${base}/planner-input`, fetcher);
  const { mutate } = useSWRConfig();
  const [config, setConfig] = useState<ScheduleConfig>(() => initial.config || initial.detail?.draft || {
    schemaVersion: 1, name: 'Lịch thi đấu', timezone: 'Asia/Ho_Chi_Minh', autoContinue: true,
    windows: [{ id: uid(), localDate: initial.day || '', fopId: initial.fopId || '', startLocalTime: initial.chooseStart ? '' : '09:00', endLocalTime: '18:00', enabled: true, breaks: [] }],
    blocks: [], earliestStarts: [], matchOrders: [], pinnedStarts: [],
  });
  const [plan, setPlan] = useState<any>(initial.detail || initial.plan);
  const [customWindows, setCustomWindows] = useState<boolean>(initial.customWindows ?? Boolean(initial.config || initial.detail || initial.plan));
  const { data: latest } = useSWR<any>(plan?.id ? `${base}/plans/${plan.id}` : null, fetcher, { refreshInterval: 5000 });
  const [mode, setMode] = useState(initial.mode === 'detail' && initial.detail?.applied ? 'detail' : 'edit');
  const [step, setStep] = useState(0);
  const [proposal, setProposal] = useState<any>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(Boolean(initial.config));
  const [past, setPast] = useState<ScheduleConfig[]>([]);
  const [future, setFuture] = useState<ScheduleConfig[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [leave, setLeave] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const sequence = useRef(0);
  const createKey = useRef(initial.createKey || uid());
  const applyRequest = useRef<any>();
  const recompute = useRef<ReturnType<typeof setTimeout>>();
  const attemptedConfig = useRef<ScheduleConfig>();
  const leaveAction = useRef<() => void>(onClose);
  const releaseNavigationGuard = useRef<() => void>(() => {});
  const timezoneInitialized = useRef(Boolean(initial.config || initial.detail?.draft));
  useEffect(() => {
    if (!input || timezoneInitialized.current) return;
    timezoneInitialized.current = true;
    setConfig((current) => ({ ...current, timezone: input.fops.find((fop: any) => fop.id === current.windows[0]?.fopId)?.timezone || input.timezone }));
  }, [input]);
  const completeLeave = () => {
    releaseNavigationGuard.current(); setLeave(false); onClose();
    if (leaveAction.current !== onClose) leaveAction.current();
  };
  useEffect(() => {
    if (!dirty || mode !== 'edit') return;
    localStorage.setItem(storageKey, JSON.stringify({ config, plan, customWindows, createKey: createKey.current }));
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigation = (event: Event) => {
      event.preventDefault(); leaveAction.current = (event as CustomEvent<() => void>).detail; setLeave(true);
    };
    const linkNavigation = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0
        || anchor.origin !== location.origin || anchor.href === location.href) return;
      event.preventDefault(); event.stopPropagation(); leaveAction.current = () => location.assign(anchor.href); setLeave(true);
    };
    window.addEventListener('beforeunload', guard);
    window.addEventListener('sportdata:schedule-navigation', navigation);
    document.addEventListener('click', linkNavigation, true);
    const cleanup = () => {
      window.removeEventListener('beforeunload', guard);
      window.removeEventListener('sportdata:schedule-navigation', navigation);
      document.removeEventListener('click', linkNavigation, true);
    };
    releaseNavigationGuard.current = cleanup;
    return cleanup;
  }, [config, plan, customWindows, dirty, mode, storageKey]);
  useEffect(() => () => { sequence.current += 1; clearTimeout(recompute.current); }, []);
  const change = (next: ScheduleConfig) => {
    sequence.current += 1; setPast((items) => [...items.slice(-49), config]); setFuture([]); setConfig(next); setDirty(true);
    setProposal(undefined); setAcknowledged(false); applyRequest.current = undefined; setError('');
  };
  const undo = (redo = false) => {
    const stack = redo ? future : past; if (!stack.length) return;
    const next = stack.at(-1)!;
    if (redo) { setFuture(stack.slice(0, -1)); setPast([...past, config]); } else { setPast(stack.slice(0, -1)); setFuture([...future, config]); }
    sequence.current += 1; setConfig(next); setDirty(true); setProposal(undefined); setAcknowledged(false); applyRequest.current = undefined;
  };
  const scheduleConfig = () => customWindows || !input ? config : automaticScheduleConfig(config, input);
  const ensurePlan = async (selectedConfig: ScheduleConfig) => {
    if (plan) return plan;
    const { data } = await api.post(`${base}/plans`, { config: selectedConfig, expectedDraftVersion: 0, idempotencyKey: createKey.current });
    setPlan(data); return data;
  };
  const save = async () => {
    if (busy) return false; setBusy('save'); setError('');
    try {
      const selectedConfig = scheduleConfig();
      const current = await ensurePlan(selectedConfig);
      const { data } = await api.put(`${base}/plans/${current.id}/draft`, { config: selectedConfig, expectedDraftVersion: current.draftVersion });
      setConfig(selectedConfig); setPlan(data); setProposal(undefined); setDirty(false); localStorage.removeItem(storageKey); return true;
    } catch (error) { setError(errorText(error)); return false; } finally { setBusy(''); }
  };
  const preview = async () => {
    if (busy) return; const request = ++sequence.current; setBusy('preview'); setError(''); setProposal(undefined);
    try {
      const selectedConfig = scheduleConfig();
      const current = await ensurePlan(selectedConfig);
      const { data } = await api.post(`${base}/plans/${current.id}/preview`, { config: selectedConfig, expectedDraftVersion: current.draftVersion });
      if (sequence.current !== request) return;
      setConfig(selectedConfig); setCustomWindows(true);
      setPlan({ ...current, draftVersion: data.draftVersion, draft: selectedConfig }); setProposal(data); setStep(2); setDirty(false);
      setAcknowledged(false); applyRequest.current = undefined; localStorage.removeItem(storageKey);
    } catch (error) { if (sequence.current === request) setError(errorText(error)); }
    finally { setBusy(''); }
  };
  const apply = async () => {
    if (busy || !proposal?.canApply) return; setBusy('apply'); setError('');
    const request = applyRequest.current || { previewId: proposal.previewId, draftVersion: proposal.draftVersion,
      expectedAppliedRevision: proposal.expectedAppliedRevision, idempotencyKey: uid(), acknowledgeWarnings: acknowledged };
    applyRequest.current = request;
    try {
      await api.post(`${base}/plans/${plan.id}/apply`, request);
      localStorage.removeItem(storageKey);
      await mutate((key) => typeof key === 'string' && (key.includes(eventId) || key.startsWith('/matches?')));
      onClose();
    } catch (error: any) { setError(errorText(error)); if (error.response?.status === 409) { setConfirm(false); setProposal(undefined); } }
    finally { setBusy(''); }
  };
  const refreshSetting = async (work: () => Promise<unknown>) => {
    if (busy) return; setBusy('settings'); setError('');
    try { await work(); await reloadInput(); sequence.current += 1; setProposal(undefined); }
    catch (error) { setError(errorText(error)); } finally { setBusy(''); }
  };
  useEffect(() => {
    if (step !== 2 || !dirty || busy || !canEdit || attemptedConfig.current === config) return;
    recompute.current = setTimeout(() => { attemptedConfig.current = config; void preview(); }, 500);
    return () => clearTimeout(recompute.current);
    // Preview always receives the current complete config; requests are sequence-guarded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, step, dirty, busy, canEdit]);
  const first = config.windows[0];
  const availableWindows = scheduleConfig().windows.filter((window) => window.enabled);
  const nextEnabled = Boolean(config.name.trim() && first?.localDate && first?.fopId && config.blocks.length
    && config.blocks.every((block) => block.categoryIds.length));
  const liveApplied = latest?.applied || initial.detail?.applied;
  const hasDraft = (latest || initial.detail)?.hasDraft;
  const displayedConfig = mode === 'detail' ? liveApplied.config : config;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{mode === 'detail' ? displayedConfig.name : plan ? 'Chỉnh sửa lịch thi đấu' : 'Tạo lịch thi đấu'}</h2>
      <Button disabled={Boolean(busy)} onClick={() => { leaveAction.current = onClose; if (dirty) setLeave(true); else onClose(); }}>Quay lại Tổng quan</Button></div>
    {(error || inputError) && <Alert type="error" showIcon title={error || errorText(inputError)} description="Các lựa chọn của bạn được giữ. Có thể lưu nháp hoặc tính lại lịch." />}
    {mode === 'edit' && latest && plan && (latest.draftVersion > plan.draftVersion
      || latest.appliedRevisionId !== plan.appliedRevisionId) && <Alert type="warning" title="Có cập nhật mới" description="Lịch trên máy chủ đã thay đổi. Nội dung bạn đang chỉnh được giữ; mở lại lịch để đối chiếu trước khi lưu hoặc áp dụng." />}
    {!input ? <Card loading /> : mode === 'detail' ? <>
      <Alert type="info" title="Đang xem lịch đã áp dụng" description={hasDraft ? 'Có thay đổi chưa áp dụng. Lịch công khai và bảng điểm vẫn dùng lịch đang hiển thị.' : 'Lịch này đang được dùng trên lịch công khai và bảng điểm.'} />
      {canEdit && <Button type="primary" onClick={() => {
        const detail = latest || initial.detail;
        setConfig(detail.draft); setPlan(detail); setCustomWindows(true);
        setProposal(undefined); setPast([]); setFuture([]); setStep(0); setMode('edit');
      }}>{hasDraft ? 'Tiếp tục chỉnh bản nháp' : 'Chỉnh sửa lịch'}</Button>}
      <MultiDaySchedulePreview proposal={liveApplied.proposal} config={displayedConfig} focusDay={initial.day} canEdit={false} canScore={canScore} onChange={() => {}} />
    </> : <>
      <Steps current={step} items={[{ title: 'Chọn nội dung & giờ bắt đầu' }, { title: 'Tùy chỉnh (nếu cần)' }, { title: 'Lịch tự động' }]} />
      {!canEdit && <Alert type="info" title="Bạn đang ở chế độ chỉ xem." />}
      <fieldset disabled={!canEdit || Boolean(busy)} className="min-w-0">
        {step === 0 && <div className="space-y-5"><DisciplineBlockEditor config={config} input={input} planId={plan?.id} onChange={change} onOpen={(id) => { if (!dirty) onOpen(id); else setError('Lưu nháp trước khi mở lịch khác để giữ thay đổi.'); }}
          onWeight={(id, weightKind) => void refreshSetting(() => api.patch(`/categories/${id}`, { weightKind }))} />
          <Card size="small" title="Sắp xếp tự động"><label>Giờ bắt đầu<Input aria-label="Giờ bắt đầu tự động" type="time" className="!w-40 !block" value={first?.startLocalTime || ''}
            onChange={(event) => change({ ...config, windows: config.windows.map((window, index) => index === 0 ? { ...window, startLocalTime: event.target.value } : window) })} /></label>
            <p className="mt-3">Hệ thống tự chia giờ cho toàn bộ trận đã chọn theo vòng đấu, hạng cân và quy định nghỉ của giải, đồng thời tránh lịch đang có trên thảm.</p>
            {nextEnabled && <p className="mt-2 text-sm text-slate-500">{customWindows ? 'Dùng các ngày/thảm và mốc giờ đã lưu: ' : 'Hết giờ sẽ tự chuyển sang ngày tiếp theo của giải, trên cùng thảm: '}
              {availableWindows.map((window) => `${window.localDate} (${window.startLocalTime || '…'}–${window.endLocalTime})`).join(', ')}. Có thể đổi trong phần tùy chỉnh.</p>}
          </Card></div>}
        {step === 1 && <ScheduleWindowsEditor config={config} input={input} onChange={change} onRest={(sportId, minRestMinutes) => void refreshSetting(() => api.patch(`${base}/rules/${sportId}`, { minRestMinutes }))} />}
        {step === 2 && (proposal ? <MultiDaySchedulePreview proposal={proposal} config={config} canEdit={canEdit} canScore={false} focusDay={initial.day} onChange={change} />
          : <Alert type="info" title="Bản xem trước cần được tính lại" description="Cấu hình vừa thay đổi. Tính lại toàn bộ lịch để xem ảnh hưởng trên mọi ngày." action={<Button disabled={Boolean(busy)} onClick={() => void preview()}>Tính lại lịch</Button>} />)}
      </fieldset>
      <Space wrap><Button disabled={Boolean(busy) || !past.length} onClick={() => undo()}>Hoàn tác</Button><Button disabled={Boolean(busy) || !future.length} onClick={() => undo(true)}>Làm lại</Button></Space>
      {canEdit && <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><Space><Button disabled={step === 0 || Boolean(busy)} onClick={() => setStep(step - 1)}>Quay lại</Button>
        <Button loading={busy === 'save'} disabled={Boolean(busy)} onClick={() => void save()}>Lưu nháp</Button></Space><Space>
          {step === 0 && <Button disabled={!nextEnabled || Boolean(busy)} onClick={() => { change(scheduleConfig()); setCustomWindows(true); setStep(1); }}>Tùy chỉnh lịch</Button>}
          <Button type={step < 2 ? 'primary' : 'default'} loading={busy === 'preview'} disabled={Boolean(busy) || (step === 0 && (!nextEnabled || !first?.startLocalTime))}
            onClick={() => void preview()}>{step < 2 ? 'Sắp xếp tự động' : 'Sắp xếp lại'}</Button>
          {step === 2 && <Button type="primary" disabled={!proposal?.canApply || Boolean(busy)} onClick={() => setConfirm(true)}>Áp dụng lịch</Button>}
        </Space></div>}
    </>}
    <ScheduleImpactDialog open={confirm} proposal={proposal} timezone={config.timezone} busy={busy === 'apply'} acknowledged={acknowledged}
      onAcknowledge={setAcknowledged} onCancel={() => setConfirm(false)} onApply={() => void apply()} />
    <Modal open={leave} title="Giữ thay đổi bản nháp?" onCancel={() => setLeave(false)} footer={<Space wrap>
      <Button onClick={() => setLeave(false)}>Ở lại</Button><Button danger onClick={() => { localStorage.removeItem(storageKey); setDirty(false); completeLeave(); }}>Bỏ thay đổi chưa lưu</Button>
      <Button type="primary" loading={busy === 'save'} onClick={async () => { if (await save()) completeLeave(); }}>Lưu nháp và rời</Button>
    </Space>}>Bỏ thay đổi chưa lưu không xóa lịch đã áp dụng.</Modal>
  </div>;
}

export function ScheduleImpactDialog({ open, proposal, timezone, busy, acknowledged, onAcknowledge, onCancel, onApply }: {
  open: boolean; proposal: any; timezone: string; busy: boolean; acknowledged: boolean; onAcknowledge: (value: boolean) => void; onCancel: () => void; onApply: () => void;
}) {
  const diff = proposal?.diff || [];
  const warnings = (proposal?.warningsRequiringAcknowledgement || []).filter((item: any) => item.code !== 'POTENTIAL_PARTICIPANT_CONFLICT');
  return <Modal open={open} title="Xác nhận thay đổi lịch toàn chuỗi" width={900} onCancel={onCancel} onOk={onApply} confirmLoading={busy}
    okText="Xác nhận áp dụng" cancelText="Tiếp tục chỉnh" okButtonProps={{ disabled: !proposal?.canApply || (warnings.length > 0 && !acknowledged) }}>
    <p>Thao tác này cập nhật lịch đang sử dụng trên mọi ngày liên quan và lịch công khai.</p>
    <p className="my-3">Thêm: {diff.filter((item: any) => item.kind === 'ADDED').length} · Đổi: {diff.filter((item: any) => item.kind === 'CHANGED').length} · Giữ nguyên: {diff.filter((item: any) => item.kind === 'UNCHANGED').length} · Bỏ khỏi lịch: {diff.filter((item: any) => item.kind === 'REMOVED').length}</p>
    {proposal?.diffSummary && <p className="my-3">Đổi ngày: {proposal.diffSummary.movedDay} · Đổi thảm: {proposal.diffSummary.movedFop} · Đổi giờ: {proposal.diffSummary.timeShift}<br />Ngày bị ảnh hưởng: {proposal.diffSummary.affectedDays.join(', ') || 'Không có'}</p>}
    <Table rowKey="matchId" size="small" dataSource={diff} pagination={{ pageSize: 8 }} scroll={{ x: 600 }} columns={[
      { title: 'Trận', dataIndex: 'matchId', render: (id) => `#${proposal?.matchDetails?.find((match: any) => match.id === id)?.matchNumber || id}` },
      { title: 'Trước', render: (_, row: any) => row.before ? `${localDateTime(row.before.start, timezone)} · ${proposal?.fops?.find((fop: any) => fop.id === row.before.fopId)?.name || 'Thảm đã chọn'}` : 'Chưa xếp' },
      { title: 'Sau', render: (_, row: any) => row.after ? `${localDateTime(row.after.start, timezone)} · ${proposal?.fops?.find((fop: any) => fop.id === row.after.fopId)?.name || 'Thảm đã chọn'}` : 'Bỏ khỏi lịch' },
    ]} />
    {warnings.length > 0 && <Checkbox checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)}>Tôi đã xem {warnings.length} cảnh báo VĐV chưa xác định và đồng ý áp dụng. Xác nhận được lưu trong lịch sử.</Checkbox>}
  </Modal>;
}
