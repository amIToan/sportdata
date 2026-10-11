'use client';

import { useState } from 'react';
import { Alert, Button, Collapse, Drawer, Input, InputNumber, Select, Space, Tabs, Tag } from 'antd';
import { ScheduleConfig, clearMatchStart, localDateTime, localDay, localISO, localTime, stageLabel, updateMatchStart } from './schedule-ui';

export function MultiDaySchedulePreview({ proposal, config, focusDay, canEdit, canScore, onChange }: {
  proposal: any; config: ScheduleConfig; focusDay?: string; canEdit: boolean; canScore: boolean; onChange: (config: ScheduleConfig) => void;
}) {
  const [day, setDay] = useState(focusDay);
  const [query, setQuery] = useState('');
  const [moving, setMoving] = useState<any>();
  const [ordering, setOrdering] = useState<any[]>();
  const [dismissed, setDismissed] = useState<string[]>([]);
  // Also hide this retired warning in previews restored from older local drafts.
  const violations = (proposal.violations || []).filter((item: any) => item.code !== 'POTENTIAL_PARTICIPANT_CONFLICT');
  const notificationKey = (violation: any) => JSON.stringify([proposal.previewId, violation.code, violation.message, violation.description, violation.matchIds]);
  const hidden = violations.filter((item: any) => dismissed.includes(notificationKey(item)));
  const days = [...new Set<string>(proposal.assignments.map((item: any) => item.localDate))].sort();
  const selectedDay = day && days.includes(day) ? day : days[0];
  const details = new Map<string, any>((proposal.matchDetails || []).map((match: any) => [match.id, match]));
  const visible = proposal.assignments.filter((item: any) => item.localDate === selectedDay && (!query
    || `${details.get(item.matchId)?.matchNumber} ${details.get(item.matchId)?.categoryName} ${details.get(item.matchId)?.participants?.join(' ')}`.toLowerCase().includes(query.toLowerCase())));
  const groups = new Map<string, any[]>();
  for (const item of visible) { const key = `${item.blockId}:${item.stageKey}:${item.categoryId}:${item.drawId}`; groups.set(key, [...(groups.get(key) || []), item]); }
  const completeOrder = [...proposal.assignments, ...proposal.unscheduled.map((item: any) => ({ ...details.get(item.matchId), matchId: item.matchId }))];
  const allGroup = (item: any) => completeOrder.filter((other: any) => other.categoryId === item.categoryId && other.drawId === item.drawId && other.stageKey === item.stageKey);
  const editOrder = (items: any[]) => { const full = allGroup(items[0]); setOrdering(full); };
  return <div className="space-y-4">
    <Space wrap><Tag color="blue">{proposal.assignments.length}/{proposal.totalMatches ?? proposal.assignments.length + proposal.unscheduled.length} trận đã xếp</Tag>
      <Tag color={proposal.unscheduled.length ? 'red' : 'green'}>{proposal.unscheduled.length} chưa xếp</Tag>
      <Tag>{proposal.byesExcluded?.length || 0} lượt miễn đấu</Tag>
      {proposal.assignments.length > 0 && <span>Kết thúc {localDateTime(proposal.assignments.at(-1).end, config.timezone)}</span>}
    </Space>
    {!!proposal.requestedStarts?.length && <Collapse items={[{ key: 'markers', label: 'Mốc yêu cầu và giờ xếp thực tế', children: <div className="space-y-2">
      {proposal.requestedStarts.map((marker: any, index: number) => <div key={index}>{marker.target.stageKey ? stageLabel(marker.target.stageKey, details.get(marker.matchId)?.round) : `Trận #${details.get(marker.target.matchId)?.matchNumber || marker.target.matchId}`} · Yêu cầu {localDateTime(marker.requested, config.timezone)} → {marker.actual == null ? 'Chưa xếp' : localDateTime(marker.actual, config.timezone)}</div>)}
    </div> }]} />}
    {!!proposal.idleSegments?.length && <Collapse items={[{ key: 'idle', label: 'Khoảng chờ trong lịch', children: <div className="space-y-2">
      {proposal.idleSegments.map((idle: any, index: number) => <div key={index}>{localDateTime(idle.start, config.timezone)}–{localTime(idle.end, config.timezone)} · {idle.reasons?.join('; ')}</div>)}
    </div> }]} />}
    {hidden.length > 0 && <Button size="small" onClick={() => setDismissed([])}>Hiện lại {hidden.length} thông báo đã đóng</Button>}
    {violations.filter((violation: any) => !dismissed.includes(notificationKey(violation))).map((violation: any) => <Alert key={notificationKey(violation)} showIcon
      type={violation.severity === 'ERROR' ? 'error' : violation.severity === 'INFO' ? 'info' : 'warning'}
      closable={{ 'aria-label': 'Đóng thông báo' }} onClose={() => setDismissed((items) => [...items, notificationKey(violation)])}
      title={violation.message} description={<div>{violation.description || violation.matchIds.map((id: string) => `Trận #${details.get(id)?.matchNumber || id}`).join(', ')}
        {violation.severity === 'ERROR' && <p className="mt-1">Cần xử lý lỗi trước khi áp dụng lịch. Đóng thông báo chỉ ẩn phần hiển thị.</p>}
        {canEdit && violation.code === 'PIN_CONFLICT' && violation.suggestedStart != null && violation.targetMatchId
          && !details.get(violation.targetMatchId)?.immutable && <Button className="mt-2" onClick={() => onChange(updateMatchStart(config,
            violation.targetMatchId, new Date(violation.suggestedStart).toISOString(), true))}>Dùng giờ {localDateTime(violation.suggestedStart, config.timezone)}</Button>}
      </div>} />)}
    <Input.Search aria-label="Tìm trong bản xem trước" placeholder="Tìm mã trận, hạng hoặc VĐV" value={query} onChange={(event) => setQuery(event.target.value)} allowClear />
    <Tabs activeKey={selectedDay} onChange={setDay} items={days.map((date) => ({ key: date, label: `${date} · ${proposal.assignments.filter((item: any) => item.localDate === date).length} trận` }))} />
    <Collapse items={[...groups.entries()].map(([key, items]) => { const first = items[0]; const full = allGroup(first);
      const match = details.get(first.matchId);
      const next = full.find((item: any) => item.localDate > selectedDay);
      return { key, label: <span>{config.blocks.findIndex((block) => block.id === first.blockId) + 1}. {stageLabel(first.stageKey, match?.round)} · {match?.categoryName} · {items.length}/{full.length} trận hôm nay {next && `· tiếp tục ${next.localDate}`}</span>,
        children: <div className="space-y-3">
          {canEdit && <Button disabled={Boolean(query)} onClick={() => editOrder(items)}>Đổi thứ tự toàn bộ nhóm ({full.length} trận)</Button>}
          {items.map((item: any) => { const detail = details.get(item.matchId); return <div key={item.matchId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <div><strong>STT {item.chainSequence} · Trận #{detail?.matchNumber || item.matchId}</strong><div>{localTime(item.start, config.timezone)}–{localTime(item.end, config.timezone)} · {proposal.fops?.find((fop: any) => fop.id === item.fopId)?.name || 'Thảm đã chọn'}</div>
              <div>{[...(detail?.participants || []), ...(detail?.sources || [])].join(' · ') || 'Chờ xác định VĐV'}</div></div>
            <Space wrap>{detail?.status && <Tag>{({ SCHEDULED: 'Chưa đấu', RUNNING: 'Đang thi đấu', FINISHED: 'Đã kết thúc', CANCELLED: 'Đã hủy' } as Record<string, string>)[detail.status] || detail.status}</Tag>}{detail?.immutable && <Tag color="gold">Đã đấu / đã khóa</Tag>}
              {canEdit && <><Button disabled={detail?.immutable} onClick={() => setMoving({ ...item, pin: false })}>Dời từ đây</Button><Button disabled={detail?.immutable} onClick={() => setMoving({ ...item, pin: true })}>Cố định giờ</Button></>}
              {canScore && <Button disabled={!detail?.canScore} href={detail?.canScore ? `/cms/matches/${item.matchId}/scoreboard` : undefined} target="sportdata-scoreboard">Bảng điểm</Button>}
            </Space>
          </div>; })}
          {next && <Button onClick={() => setDay(next.localDate)}>Xem phần tiếp tục · {next.localDate}</Button>}
        </div> };
    })} />
    {proposal.unscheduled.length > 0 && <Collapse items={[{ key: 'unscheduled', label: `${proposal.unscheduled.length} trận chưa xếp`, children: <div className="space-y-3">
      {proposal.unscheduled.map((item: any) => { const detail = details.get(item.matchId); return <div key={item.matchId} className="flex flex-wrap items-center justify-between gap-2">
        <span>Trận #{detail?.matchNumber || item.matchId} · {detail?.categoryName} · {stageLabel(detail?.stageKey || '', detail?.round)}</span>
        {canEdit && detail && <Button disabled={detail.immutable} onClick={() => setMoving({ ...item, pin: false,
          localDate: config.windows.find((window) => window.enabled)?.localDate, start: undefined })}>Dời từ đây</Button>}
      </div>; })}
    </div> }]} />}
    {moving && <ContinueFromMatchDrawer match={moving} config={config} onClose={() => setMoving(undefined)} onChange={(next) => { onChange(next); setMoving(undefined); }} />}
    {ordering && <MatchOrderEditor items={ordering} details={details} onClose={() => setOrdering(undefined)} onSave={(ids) => {
      const first = ordering[0]; onChange({ ...config, matchOrders: [...config.matchOrders.filter((order) => !(order.categoryId === first.categoryId && order.drawId === first.drawId && order.stageKey === first.stageKey)),
        { categoryId: first.categoryId, drawId: first.drawId, stageKey: first.stageKey, orderedMatchIds: ids }] }); setOrdering(undefined);
    }} />}
  </div>;
}

export function ContinueFromMatchDrawer({ match, config, onClose, onChange }: { match: any; config: ScheduleConfig; onClose: () => void; onChange: (config: ScheduleConfig) => void }) {
  const pin = config.pinnedStarts.find((item) => item.matchId === match.matchId);
  const marker = config.earliestStarts.find((item) => 'matchId' in item.target && item.target.matchId === match.matchId);
  const initial = (match.pin ? pin?.startTime : marker?.notBefore || pin?.startTime) ?? match.start;
  const [day, setDay] = useState(initial == null ? match.localDate : localDay(initial, config.timezone));
  const [time, setTime] = useState(initial == null ? config.windows.find((window) => window.enabled)?.startLocalTime || '09:00' : localTime(initial, config.timezone));
  return <Drawer open onClose={onClose} title={match.pin ? 'Cố định giờ trận' : 'Dời từ trận này trở đi'} extra={<Button type="primary" onClick={() => {
    const instant = localISO(day, time, config.timezone);
    onChange(updateMatchStart(config, match.matchId, instant, match.pin));
  }}>Tính lại phần sau</Button>}><Space direction="vertical" className="w-full"><p>Mọi ngày phía sau trong cùng lịch sẽ được tính lại. Mã trận và sơ đồ được giữ nguyên.</p>
    <p>Mốc giờ riêng được ưu tiên hơn khoảng chuyển trận mặc định. Trận trước phải kết thúc và VĐV phải đủ thời gian nghỉ.</p>
    {!match.pin && pin && <p>Trận này đang cố định lúc {localDateTime(pin.startTime, config.timezone)}. Dời từ đây sẽ thay mốc cố định đó bằng mốc không bắt đầu trước.</p>}
    <Select aria-label="Ngày dời trận" className="w-full" value={day} onChange={setDay} options={config.windows.filter((window) => window.enabled).map((window) => ({ value: window.localDate, label: window.localDate }))} />
    <Input aria-label="Giờ dời trận" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
    <Button onClick={() => onChange(clearMatchStart(config, match.matchId))}>Bỏ mốc giờ của trận này</Button>
  </Space></Drawer>;
}

export function MatchOrderEditor({ items, details, onSave, onClose }: { items: any[]; details: Map<string, any>; onSave: (ids: string[]) => void; onClose: () => void }) {
  const [order, setOrder] = useState(items.map((item) => item.matchId));
  const move = (index: number, target: number) => {
    if (target < 0 || target >= order.length || order.slice(Math.min(index, target), Math.max(index, target) + 1).some((id) => details.get(id)?.immutable)) return;
    const next = [...order]; const [id] = next.splice(index, 1); next.splice(target, 0, id); setOrder(next);
  };
  return <Drawer open onClose={onClose} title="Thứ tự trận cùng hạng / vòng / nhánh" extra={<Button type="primary" onClick={() => onSave(order)}>Tính lại lịch</Button>}>
    <div className="space-y-3">{order.map((id, index) => <div className="flex items-center justify-between gap-2" key={id}><span>#{details.get(id)?.matchNumber || id} {details.get(id)?.immutable && '· Đã khóa'}</span>
      <Space><Button aria-label={`Đưa trận ${index + 1} lên`} disabled={index === 0 || details.get(id)?.immutable} onClick={() => move(index, index - 1)}>↑</Button>
        <Button aria-label={`Đưa trận ${index + 1} xuống`} disabled={index === order.length - 1 || details.get(id)?.immutable} onClick={() => move(index, index + 1)}>↓</Button>
        <InputNumber aria-label={`Vị trí trận ${index + 1}`} min={1} max={order.length} value={index + 1} disabled={details.get(id)?.immutable} onChange={(value) => value && move(index, value - 1)} /></Space></div>)}</div>
  </Drawer>;
}
