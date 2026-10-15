// A4 coordinates in millimetres; font sizes in points. Shared with the CMS.
export const CERTIFICATE_FIELDS = {
  CUSTOM: 'Nội dung tự nhập', ATHLETE_NAME: 'Họ tên VĐV', BIRTH_DATE: 'Ngày sinh',
  FEDERATION: 'Đơn vị / CLB', COUNTRY: 'Quốc gia', CATEGORY: 'Hạng đấu',
  SPORT: 'Bộ môn', EVENT_NAME: 'Tên giải đấu', EVENT_DATE: 'Thời gian giải đấu',
  LOCATION: 'Địa điểm', AWARD: 'Thành tích', ISSUE_DATE: 'Ngày cấp',
  ATHLETE_NAME_UPPER: 'Họ tên VĐV (in hoa)', BIRTH_YEAR: 'Năm sinh',
  AWARD_LINE: 'Dòng thành tích và hạng đấu', EVENT_TITLE: 'Tại giải đấu (in hoa)',
  EVENT_DATE_LONG: 'Thời gian giải (viết đầy đủ)', ISSUE_LINE: 'Địa danh và ngày cấp',
  SIGNER_TITLE: 'Chức danh người ký', SIGNER_NAME: 'Họ tên người ký',
} as const;
export type CertificateField = keyof typeof CERTIFICATE_FIELDS;
export type CertificateElement = {
  id: string; field: CertificateField; text: string;
  x: number; y: number; width: number; height: number;
  fontSize: number; fontFamily: 'serif' | 'sans-serif';
  color: string; bold: boolean; italic: boolean; align: 'left' | 'center' | 'right';
};
export type CertificateDesign = {
  version: 1; orientation: 'portrait' | 'landscape'; elements: CertificateElement[];
  issueDate: string; offsetX: number; offsetY: number; awards: Record<string, string>;
  issuePlace?: string; signerTitle?: string; signerName?: string;
};
export type CertificateRecipient = {
  id: string; athleteName: string; birthDate: string | null; federation: string;
  country: string; category: string; sport: string;
  award?: string;
};
export type CertificateEvent = { name: string; startDate: string; endDate: string; location?: string };
export function certificateSize(orientation: CertificateDesign['orientation']) {
  return orientation === 'landscape' ? { width: 297, height: 210 } : { width: 210, height: 297 };
}
export function defaultCertificateDesign(): CertificateDesign {
  const field = (id: string, key: CertificateField, y: number, fontSize: number): CertificateElement => ({
    id, field: key, text: '', x: 25, y, width: 160, height: 12, fontSize,
    fontFamily: 'serif', color: '#111111', bold: false, italic: false, align: 'center',
  });
  const label = (id: string, text: string, y: number, italic = false): CertificateElement => ({ ...field(id, 'CUSTOM', y, 13), x: 40, width: 38, height: 8, text, italic, align: 'right' });
  const value = (id: string, key: CertificateField, y: number): CertificateElement => ({ ...field(id, key, y, 14), x: 82, width: 90, height: 8, bold: true });
  return { version: 1, orientation: 'portrait', issueDate: '', issuePlace: '', signerTitle: 'KT. CHỦ TỊCH\nPHÓ CHỦ TỊCH', signerName: '', offsetX: 0, offsetY: 0, awards: {}, elements: [
    label('name-label', 'Họ và tên:', 133), value('name', 'ATHLETE_NAME_UPPER', 133),
    label('birth-label', 'Năm sinh:', 142, true), value('birth-year', 'BIRTH_YEAR', 142),
    label('federation-label', 'Đơn vị', 151), value('federation', 'FEDERATION', 151),
    { ...field('award', 'AWARD_LINE', 161, 12), x: 18, width: 174, height: 10, bold: true },
    { ...field('event', 'EVENT_TITLE', 172, 12), x: 18, width: 174, height: 12, bold: true },
    { ...field('event-dates', 'EVENT_DATE_LONG', 185, 12), x: 18, width: 174, height: 9, italic: true },
    { ...field('issue-line', 'ISSUE_LINE', 204, 12), x: 99, width: 97, height: 9, italic: true },
    { ...field('signer-title', 'SIGNER_TITLE', 215, 13), x: 110, width: 75, height: 18, bold: true },
    { ...field('signer-name', 'SIGNER_NAME', 246, 13), x: 105, width: 85, height: 9, bold: true },
  ] };
}
export function certificateText(element: CertificateElement, recipient: CertificateRecipient, event: CertificateEvent, design: CertificateDesign) {
  const date = (value?: string | null) => value ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
  const parts = (value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
    if (!Number.isFinite(parsed.getTime())) return null;
    const values = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).formatToParts(parsed);
    const get = (key: string) => values.find((part) => part.type === key)?.value || '';
    return { day: get('day'), month: get('month'), year: get('year') };
  };
  const start = parts(event.startDate), end = parts(event.endDate), issue = parts(design.issueDate);
  const longDate = (p: NonNullable<ReturnType<typeof parts>>) => `ngày ${p.day} tháng ${p.month} năm ${p.year}`;
  const eventDates = start && end ? start.year === end.year && start.month === end.month
    ? `Từ ngày ${start.day} đến ngày ${end.day} tháng ${end.month} năm ${end.year}`
    : `Từ ${longDate(start)} đến ${longDate(end)}` : '';
  const award = Object.prototype.hasOwnProperty.call(design.awards, recipient.id) ? design.awards[recipient.id] : recipient.award || '';
  const awardLine = `${award ? (/^đạt\b/i.test(award) ? award : `Đạt ${award}`) : 'Tham gia thi đấu'}${recipient.category ? ` hạng ${recipient.category}` : ''}`.toLocaleUpperCase('vi-VN');
  const values: Record<CertificateField, string> = {
    CUSTOM: element.text, ATHLETE_NAME: recipient.athleteName, BIRTH_DATE: date(recipient.birthDate),
    FEDERATION: recipient.federation, COUNTRY: recipient.country, CATEGORY: recipient.category,
    SPORT: recipient.sport, EVENT_NAME: event.name, EVENT_DATE: `${date(event.startDate)} – ${date(event.endDate)}`,
    LOCATION: event.location || '', AWARD: award, ISSUE_DATE: date(design.issueDate),
    ATHLETE_NAME_UPPER: recipient.athleteName.toLocaleUpperCase('vi-VN'), BIRTH_YEAR: parts(recipient.birthDate)?.year || '',
    AWARD_LINE: awardLine, EVENT_TITLE: `TẠI ${event.name}`.toLocaleUpperCase('vi-VN'), EVENT_DATE_LONG: eventDates,
    ISSUE_LINE: issue ? `${design.issuePlace?.trim() ? `${design.issuePlace.trim()}, ` : ''}${longDate(issue)}` : '',
    SIGNER_TITLE: design.signerTitle || '', SIGNER_NAME: design.signerName || '',
  };
  return values[element.field];
}
export function validateCertificateDesign(value: unknown): CertificateDesign {
  const input = value as CertificateDesign;
  const fail = () => { throw new Error('Bố cục giấy chứng nhận không hợp lệ'); };
  if (!input || input.version !== 1 || !['portrait', 'landscape'].includes(input.orientation) || !Array.isArray(input.elements) || input.elements.length > 64) fail();
  const size = certificateSize(input.orientation);
  const ids = new Set<string>();
  const elements = input.elements.map((element) => {
    if (!element || typeof element.id !== 'string' || !element.id || element.id.length > 80 || ids.has(element.id)) fail();
    ids.add(element.id);
    if (!Object.prototype.hasOwnProperty.call(CERTIFICATE_FIELDS, element.field) || typeof element.text !== 'string' || element.text.length > 2000) fail();
    if (![element.x, element.y, element.width, element.height, element.fontSize].every((n) => typeof n === 'number' && Number.isFinite(n))) fail();
    if (element.x < 0 || element.y < 0 || element.width < 5 || element.height < 3 || element.x + element.width > size.width + 0.01 || element.y + element.height > size.height + 0.01 || element.fontSize < 6 || element.fontSize > 96) fail();
    if (!['serif', 'sans-serif'].includes(element.fontFamily) || !['left', 'center', 'right'].includes(element.align) || !/^#[0-9a-f]{6}$/i.test(element.color) || typeof element.bold !== 'boolean' || typeof element.italic !== 'boolean') fail();
    return { id: element.id, field: element.field, text: element.text, x: element.x, y: element.y, width: element.width, height: element.height, fontSize: element.fontSize, fontFamily: element.fontFamily, color: element.color, bold: element.bold, italic: element.italic, align: element.align };
  });
  if (![input.offsetX, input.offsetY].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20)) fail();
  if (typeof input.issueDate !== 'string' || (input.issueDate !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate) || !Number.isFinite(Date.parse(input.issueDate))))) fail();
  if (!input.awards || typeof input.awards !== 'object' || Array.isArray(input.awards) || Object.keys(input.awards).length > 10000) fail();
  const awards: Record<string, string> = {};
  for (const [key, award] of Object.entries(input.awards)) {
    if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(key) || typeof award !== 'string' || award.length > 500) fail();
    Object.defineProperty(awards, key, { value: award, enumerable: true });
  }
  const settings: Pick<CertificateDesign, 'issuePlace' | 'signerTitle' | 'signerName'> = {};
  for (const key of ['issuePlace', 'signerTitle', 'signerName'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key]!.length > 240) fail();
      settings[key] = input[key];
    }
  }
  return { version: 1, orientation: input.orientation, elements, issueDate: input.issueDate, offsetX: input.offsetX, offsetY: input.offsetY, awards, ...settings };
}
