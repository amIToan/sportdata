'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, Checkbox, Input, InputNumber, Segmented, Select } from 'antd';
import { EventParticipationCard, ticketElementStyle } from '@/components/EventParticipationCard';
import { TICKET_HEIGHT, TICKET_WIDTH, TICKET_FIELDS, defaultTicketDesign, type TicketDesign, type TicketElement, type TicketField } from '@/lib/ticket-design';
import type { ParticipationTicket } from '@/lib/ticket-types';

const fieldLabels: Record<TicketField, string> = {
  CUSTOM: 'Nội dung tự nhập', ATHLETE_NAME: 'Tên vận động viên', FEDERATION: 'Đơn vị / CLB', COUNTRY: 'Quốc gia', EVENT_NAME: 'Tên sự kiện', CATEGORY: 'Hạng đấu', SPORT: 'Bộ môn',
  EVENT_DATE: 'Ngày bắt đầu', EVENT_END_DATE: 'Ngày kết thúc', EVENT_DATE_RANGE: 'Ngày bắt đầu – kết thúc',
  LOCATION: 'Địa điểm', TICKET_CODE: 'Mã thẻ', STATUS: 'Trạng thái thẻ',
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
type Point = { x: number; y: number };
type Gesture = { mode: 'MOVE' | 'RESIZE' | 'DRAW'; start: Point; before: TicketDesign; element?: TicketElement; pointerId: number };

export function TicketDesignEditor({ ticket, design, onChange, disabled = false }: { ticket: ParticipationTicket; design: TicketDesign; onChange: (value: TicketDesign) => void; disabled?: boolean }) {
  const surface = useRef<HTMLDivElement>(null);
  const current = useRef(design);
  current.current = design;
  const gesture = useRef<Gesture | null>(null);
  const history = useRef<TicketDesign[]>([]);
  const [historyLength, setHistoryLength] = useState(0);
  const [selectedId, setSelectedId] = useState('photo');
  const [drawing, setDrawing] = useState(false);
  const [preview, setPreview] = useState(false);
  const editing = !disabled && !preview;
  const [draftBox, setDraftBox] = useState<Pick<TicketElement, 'x' | 'y' | 'width' | 'height'> | null>(null);
  const selected = design.elements.find((element) => element.id === selectedId);
  const label = (element: TicketElement) => element.type === 'PHOTO' ? 'Ảnh 4 × 6 cm' : element.type === 'QR' ? 'Mã QR' : fieldLabels[element.field || 'CUSTOM'];
  const remember = (before: TicketDesign) => { history.current = [...history.current.slice(-39), before]; setHistoryLength(history.current.length); };
  const change = (next: TicketDesign) => { if (JSON.stringify(next) === JSON.stringify(current.current)) return; remember(current.current); current.current = next; onChange(next); };
  const patch = (updates: Partial<TicketElement>, id = selectedId) => {
    const target = design.elements.find((element) => element.id === id);
    if (!target || disabled) return;
    const next = { ...target, ...updates };
    next.x = clamp(next.x, 0, TICKET_WIDTH - next.width);
    next.y = clamp(next.y, 0, TICKET_HEIGHT - next.height);
    change({ version: 1, elements: design.elements.map((element) => element.id === next.id ? next : element) });
  };
  const point = (event: ReactPointerEvent): Point => {
    const bounds = surface.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width * TICKET_WIDTH, 0, TICKET_WIDTH), y: clamp((event.clientY - bounds.top) / bounds.height * TICKET_HEIGHT, 0, TICKET_HEIGHT) };
  };
  const begin = (event: ReactPointerEvent, mode: Gesture['mode'], element?: TicketElement) => {
    if (disabled || event.button !== 0 || gesture.current) return;
    event.preventDefault(); event.stopPropagation();
    if (element) {
      setSelectedId(element.id);
      if (mode === 'MOVE') (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    }
    gesture.current = { mode, start: point(event), before: current.current, element, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent) => {
    const action = gesture.current;
    if (!action || action.pointerId !== event.pointerId) return;
    const nextPoint = point(event);
    if (action.mode === 'DRAW') {
      setDraftBox({ x: Math.min(nextPoint.x, action.start.x), y: Math.min(nextPoint.y, action.start.y), width: Math.abs(nextPoint.x - action.start.x), height: Math.abs(nextPoint.y - action.start.y) });
      return;
    }
    const original = action.element!;
    const next = { ...original };
    if (action.mode === 'MOVE') {
      next.x = clamp(original.x + nextPoint.x - action.start.x, 0, TICKET_WIDTH - original.width);
      next.y = clamp(original.y + nextPoint.y - action.start.y, 0, TICKET_HEIGHT - original.height);
    } else if (original.type === 'QR') {
      next.width = next.height = clamp(original.width + Math.max(nextPoint.x - action.start.x, nextPoint.y - action.start.y), 20, Math.min(60, TICKET_WIDTH - original.x, TICKET_HEIGHT - original.y));
    } else {
      next.width = clamp(original.width + nextPoint.x - action.start.x, 5, TICKET_WIDTH - original.x);
      next.height = clamp(original.height + nextPoint.y - action.start.y, 3, TICKET_HEIGHT - original.y);
    }
    current.current = { version: 1, elements: action.before.elements.map((item) => item.id === original.id ? next : item) };
    onChange(current.current);
  };
  const finish = (event: ReactPointerEvent, cancelled = false) => {
    const action = gesture.current;
    if (!action || action.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (cancelled) { current.current = action.before; onChange(action.before); }
    else if (action.mode === 'DRAW') {
      const end = point(event);
      const box = { x: Math.min(end.x, action.start.x), y: Math.min(end.y, action.start.y), width: Math.abs(end.x - action.start.x), height: Math.abs(end.y - action.start.y) };
      if (box.width >= 5 && box.height >= 3 && action.before.elements.length < 32) {
        const element: TicketElement = { ...box, id: crypto.randomUUID(), type: 'TEXT', field: 'CUSTOM', text: 'Nhập nội dung', fontSize: 12, color: '#075985', bold: true, align: 'left' };
        remember(action.before);
        current.current = { version: 1, elements: [...action.before.elements, element] };
        onChange(current.current); setSelectedId(element.id); setDrawing(false);
      }
    } else if (JSON.stringify(action.before) !== JSON.stringify(current.current)) remember(action.before);
    setDraftBox(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div>
      {!disabled && <div className="mb-4 flex flex-wrap gap-2">
        <Button aria-pressed={preview} onClick={() => { setPreview(!preview); setDrawing(false); }}>{preview ? 'Tiếp tục chỉnh sửa' : 'Xem thẻ'}</Button>
        <Button disabled={preview || design.elements.length >= 32} type={drawing ? 'primary' : 'default'} onClick={() => setDrawing(!drawing)}>{drawing ? 'Hủy vẽ chữ' : 'Vẽ vùng chữ'}</Button>
        <Button disabled={!historyLength} onClick={() => { const previous = history.current.pop(); if (previous) { current.current = previous; onChange(previous); setHistoryLength(history.current.length); } }}>Hoàn tác</Button>
        <Button onClick={() => { change(defaultTicketDesign()); setSelectedId('photo'); setDrawing(false); }}>Bố cục mặc định</Button>
      </div>}
      <p className="mb-4 text-sm text-slate-500">{disabled ? 'Bố cục đang áp dụng cho thẻ.' : drawing ? 'Kéo trên thẻ để vẽ vùng chữ (tối thiểu 5 × 3 mm), sau đó nhập nội dung bên phải.' : 'Kéo ảnh, QR hoặc chữ để di chuyển. Kéo góc dưới phải để đổi kích thước QR và vùng chữ. Dùng phím mũi tên để chỉnh vị trí.'}</p>
      <div className={editing ? 'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]' : 'block'}>
        <div ref={surface} className="ticket-editor-surface relative mx-auto aspect-[105/148] w-full max-w-[560px] shadow-lg" onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}>
          <EventParticipationCard ticket={ticket} design={design} />
          {editing && design.elements.map((element) => (
            <div key={element.id} className="ticket-editor-region" data-selected={selectedId === element.id} data-editor-element={element.id} style={ticketElementStyle(element)} tabIndex={drawing ? -1 : 0} role="button" aria-label={`Di chuyển ${label(element)}`} onFocus={() => setSelectedId(element.id)} onPointerDown={(event) => begin(event, 'MOVE', element)} onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Escape') { setDrawing(false); return; }
              const delta = event.shiftKey ? 5 : 1;
              const direction: Record<string, Point> = { ArrowLeft: { x: -delta, y: 0 }, ArrowRight: { x: delta, y: 0 }, ArrowUp: { x: 0, y: -delta }, ArrowDown: { x: 0, y: delta } };
              if (direction[event.key]) { event.preventDefault(); patch({ x: element.x + direction[event.key].x, y: element.y + direction[event.key].y }, element.id); }
            }}>
              {selectedId === element.id && <span className="ticket-editor-label">{label(element)}</span>}
              {selectedId === element.id && element.type !== 'PHOTO' && <button type="button" aria-label={`Đổi kích thước ${label(element)}`} className="absolute -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize border border-white bg-sky-500" onPointerDown={(event) => begin(event, 'RESIZE', element)} />}
            </div>
          ))}
          {drawing && editing && <div className="absolute inset-0 cursor-crosshair" data-ticket-draw="true" onPointerDown={(event) => begin(event, 'DRAW')} />}
          {draftBox && <div className="ticket-editor-draft pointer-events-none border-2 border-sky-500 bg-sky-500/10" style={ticketElementStyle({ ...draftBox, id: 'draft', type: 'TEXT' })} />}
        </div>
        {editing && <div className="rounded-xl border border-slate-500/20 p-4">
          <label className="mb-2 block text-sm font-semibold">Thành phần đang chọn</label>
          <Select className="mb-4 w-full" aria-label="Thành phần đang chọn" value={selected?.id} onChange={setSelectedId} options={design.elements.map((element, index) => ({ value: element.id, label: `${index + 1}. ${label(element)}` }))} />
          {selected && <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">{(['x', 'y'] as const).map((axis) => <label key={axis} className="text-sm">{axis === 'x' ? 'Trái' : 'Trên'} (mm)<InputNumber aria-label={`${axis} (mm)`} className="mt-1 w-full" min={0} max={(axis === 'x' ? TICKET_WIDTH - selected.width : TICKET_HEIGHT - selected.height)} precision={1} step={1} value={selected[axis]} onChange={(value) => value != null && patch({ [axis]: value })} /></label>)}</div>
            {selected.type === 'PHOTO' && <p className="text-sm text-slate-500">Ảnh thẻ từ hồ sơ đăng ký. Kích thước in cố định 40 × 60 mm.</p>}
            {selected.type === 'QR' && <label className="block text-sm">Cạnh QR (mm)<InputNumber aria-label="Cạnh QR (mm)" className="mt-1 w-full" min={20} max={60} value={selected.width} onChange={(value) => value != null && patch({ width: value, height: value })} /></label>}
            {selected.type === 'TEXT' && <>
              <label className="block text-sm">Nội dung<Select aria-label="Nội dung vùng chữ" className="mt-1 w-full" value={selected.field} options={TICKET_FIELDS.map((field) => ({ value: field, label: fieldLabels[field] }))} onChange={(field) => patch({ field })} /></label>
              {selected.field === 'CUSTOM' && <Input.TextArea aria-label="Chữ trên thẻ" rows={3} maxLength={1000} value={selected.text} onChange={(event) => patch({ text: event.target.value })} />}
              <div className="grid grid-cols-2 gap-3">{(['width', 'height'] as const).map((axis) => <label key={axis} className="text-sm">{axis === 'width' ? 'Rộng' : 'Cao'} (mm)<InputNumber aria-label={`${axis} (mm)`} className="mt-1 w-full" min={axis === 'width' ? 5 : 3} max={axis === 'width' ? 105 : 148} precision={1} value={selected[axis]} onChange={(value) => value != null && patch({ [axis]: value })} /></label>)}</div>
              <div className="grid grid-cols-2 gap-3"><label className="text-sm">Màu chữ<Input aria-label="Màu chữ" type="color" className="mt-1 h-9 p-1" value={selected.color} onChange={(event) => patch({ color: event.target.value })} /></label><label className="text-sm">Cỡ chữ (pt)<InputNumber aria-label="Cỡ chữ (pt)" className="mt-1 w-full" min={4} max={48} step={0.5} value={selected.fontSize} onChange={(value) => value != null && patch({ fontSize: value })} /></label></div>
              <Segmented block value={selected.align} options={[{ value: 'left', label: 'Trái' }, { value: 'center', label: 'Giữa' }, { value: 'right', label: 'Phải' }]} onChange={(align) => patch({ align: align as TicketElement['align'] })} />
              <Checkbox checked={selected.bold} onChange={(event) => patch({ bold: event.target.checked })}>Chữ đậm</Checkbox>
              <p className="text-xs text-slate-500">Chữ tự xuống dòng và thu nhỏ để vừa vùng đã vẽ. Dữ liệu tự động thay theo từng người tham gia.</p>
              <Button danger block onClick={() => { change({ version: 1, elements: design.elements.filter((element) => element.id !== selected.id) }); setSelectedId('photo'); }}>Xóa vùng chữ</Button>
            </>}
          </div>}
        </div>}
      </div>
    </div>
  );
}
