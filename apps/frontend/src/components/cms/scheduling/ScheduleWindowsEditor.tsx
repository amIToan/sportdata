'use client';

import { Button, Card, Checkbox, Collapse, Input, InputNumber, Select, Space, Switch } from 'antd';
import { useState } from 'react';
import { ScheduleConfig, groupLabel, localISO, stageLabel, uid } from './schedule-ui';
import dayjs from 'dayjs';

export function ScheduleWindowsEditor({ config, input, onChange, onRest }: {
  config: ScheduleConfig; input: any; onChange: (config: ScheduleConfig) => void; onRest: (sportId: string, minutes: number) => void;
}) {
  const updateWindow = (index: number, changes: Partial<ScheduleConfig['windows'][number]>) => onChange({ ...config,
    windows: config.windows.map((window, i) => i === index ? { ...window, ...changes } : window) });
  return <div className="space-y-4">
    <p>Chỉ các ngày và thảm được bật dưới đây mới được dùng. Giờ hiển thị theo {config.timezone}.</p>
    {config.windows.some((window) => !window.startLocalTime) && <p className="text-amber-700">Ô ngày/thảm này đã có lịch. Chọn giờ bắt đầu để hệ thống tìm khoảng trống đủ dài khi xem trước.</p>}
    {config.windows.map((window, index) => <Card key={window.id} size="small" title={`Ngày thi đấu ${index + 1}`}>
      <Space wrap align="end">
        <Checkbox checked={window.enabled} onChange={(event) => updateWindow(index, { enabled: event.target.checked })}>Sử dụng</Checkbox>
        <label>Ngày<Select aria-label={`Ngày cửa sổ ${index + 1}`} className="block min-w-40" value={window.localDate || undefined}
          options={input.days.map((day: string) => ({ value: day, label: day }))} onChange={(localDate) => updateWindow(index, { localDate })} /></label>
        <label>Thảm<Select aria-label={`Thảm cửa sổ ${index + 1}`} className="block min-w-40" value={window.fopId || undefined}
          options={input.fops.map((fop: any) => ({ value: fop.id, label: fop.name }))} onChange={(fopId) => updateWindow(index, { fopId })} /></label>
        <label>Bắt đầu<Input aria-label={`Bắt đầu ngày ${index + 1}`} type="time" value={window.startLocalTime} onChange={(event) => updateWindow(index, { startLocalTime: event.target.value })} /></label>
        <label>Kết thúc<Input aria-label={`Kết thúc ngày ${index + 1}`} type="time" value={window.endLocalTime} onChange={(event) => updateWindow(index, { endLocalTime: event.target.value })} /></label>
        {index > 0 && <Button danger onClick={() => onChange({ ...config, windows: config.windows.filter((_, i) => i !== index) })}>Xóa ngày</Button>}
      </Space>
      <div className="mt-3 space-y-2">{window.breaks.map((pause, pauseIndex) => <Space wrap key={pauseIndex}>
        <label>Nghỉ từ<Input type="time" aria-label={`Bắt đầu khoảng nghỉ ${pauseIndex + 1}`} value={pause.startLocalTime} onChange={(event) => updateWindow(index, { breaks: window.breaks.map((item, i) => i === pauseIndex ? { ...item, startLocalTime: event.target.value } : item) })} /></label>
        <label>Đến<Input type="time" aria-label={`Kết thúc khoảng nghỉ ${pauseIndex + 1}`} value={pause.endLocalTime} onChange={(event) => updateWindow(index, { breaks: window.breaks.map((item, i) => i === pauseIndex ? { ...item, endLocalTime: event.target.value } : item) })} /></label>
        <Button onClick={() => updateWindow(index, { breaks: window.breaks.filter((_, i) => i !== pauseIndex) })}>Bỏ khoảng nghỉ</Button>
      </Space>)}</div>
      <Button className="mt-3" onClick={() => updateWindow(index, { breaks: [...window.breaks, { startLocalTime: '12:00', endLocalTime: '13:00' }] })}>+ Khoảng nghỉ</Button>
    </Card>)}
    <Button onClick={() => { const last = config.windows.at(-1); const next = input.days.find((day: string) => day > (last?.localDate || '') && !config.windows.some((window) => window.localDate === day));
      if (next) onChange({ ...config, windows: [...config.windows, { id: uid(), localDate: next, fopId: last?.fopId || '', startLocalTime: '09:00', endLocalTime: '18:00', enabled: true, breaks: [] }] });
    }} disabled={!input.days.some((day: string) => day > (config.windows.at(-1)?.localDate || '') && !config.windows.some((window) => window.localDate === day))}>+ Thêm ngày tiếp tục</Button>
    <div><Switch checked={config.autoContinue} onChange={(autoContinue) => onChange({ ...config, autoContinue })} aria-label="Tự tiếp tục khi hết giờ" /> <span>Hết giờ thì tiếp tục ngày hợp lệ kế tiếp</span></div>
    <Card title="Thời lượng và thời gian nghỉ" size="small"><div className="space-y-4">{config.blocks.map((block, index) => {
      const category = input.categories.find((item: any) => block.categoryIds.includes(item.id));
      const rule = input.rules.find((item: any) => item.sportId === category?.sportId);
      return <div key={block.id}><strong>{category ? groupLabel(category) : `Nội dung ${index + 1}`}</strong><div className="mt-2 flex flex-wrap gap-4">
        <label>Thời lượng trận (phút)<InputNumber className="!block" aria-label={`Thời lượng nội dung ${index + 1}`} min={1 / 60} max={720}
          value={(block.estimatedDurationSeconds ?? (rule?.matchDurationMinutes * 60 || category?.matchDurationSeconds || 600)) / 60}
          onChange={(value) => onChange({ ...config, blocks: config.blocks.map((item, i) => i === index ? { ...item, estimatedDurationSeconds: Math.round(Number(value) * 60) } : item) })} /></label>
        <label>Chuyển trận mặc định (phút)<InputNumber className="!block" aria-label={`Chuyển trận nội dung ${index + 1}`} min={0} max={180}
          value={(block.turnaroundSeconds ?? (rule?.turnaroundMinutes ?? 5) * 60) / 60}
          onChange={(value) => onChange({ ...config, blocks: config.blocks.map((item, i) => i === index ? { ...item, turnaroundSeconds: Math.round(Number(value) * 60) } : item) })} /></label>
        <div>Nghỉ VĐV tối thiểu: {rule?.minRestMinutes ?? 60} phút<RestEditor initial={rule?.minRestMinutes ?? 60} onSave={(minutes) => onRest(category.sportId, minutes)} /></div>
      </div></div>;
    })}</div></Card>
    <StageEarliestStartEditor config={config} input={input} onChange={onChange} />
  </div>;
}

function RestEditor({ initial, onSave }: { initial: number; onSave: (value: number) => void }) {
  const [value, setValue] = useState(initial);
  return <Space className="mt-2"><InputNumber aria-label="Quy định nghỉ VĐV (phút)" min={0} max={10080} value={value} onChange={(next) => setValue(next ?? initial)} /><Button onClick={() => onSave(value)}>Lưu quy định nghỉ của giải</Button></Space>;
}

export function StageEarliestStartEditor({ config, input, onChange }: { config: ScheduleConfig; input: any; onChange: (config: ScheduleConfig) => void }) {
  const [blockId, setBlockId] = useState<string>();
  const [stageKey, setStageKey] = useState<string>();
  const [day, setDay] = useState<string>();
  const [time, setTime] = useState('09:00');
  const block = config.blocks.find((item) => item.id === blockId);
  const stages = [...new Set<string>(input.categories.filter((item: any) => block?.categoryIds.includes(item.id)).flatMap((item: any) => item.stages.map((stage: any) => stage.stageKey)))];
  const labelForStage = (key: string, targetBlockId?: string) => {
    const targetBlock = config.blocks.find((item) => item.id === targetBlockId);
    const labels = input.categories.filter((category: any) => targetBlock?.categoryIds.includes(category.id))
      .flatMap((category: any) => category.stages.filter((stage: any) => stage.stageKey === key)
        .map((stage: any) => ({ category: category.name, label: stageLabel(key, stage.round) })));
    const unique = [...new Set<string>(labels.map((item: any) => item.label))];
    return unique.length > 1 ? labels.map((item: any) => `${item.category}: ${item.label}`).join('; ') : unique[0] || stageLabel(key);
  };
  return <Collapse items={[{ key: 'stages', label: 'Chủ động chia theo vòng', children: <div className="space-y-3">
    {config.earliestStarts.map((marker, index) => <div key={index} className="flex flex-wrap items-center gap-2"><span>{'matchId' in marker.target ? 'Dời từ trận đã chọn' : labelForStage(marker.target.stageKey, marker.target.blockId)} · {dayjs(marker.notBefore).tz(config.timezone).format('DD/MM HH:mm')}</span>
      <Button size="small" onClick={() => onChange({ ...config, earliestStarts: config.earliestStarts.filter((_, i) => i !== index) })}>Bỏ mốc</Button></div>)}
    <Space wrap><Select aria-label="Nội dung đặt mốc" placeholder="Chọn nội dung" className="min-w-52" value={blockId} onChange={(id) => { setBlockId(id); setStageKey(undefined); }}
      options={config.blocks.map((item, index) => ({ value: item.id, label: `${index + 1}. ${groupLabel(input.categories.find((category: any) => item.categoryIds.includes(category.id)) || {})}` }))} />
      <Select aria-label="Vòng đặt mốc" placeholder="Chọn vòng" className="min-w-48" value={stageKey} onChange={setStageKey} options={stages.map((key) => ({ value: key, label: labelForStage(key, blockId) }))} />
      <Select aria-label="Ngày bắt đầu vòng" placeholder="Ngày" className="min-w-36" value={day} onChange={setDay} options={config.windows.filter((window) => window.enabled).map((window) => ({ value: window.localDate, label: window.localDate }))} />
      <Input aria-label="Giờ bắt đầu vòng" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
      <Button disabled={!blockId || !stageKey || !day || !time} onClick={() => onChange({ ...config, earliestStarts: [
        ...config.earliestStarts.filter((marker) => !('blockId' in marker.target && marker.target.blockId === blockId && marker.target.stageKey === stageKey)),
        { target: { blockId: blockId!, stageKey: stageKey! }, notBefore: localISO(day!, time, config.timezone) },
      ] })}>Đặt mốc sớm nhất</Button>
    </Space><p className="text-sm text-slate-500">Vòng có thể bắt đầu muộn hơn nếu vòng trước chưa xong hoặc VĐV chưa đủ thời gian nghỉ.</p>
  </div> }]} />;
}
