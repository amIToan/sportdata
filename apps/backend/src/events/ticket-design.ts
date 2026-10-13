// Pure layout contract shared by the browser preview and the PDF renderer.
// Coordinates are millimetres on an A6 sheet; text sizes are points.
export const TICKET_WIDTH = 105;
export const TICKET_HEIGHT = 148;
export const POINTS_PER_MM = 72 / 25.4;
export const TICKET_FIELDS = ['CUSTOM', 'ROLE', 'ATHLETE_NAME', 'FEDERATION', 'COUNTRY', 'EVENT_NAME', 'CATEGORY', 'SPORT', 'EVENT_DATE', 'EVENT_END_DATE', 'EVENT_DATE_RANGE', 'LOCATION', 'TICKET_CODE', 'STATUS'] as const;
export type TicketField = typeof TICKET_FIELDS[number];
export type TicketElement = {
  id: string;
  type: 'PHOTO' | 'QR' | 'TEXT';
  x: number;
  y: number;
  width: number;
  height: number;
  field?: TicketField;
  text?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
};
export type TicketDesign = { version: 1; elements: TicketElement[] };
export type TicketCategoryContent = {
  name: string;
  discipline?: string | null;
  uniform?: string | null;
  sport?: { name: string } | null;
};
export type TicketContent = {
  ticketCode: string;
  roleLabel?: string;
  status: string;
  paymentStatus?: string;
  isValid?: boolean;
  event: { name: string; startDate: string | Date; endDate?: string | Date | null; location?: string | null };
  sport?: { name: string } | null;
  category: { name: string };
  categories?: TicketCategoryContent[];
  athlete: { fullName: string; federation?: { name?: string } | null; country?: { name?: string } | null };
};

export function defaultTicketDesign(): TicketDesign {
  const text = (id: string, field: TicketField, x: number, y: number, width: number, height: number, fontSize: number, color = '#075985', value?: string): TicketElement => ({
    id, type: 'TEXT', field, x, y, width, height, fontSize, color, bold: true, align: 'center', ...(value ? { text: value } : {}),
  });
  return { version: 1, elements: [
    text('event-name', 'EVENT_NAME', 7, 6, 91, 22, 15),
    text('sport', 'SPORT', 7, 30, 91, 6, 9),
    { id: 'photo', type: 'PHOTO', x: 8, y: 41, width: 40, height: 60 },
    { id: 'qr', type: 'QR', x: 65, y: 42, width: 28, height: 28 },
    text('category', 'CATEGORY', 59, 77, 40, 20, 11),
    text('athlete-title', 'ROLE', 7, 105, 91, 10, 20, '#0284C7'),
    text('athlete-name', 'ATHLETE_NAME', 7, 118, 91, 8, 13),
    text('federation', 'FEDERATION', 7, 128, 91, 7, 10),
    text('event-dates', 'EVENT_DATE_RANGE', 7, 138, 91, 5, 8),
  ] };
}

export function validateTicketDesign(value: unknown): TicketDesign {
  const design = value as TicketDesign;
  if (!design || design.version !== 1 || !Array.isArray(design.elements) || design.elements.length < 2 || design.elements.length > 32) {
    throw new Error('Bố cục thẻ phải có từ 2 đến 32 thành phần và phiên bản 1');
  }
  const ids = new Set<string>();
  const elements = design.elements.map((element) => {
    if (!element || typeof element.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(element.id || '') || ids.has(element.id)) throw new Error('Mã thành phần thẻ không hợp lệ hoặc trùng lặp');
    ids.add(element.id);
    if (!['PHOTO', 'QR', 'TEXT'].includes(element.type)) throw new Error('Loại thành phần thẻ không hợp lệ');
    if (![element.x, element.y, element.width, element.height].every((number) => typeof number === 'number' && Number.isFinite(number))
      || element.x < 0 || element.y < 0 || element.width <= 0 || element.height <= 0
      || element.x + element.width > TICKET_WIDTH + 0.001 || element.y + element.height > TICKET_HEIGHT + 0.001) throw new Error('Thành phần phải nằm trong khung thẻ');
    const mm = (value: number) => Math.round(value * 1000) / 1000;
    const base: TicketElement = { id: element.id, type: element.type, x: mm(element.x), y: mm(element.y), width: mm(element.width), height: mm(element.height) };
    if (element.type === 'PHOTO' && (Math.abs(element.width - 40) > 0.001 || Math.abs(element.height - 60) > 0.001)) throw new Error('Ảnh thẻ phải giữ kích thước 4 × 6 cm');
    if (element.type === 'QR' && (Math.abs(element.width - element.height) > 0.001 || element.width < 20 || element.width > 60)) throw new Error('QR phải là hình vuông, cạnh từ 20 đến 60 mm');
    if (element.type !== 'TEXT') return base;
    if (!TICKET_FIELDS.includes(element.field!) || element.width < 5 || element.height < 3) throw new Error('Vùng chữ hoặc nội dung chữ không hợp lệ');
    if (typeof element.fontSize !== 'number' || !Number.isFinite(element.fontSize) || element.fontSize < 4 || element.fontSize > 48) throw new Error('Cỡ chữ phải từ 4 đến 48 pt');
    if (!/^#[0-9a-f]{6}$/i.test(element.color || '') || !['left', 'center', 'right'].includes(element.align || '') || typeof element.bold !== 'boolean') throw new Error('Màu chữ hoặc định dạng chữ không hợp lệ');
    if (element.text !== undefined && (typeof element.text !== 'string' || element.text.length > 1000)) throw new Error('Nội dung chữ tối đa 1000 ký tự');
    return { ...base, field: element.field, text: element.text || '', fontSize: element.fontSize, color: element.color, bold: element.bold, align: element.align };
  });
  if (elements.filter((item) => item.type === 'PHOTO').length !== 1 || elements.filter((item) => item.type === 'QR').length !== 1) throw new Error('Thẻ cần đúng một ảnh thẻ và một mã QR');
  return { version: 1, elements };
}

export function ticketDesign(value: unknown): TicketDesign {
  if (!value) return defaultTicketDesign();
  try { return validateTicketDesign(value); } catch { return defaultTicketDesign(); }
}

export function ticketCategoryLabel(category: TicketCategoryContent): string {
  const labels: Record<string, string> = {
    NEWAZA: category.uniform === 'NO_GI' ? 'No-Gi' : 'Gi',
    FIGHTING: 'Fighting',
    CONTACT: 'Full Contact',
    FULL_CONTACT: 'Full Contact',
    DUO: 'Duo',
    SHOW: 'Show',
  };
  const label = labels[category.discipline || ''] || category.discipline;
  return label ? `${label} · ${category.name}` : category.name;
}

export function ticketTextValue(element: TicketElement, ticket: TicketContent): string {
  const formatDate = (value?: string | Date | null) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
    });
  };
  const startDate = formatDate(ticket.event.startDate);
  const endDate = formatDate(ticket.event.endDate);
  const values: Record<TicketField, string> = {
    CUSTOM: ticket.roleLabel && element.text?.trim().toUpperCase() === 'VẬN ĐỘNG VIÊN'
      ? ticket.roleLabel.toUpperCase() : element.text || '',
    ROLE: ticket.roleLabel?.toUpperCase() || 'VẬN ĐỘNG VIÊN',
    ATHLETE_NAME: ticket.athlete.fullName,
    FEDERATION: ticket.athlete.federation?.name || (ticket.roleLabel ? 'Người tham gia cá nhân' : 'Vận động viên tự do'),
    COUNTRY: ticket.athlete.country?.name || '—',
    EVENT_NAME: ticket.event.name,
    CATEGORY: ticket.categories?.length ? ticket.categories.map(ticketCategoryLabel).join('\n') : ticket.category.name,
    SPORT: ticket.categories?.some((category) => category.sport?.name)
      ? [...new Set(ticket.categories.map((category) => category.sport?.name).filter(Boolean))].join(' · ')
      : ticket.sport?.name || 'Giải đấu thể thao',
    EVENT_DATE: startDate || 'Chưa cập nhật',
    EVENT_END_DATE: endDate || 'Chưa cập nhật',
    EVENT_DATE_RANGE: startDate && endDate
      ? startDate === endDate ? startDate : `${startDate} – ${endDate}`
      : startDate || endDate || 'Chưa cập nhật',
    LOCATION: ticket.event.location || 'Địa điểm cập nhật sau',
    TICKET_CODE: ticket.ticketCode,
    STATUS: ticket.status === 'CONFIRMED' && ticket.isValid !== false ? 'VÉ HỢP LỆ' : ticket.status === 'REJECTED' ? 'KHÔNG HỢP LỆ' : ticket.status === 'CANCELLED' ? 'ĐÃ HỦY' : 'CHỜ XÁC NHẬN',
  };
  return values[element.field || 'CUSTOM'];
}

// Both renderers use the same line breaks and fitted size, including explicit newlines.
export function ticketTextLayout(element: TicketElement, value: string) {
  const advance = (char: string, size: number) => (/\s/.test(char) ? 0.28 : /[ilI.,:!|]/.test(char) ? 0.28 : /[MW@]/.test(char) ? 0.9 : char.toUpperCase() === char ? 0.65 : 0.54) * size / POINTS_PER_MM;
  const wrap = (size: number) => value.split(/\r?\n/).flatMap((paragraph) => {
    const lines: string[] = []; let line = ''; let width = 0;
    const newline = () => { lines.push(line.trimEnd()); line = ''; width = 0; };
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const wordWidth = Array.from(word).reduce((sum, char) => sum + advance(char, size), 0);
      if (line && width + wordWidth > element.width) newline();
      for (const char of word) {
        const charWidth = advance(char, size);
        if (line && width + charWidth > element.width) newline();
        line += char; width += charWidth;
      }
      line += ' '; width += advance(' ', size);
    }
    lines.push(line.trimEnd());
    return lines;
  });
  let size = element.fontSize || 12;
  let lines = wrap(size);
  while (size > 4 && lines.length * (size / POINTS_PER_MM) * 1.2 > element.height) { size = Math.max(4, size - 0.25); lines = wrap(size); }
  const fontSize = size / POINTS_PER_MM;
  const maxLines = Math.max(1, Math.floor(element.height / (fontSize * 1.2)));
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'; }
  return { lines, fontSize, lineHeight: fontSize * 1.2, x: element.align === 'center' ? element.width / 2 : element.align === 'right' ? element.width : 0, anchor: element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start' };
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
export function ticketTextSvg(element: TicketElement, value: string, clipId = 'box') {
  const layout = ticketTextLayout(element, value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${element.width}" height="${element.height}" viewBox="0 0 ${element.width} ${element.height}"><defs><clipPath id="${escapeXml(clipId)}"><rect width="${element.width}" height="${element.height}" /></clipPath></defs><g clip-path="url(#${escapeXml(clipId)})" font-family="Roboto" font-weight="${element.bold ? 700 : 400}" font-size="${layout.fontSize}" fill="${element.color}">${layout.lines.map((line, index) => `<text x="${layout.x}" y="${layout.fontSize + index * layout.lineHeight}" text-anchor="${layout.anchor}">${escapeXml(line)}</text>`).join('')}</g></svg>`;
}
