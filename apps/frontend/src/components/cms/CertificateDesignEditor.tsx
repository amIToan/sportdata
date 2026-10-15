'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { Button, Checkbox, Input, InputNumber, Select, Space } from 'antd';
import { CERTIFICATE_FIELDS, certificateSize, type CertificateDesign, type CertificateElement, type CertificateEvent, type CertificateField, type CertificateRecipient } from '@/lib/certificate-design';
import { CertificateSheet, certificateElementStyle } from './CertificateSheet';
import styles from './EventCertificates.module.css';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
type Gesture = { id: number; start: { x: number; y: number }; original: CertificateElement; before: CertificateDesign; resize: boolean };

export function CertificateDesignEditor({ design, onChange, event, recipient, background, disabled }: {
  design: CertificateDesign; onChange: (design: CertificateDesign) => void;
  event: CertificateEvent; recipient: CertificateRecipient; background?: string | null; disabled: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const current = useRef(design);
  current.current = design;
  const gesture = useRef<Gesture | null>(null);
  const [selectedId, setSelectedId] = useState(design.elements[0]?.id);
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState<CertificateDesign[]>([]);
  const size = certificateSize(design.orientation);
  const selected = design.elements.find((element) => element.id === selectedId);
  const remember = (before: CertificateDesign) => setHistory((items) => [...items.slice(-29), before]);
  const change = (next: CertificateDesign) => { if (disabled) return; remember(current.current); current.current = next; onChange(next); };
  const patch = (updates: Partial<CertificateElement>, id = selectedId) => {
    const element = current.current.elements.find((item) => item.id === id);
    if (!element) return;
    const next = { ...element, ...updates };
    next.width = clamp(next.width, 5, size.width);
    next.height = clamp(next.height, 3, size.height);
    next.x = clamp(next.x, 0, size.width - next.width);
    next.y = clamp(next.y, 0, size.height - next.height);
    change({ ...current.current, elements: current.current.elements.map((item) => item.id === id ? next : item) });
  };
  const point = (event: PointerEvent) => {
    const rect = surface.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * size.width, y: (event.clientY - rect.top) / rect.height * size.height };
  };
  const begin = (event: PointerEvent, element: CertificateElement, resize: boolean) => {
    if (disabled || preview || event.button !== 0 || gesture.current) return;
    event.preventDefault(); event.stopPropagation();
    setSelectedId(element.id);
    gesture.current = { id: event.pointerId, start: point(event), original: element, before: current.current, resize };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!resize) (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  };
  const move = (event: PointerEvent) => {
    const action = gesture.current;
    if (!action || action.id !== event.pointerId) return;
    const position = point(event);
    const dx = position.x - action.start.x, dy = position.y - action.start.y;
    const original = action.original;
    const next = action.resize
      ? { ...original, width: clamp(original.width + dx, 5, size.width - original.x), height: clamp(original.height + dy, 3, size.height - original.y) }
      : { ...original, x: clamp(original.x + dx, 0, size.width - original.width), y: clamp(original.y + dy, 0, size.height - original.height) };
    current.current = { ...action.before, elements: action.before.elements.map((item) => item.id === original.id ? next : item) };
    onChange(current.current);
  };
  const finish = (event: PointerEvent, cancel = false) => {
    const action = gesture.current;
    if (!action || action.id !== event.pointerId) return;
    gesture.current = null;
    if (cancel) { current.current = action.before; onChange(action.before); }
    else remember(action.before);
  };
  const add = () => {
    const element: CertificateElement = { id: crypto.randomUUID(), field: 'CUSTOM', text: 'Nhập nội dung', x: 20, y: 120, width: 100, height: 15, fontSize: 18, fontFamily: 'serif', color: '#111111', bold: false, italic: false, align: 'center' };
    change({ ...design, elements: [...design.elements, element] }); setSelectedId(element.id);
  };

  return <div>
    <div className={styles.toolbar}>
      <Button onClick={() => setPreview(!preview)}>{preview ? 'Chỉnh vị trí' : 'Xem trước'}</Button>
      {!disabled && <>
        <Button disabled={preview || design.elements.length >= 64} onClick={add}>Thêm vùng chữ</Button>
        <Button disabled={!history.length} onClick={() => { const previous = history.at(-1)!; onChange(previous); setHistory(history.slice(0, -1)); }}>Hoàn tác</Button>
        <Select aria-label="Hướng giấy" value={design.orientation} style={{ width: 150 }} options={[{ value: 'portrait', label: 'A4 dọc' }, { value: 'landscape', label: 'A4 ngang' }]} onChange={(orientation) => {
          const next = certificateSize(orientation);
          change({ ...design, orientation, elements: design.elements.map((element) => ({ ...element, x: element.x / size.width * next.width, y: element.y / size.height * next.height, width: element.width / size.width * next.width, height: element.height / size.height * next.height })) });
        }} />
      </>}
    </div>
    <p className={styles.help}>Khổ {size.width} × {size.height} mm. Kéo vùng chữ để di chuyển, kéo góc để đổi kích thước. Phím mũi tên dịch 0,5 mm; giữ Shift để dịch 5 mm.</p>
    <div className={styles.layout}>
      <div ref={surface} className={styles.canvas} onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}>
        <CertificateSheet design={design} event={event} recipient={recipient} background={background} />
        {!preview && !disabled && <div className={styles.content} style={{ transform: `translate(${design.offsetX / size.width * 100}%, ${design.offsetY / size.height * 100}%)` }}>
          {design.elements.map((element) => <div key={element.id} className={styles.region} data-selected={selectedId === element.id} style={certificateElementStyle(element, design)} role="button" tabIndex={0} aria-label={`Di chuyển ${CERTIFICATE_FIELDS[element.field]}`} onFocus={() => setSelectedId(element.id)} onPointerDown={(event) => begin(event, element, false)} onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const step = event.shiftKey ? 5 : 0.5;
            const directions: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            if (directions[event.key]) { event.preventDefault(); const [dx, dy] = directions[event.key]; patch({ x: element.x + dx, y: element.y + dy }, element.id); }
          }}>
            {selectedId === element.id && <button type="button" className={styles.resize} aria-label="Đổi kích thước vùng chữ" onPointerDown={(event) => begin(event, element, true)} />}
          </div>)}
        </div>}
      </div>
      {!disabled && !preview && <div className={styles.properties}>
        <label>Vùng chữ<Select value={selected?.id} placeholder="Thêm vùng chữ" onChange={setSelectedId} options={design.elements.map((element, i) => ({ value: element.id, label: `${i + 1}. ${CERTIFICATE_FIELDS[element.field]}` }))} /></label>
        {selected && <>
          <label>Nội dung<Select value={selected.field} options={Object.entries(CERTIFICATE_FIELDS).map(([value, label]) => ({ value, label }))} onChange={(field: CertificateField) => patch({ field })} /></label>
          {selected.field === 'CUSTOM' && <label>Chữ tự nhập<Input.TextArea rows={3} maxLength={2000} value={selected.text} onChange={(event) => patch({ text: event.target.value })} /></label>}
          <div className={styles.numbers}>{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{{ x: 'Trái', y: 'Trên', width: 'Rộng', height: 'Cao' }[key]} (mm)<InputNumber style={{ width: '100%' }} min={key === 'width' ? 5 : key === 'height' ? 3 : 0} max={key === 'x' || key === 'width' ? size.width : size.height} precision={1} step={0.5} value={selected[key]} onChange={(value) => value !== null && patch({ [key]: value })} /></label>)}</div>
          <label>Phông chữ<Select value={selected.fontFamily} options={[{ value: 'serif', label: 'Times New Roman' }, { value: 'sans-serif', label: 'Arial' }]} onChange={(fontFamily) => patch({ fontFamily })} /></label>
          <label>Cỡ chữ (pt)<InputNumber min={6} max={96} value={selected.fontSize} onChange={(fontSize) => fontSize !== null && patch({ fontSize })} /></label>
          <Space><Checkbox checked={selected.bold} onChange={(event) => patch({ bold: event.target.checked })}>Đậm</Checkbox><Checkbox checked={selected.italic} onChange={(event) => patch({ italic: event.target.checked })}>Nghiêng</Checkbox></Space>
          <label>Căn chữ<Select value={selected.align} options={[{ value: 'left', label: 'Trái' }, { value: 'center', label: 'Giữa' }, { value: 'right', label: 'Phải' }]} onChange={(align) => patch({ align })} /></label>
          <label>Màu chữ<input type="color" value={selected.color} onChange={(event) => patch({ color: event.target.value })} /></label>
          <Button danger onClick={() => change({ ...design, elements: design.elements.filter((element) => element.id !== selected.id) })}>Xóa vùng chữ</Button>
        </>}
      </div>}
    </div>
  </div>;
}
