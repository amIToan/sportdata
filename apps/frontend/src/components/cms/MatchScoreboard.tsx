'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import useSWR, { useSWRConfig } from 'swr';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { api, fetcher, getAuthToken } from '@/lib/api';
import { getScoreboardResultSelection, isScoreboardTerminal, type ManualWinnerSelection } from '@/lib/scoreboard-result';
import { getScoreboardShortcut, resolveScoreboardShortcut, type ScoreboardControlCommand, type ScoreboardShortcut } from '@/lib/scoreboard-controls';
import { formatScoreboardTime as timeLabel, SCOREBOARD_REVIEW_AWARDS, type ScoreboardAward, type ScoreboardVideoReview } from '@/lib/scoreboard-history';
import { scoreboardRound, scoreboardWeight, type ScoreboardCategory } from '@/lib/scoreboard-display';
import { AUXILIARY_TIMER_AWARDS, auxiliaryTimerRemaining, medicalTimerSide, recentAuxiliaryTimerMode, type ScoreboardAuxiliaryTimers } from '@/lib/scoreboard-timers';
import styles from './MatchScoreboard.module.css';
import { ScoreboardAthleteRow } from './ScoreboardAthleteRow';

type Athlete = { id: string; fullName: string; photoUrl?: string | null; country?: { code: string; name: string } | null; federation?: { name: string } | null };
type MatchDetails = { categoryId?: string; category?: ScoreboardCategory; fopRecord?: { name: string } | null; athlete1?: Athlete | null; athlete2?: Athlete | null };
type Board = {
  id: string; eventId: string; matchNumber?: number; status: string; resultStatus: string; resultVersion: number;
  categoryId?: string; category: ScoreboardCategory; event: { name: string };
  matchType?: string; round?: number | null;
  fop?: string; athlete1Id: string; athlete2Id: string; winnerId?: string; winMethod?: string;
  proposedWinnerId?: string | null; proposedWinMethod?: string | null; outcomeReason?: string | null;
  athlete1Score: number; athlete2Score: number; athlete1Advantages: number; athlete2Advantages: number;
  athlete1Penalties: number; athlete2Penalties: number;
  videoReview?: ScoreboardVideoReview;
  resultData?: { scoreboard?: { remainingMs: number; runningSince: string | null; actions: ScoreboardAward[]; auxiliaryTimers?: ScoreboardAuxiliaryTimers } };
  serverNow: string; receivedAt: number; blockedReason?: string;
};
const methods = [ ['POINTS', 'Điểm'], ['SUBMISSION', 'Submission'], ['DECISION', 'Quyết định trọng tài'], ['DISQUALIFICATION', 'Truất quyền'], ['IPPON', 'Ippon'], ['KNOCKOUT', 'Knockout'], ['TECHNICAL', 'Kỹ thuật'], ['WALKOVVER', 'Bỏ cuộc / y tế'] ];
const stampBoard = (board: Board): Board => ({ ...board, receivedAt: Date.now() });
const boardFetcher = async (url: string): Promise<Board> => stampBoard((await api.get<Board>(url, { timeout: 10000 })).data);
const boardRefreshInterval = (current?: Board) => {
  const timers = current?.resultData?.scoreboard?.auxiliaryTimers;
  return timers && ([1, 2] as const).some((side) => timers[side].stall.runningSince || timers[side].medical.runningSince) ? 500 : 2000;
};

export function MatchScoreboard({ matchId }: { matchId: string }) {
  const root = useRef<HTMLDivElement>(null);
  const winnerSelect = useRef<HTMLSelectElement>(null);
  const busyRef = useRef(false);
  const { mutate: refreshCache } = useSWRConfig();
  const endpoint = `/results/matches/${matchId}/scoreboard`;
  const { data: board, error: loadError, mutate } = useSWR<Board>(endpoint, boardFetcher, { refreshInterval: boardRefreshInterval, dedupingInterval: 500 });
  const { data: details } = useSWR<MatchDetails>(`/matches/${matchId}`, fetcher);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [manualWinner, setManualWinner] = useState<ManualWinnerSelection | null>(null);
  const [clientId, setClientId] = useState('');
  const [leaseState, setLeaseState] = useState<'claiming' | 'owned' | 'blocked'>('claiming');
  const [leaseMessage, setLeaseMessage] = useState('Đang kiểm tra quyền điều khiển bảng điểm…');
  const [leaseAttempt, setLeaseAttempt] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!confirming) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = root.current?.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), a[href]') || []);
    winnerSelect.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) setConfirming(false);
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [confirming]);
  const clock = board?.resultData?.scoreboard;
  const serverNow = board ? now + Date.parse(board.serverNow) - board.receivedAt : now;
  const remaining = Math.max(0, (clock?.remainingMs ?? (board?.category.matchDurationSeconds || 300) * 1000) - (clock?.runningSince ? serverNow - Date.parse(clock.runningSince) : 0));
  const running = Boolean(clock?.runningSince && remaining > 0);
  const live = board?.status === 'RUNNING' && board?.resultStatus === 'DRAFT';
  const canControl = board?.resultStatus === 'DRAFT' && (board.status === 'SCHEDULED' || board.status === 'RUNNING');
  const actions = useMemo(() => clock?.actions || [], [clock?.actions]);
  const review = board?.videoReview || { cards: { 1: true, 2: true }, pendingSide: null };
  const reviewPending = Boolean(review.pendingSide);
  const medicalSide = medicalTimerSide(clock?.auxiliaryTimers);
  const medicalPending = Boolean(medicalSide);
  const medicalRemaining = useMemo<[number, number]>(() => [auxiliaryTimerRemaining(clock?.auxiliaryTimers?.[1].medical, serverNow, 120000), auxiliaryTimerRemaining(clock?.auxiliaryTimers?.[2].medical, serverNow, 120000)], [clock?.auxiliaryTimers, serverNow]);
  const terminal = isScoreboardTerminal(board);
  const canConfirmResult = terminal || remaining === 0;
  const hasTime = remaining > 0;
  const hasActions = actions.some((action) => !action.undone && !SCOREBOARD_REVIEW_AWARDS.includes(action.award) && !AUXILIARY_TIMER_AWARDS.includes(action.award));
  const hasReviewActions = actions.some((action) => !action.undone && SCOREBOARD_REVIEW_AWARDS.includes(action.award));
  const hasMedicalDecision = actions.some((action) => !action.undone && ['MEDICAL_FIT', 'MEDICAL_UNFIT'].includes(action.award));
  const timerModes = useMemo(() => ([1, 2] as const).map((side) => recentAuxiliaryTimerMode(actions, side)), [actions]);
  const athletes = [
    details?.athlete1?.id === board?.athlete1Id ? details?.athlete1 : undefined,
    details?.athlete2?.id === board?.athlete2Id ? details?.athlete2 : undefined,
  ];
  const { winnerId, winMethod, automatic: automaticWinner } = getScoreboardResultSelection(board, manualWinner);
  const winnerNameReady = athletes.some((athlete) => athlete?.id === winnerId && Boolean(athlete.fullName));
  const returnTo = board ? `/cms/events/${board.eventId}?tab=matches` : '/cms/events';
  const historyUrl = `/cms/matches/${matchId}/edit?returnTo=${encodeURIComponent(returnTo)}#scoreboard-history`;

  useEffect(() => {
    setClientId(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}-${Math.random()}`);
  }, []);

  useEffect(() => {
    if (!board?.id || !canControl || !clientId) return;
    let active = true;
    const leaseUrl = `/results/matches/${board.id}/scoreboard`;
    setLeaseState('claiming');
    setLeaseMessage('Đang kiểm tra quyền điều khiển bảng điểm…');
    api.post(`${leaseUrl}/claim`, { clientId }).then(() => {
      if (active) setLeaseState('owned');
    }).catch((err: any) => {
      if (!active) return;
      setLeaseState('blocked');
      setLeaseMessage(err.response?.data?.message || 'Bảng điểm đang được điều khiển ở tab hoặc thiết bị khác. Bạn chỉ có thể xem.');
    });
    const heartbeat = window.setInterval(() => {
      api.post(`${leaseUrl}/heartbeat`, { clientId }).catch((err: any) => {
        if (!active) return;
        setLeaseState('blocked');
        setLeaseMessage(err.response?.data?.message || 'Mất quyền điều khiển bảng điểm. Các thao tác đã bị khóa.');
      });
    }, 5000);
    const releaseOnClose = () => {
      const token = getAuthToken();
      if (!token) return;
      void fetch(`/api${leaseUrl}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientId }),
        keepalive: true,
      });
    };
    window.addEventListener('pagehide', releaseOnClose);
    return () => {
      active = false;
      window.clearInterval(heartbeat);
      window.removeEventListener('pagehide', releaseOnClose);
    };
  }, [board?.id, board?.status, canControl, clientId, leaseAttempt]);

  useEffect(() => {
    if (!live || !canConfirmResult || running || reviewPending || medicalPending) { setConfirming(false); return; }
    if (!terminal) return;
    setConfirming(true);
  }, [live, canConfirmResult, running, terminal, reviewPending, medicalPending, board?.proposedWinnerId, board?.proposedWinMethod]);

  const command = useCallback(async (input: ScoreboardControlCommand) => {
    if (!board || !canControl || busyRef.current || loadError) return false;
    if (leaseState !== 'owned' || !clientId) { setError('Tab này không giữ quyền điều khiển bảng điểm.'); return false; }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await api.post<Board>(endpoint, { ...input, expectedVersion: board.resultVersion, clientId }, { timeout: 10000 });
      await mutate(stampBoard(response.data), { revalidate: false });
      if (input.action === 'FINISH' || input.action === 'START') {
        await refreshCache((key) => typeof key === 'string' && (key.startsWith('/matches') || key.startsWith('/events/') || key.startsWith('/results/matches/') && key !== endpoint)).catch(() => undefined);
      }
      return true;
    } catch (err: any) {
      const message = err.response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : message || 'Chưa xác nhận được thao tác. Kiểm tra bảng điểm sau khi tải lại trước khi thử lại.');
      await mutate().catch(() => undefined);
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  }, [board, canControl, clientId, loadError, leaseState, endpoint, mutate, refreshCache]);

  const fullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch { setError('Trình duyệt không hỗ trợ toàn màn hình. Bạn có thể dùng phím F11.'); }
  }, []);

  const openResultConfirmation = useCallback(() => {
    setManualWinner(null);
    setConfirming(true);
  }, []);

  const runShortcut = useCallback((shortcut: ScoreboardShortcut) => {
    if (!board) return;
    const resolved = resolveScoreboardShortcut(shortcut, {
      status: board.status,
      editable: canControl && !busyRef.current && !loadError && leaseState === 'owned',
      modalOpen: confirming,
      blocked: Boolean(board.blockedReason),
      runningSince: Boolean(clock?.runningSince),
      hasTime,
      terminal,
      canConfirmResult,
      hasActions,
      penalties: [board.athlete1Penalties, board.athlete2Penalties],
      review: board.videoReview,
      hasReviewActions,
      medicalSide,
      medicalRemaining,
      medicalRunning: medicalSide ? Boolean(clock?.auxiliaryTimers?.[medicalSide].medical.runningSince) : false,
      stallActive: [Boolean(clock?.auxiliaryTimers?.[1].stall.active), Boolean(clock?.auxiliaryTimers?.[2].stall.active)],
      hasMedicalDecision,
    });
    if (!resolved) return;
    if (resolved.type === 'fullscreen') void fullscreen();
    else if (resolved.type === 'history') window.open(historyUrl, '_blank', 'noopener,noreferrer');
    else if (resolved.type === 'confirm') openResultConfirmation();
    else if (resolved.type === 'command') void command(resolved.command);
  }, [board, canControl, loadError, leaseState, confirming, clock?.runningSince, clock?.auxiliaryTimers, hasTime, terminal, canConfirmResult, hasActions, hasReviewActions, medicalSide, medicalRemaining, hasMedicalDecision, fullscreen, historyUrl, openResultConfirmation, command]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (confirming || event.isComposing || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]'))) return;
      const shortcut = getScoreboardShortcut(event);
      if (!shortcut) return;
      event.preventDefault();
      if (!event.repeat) runShortcut(shortcut);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirming, runShortcut]);

  if (!board) return <div className={styles.loading}><p>{loadError ? 'Không thể mở bảng điểm hoặc bạn chưa có quyền chấm điểm.' : 'Đang tải bảng điểm…'}</p><button onClick={() => mutate()}>Thử lại</button><Link href="/cms/events">Quay lại</Link></div>;
  const disabled = !canControl || busy || Boolean(loadError) || leaseState !== 'owned';
  const leaseBlocked = canControl && leaseState === 'blocked';
  const noticeMessage = error || (loadError
    ? 'Mất kết nối. Không thể cập nhật bảng điểm; đang hiển thị dữ liệu đã lưu.'
    : canControl ? board.blockedReason || (leaseState !== 'owned' ? leaseMessage : '') : '');
  const category = details?.category && details.categoryId === board.categoryId ? details.category : board.category;
  const tatami = details?.fopRecord?.name || board.fop || 'Chưa xếp thảm';
  return (
    <div ref={root} data-scoreboard className={styles.board} aria-label={`Bảng điểm trận ${board.matchNumber || '—'} · ${tatami}`} onContextMenu={(event) => {
      if (confirming || !canControl || leaseState !== 'owned' || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      event.preventDefault();
      if (event.button === 2 || (event.button === 0 && event.ctrlKey)) runShortcut({ type: 'command', command: { action: 'UNDO' } });
    }}>
      {noticeMessage && <div role="alert" className={styles.notice}>{noticeMessage}<button aria-label={leaseBlocked ? 'Thử lấy quyền điều khiển lại' : 'Tải lại'} onClick={() => { void mutate(); if (leaseBlocked) setLeaseAttempt((attempt) => attempt + 1); }}><RefreshCw size={16} /></button></div>}
      {([1, 2] as const).map((side) => <ScoreboardAthleteRow
        key={side}
        side={side}
        athleteId={athletes[side - 1]?.id}
        athleteName={athletes[side - 1]?.fullName || 'Chờ xác định'}
        athletePhotoUrl={athletes[side - 1]?.photoUrl}
        athleteUnit={athletes[side - 1]?.federation?.name || athletes[side - 1]?.country?.name || '—'}
        score={board.status === 'FINISHED'
          ? board.winMethod === 'DISQUALIFICATION' && board.winnerId === board[`athlete${side}Id`] ? 50 : board[`athlete${side}Score`]
          : board[`athlete${side === 1 ? 2 : 1}Penalties`] >= 4 ? 50 : board[`athlete${side}Score`]}
        penalties={board[`athlete${side}Penalties`]}
        advantages={board[`athlete${side}Advantages`]}
        hasReviewCard={review.cards[side]}
        reviewPending={review.pendingSide === side}
        timers={clock?.auxiliaryTimers?.[side]}
        timerMode={timerModes[side - 1]}
        now={serverNow}
      />)}
      {review.pendingSide && <div className={styles.reviewStatus} role="status">VR {review.pendingSide === 1 ? 'ĐỎ' : 'XANH'} · ĐANG XEM LẠI · C: ĐÚNG / TRẢ THẺ · X: SAI / THU THẺ</div>}
      {medicalSide && <div className={styles.reviewStatus} role="status">Y TẾ {medicalSide === 1 ? 'ĐỎ' : 'XANH'} · {medicalRemaining[medicalSide - 1] === 0 ? 'HẾT THỜI GIAN · ' : ''}CHỜ BÁC SĨ/TRỌNG TÀI · G: TIẾP TỤC · SHIFT+G: KHÔNG THỂ TIẾP TỤC</div>}
      <footer className={styles.footer}>
        <div className={styles.tatami} title={tatami}>{tatami}</div>
        <div className={styles.brand}>
          <Image src="/images/grappling-vietnam-academy.jpg" alt="Grappling Vietnam Academy" width={2048} height={2048} sizes="18vw" className={styles.brandLogo} />
        </div>
        <div className={styles.clock} role="timer" aria-label="Thời gian còn lại">{timeLabel(remaining).replace(/^0(?=\d:)/, '')}</div>
        <div className={styles.matchDetails}>
          <p title={category.name}>{category.name}</p>
          <p>{scoreboardWeight(category)} | {scoreboardRound(board)}</p>
        </div>
      </footer>
      {confirming && live && canConfirmResult && !reviewPending && !medicalPending && <div className={styles.overlay}><section role="dialog" aria-modal="true" aria-labelledby="result-title" className={`${styles.dialog} ${styles.resultDialog}`}>
        <h2 id="result-title">Xác nhận kết quả trận đấu</h2><p>{athletes[0]?.fullName}: <b>{board.athlete1Score}</b> — {athletes[1]?.fullName}: <b>{board.athlete2Score}</b></p>
        {board.outcomeReason && <p><b>{athletes[board.proposedWinnerId === board.athlete1Id ? 0 : 1]?.fullName}</b> thắng theo bảng điểm: {board.outcomeReason}.</p>}
        <label className={styles.winnerField}>Vận động viên thắng
          <div className={styles.selectField}>
            <select ref={winnerSelect} aria-label="Vận động viên thắng" value={winnerId} onChange={(event) => { if (!automaticWinner) setManualWinner({ boardId: board.id, resultVersion: board.resultVersion, athleteId: event.target.value }); }}>
              <option value="" disabled={automaticWinner}>Chọn theo quyết định trọng tài</option>
              {([1, 2] as const).map((side) => <option key={side} value={board[`athlete${side}Id`]} disabled={automaticWinner && board[`athlete${side}Id`] !== winnerId}>{athletes[side - 1]?.fullName || `${side === 1 ? 'Đỏ' : 'Xanh'} · Đang tải tên VĐV…`}</option>)}
            </select>
            <ChevronDown className={styles.selectArrow} aria-hidden="true" />
          </div>
        </label>
        <label className={styles.methodField}>Phương thức thắng
          <div className={styles.selectField}>
            <select aria-label="Phương thức thắng" value={winMethod} disabled>{methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <ChevronDown className={styles.selectArrow} aria-hidden="true" />
          </div>
        </label>
        <p>Kết quả được lưu và VĐV được điền vào nhánh đấu đã cấu hình. Trận kế tiếp cần được bắt đầu thủ công.</p>
        {error && <p role="alert" className={styles.dialogError}>{error}</p>}
        <div className={styles.dialogButtons}><button disabled={busy} onClick={() => setConfirming(false)}>Quay lại</button><button className={styles.primary} disabled={disabled || !winnerId || !winnerNameReady || running} onClick={async () => { if (await command({ action: 'FINISH', winnerId, winMethod })) setConfirming(false); }}>Xác nhận & lưu kết quả</button></div>
      </section></div>}
    </div>
  );
}
