import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export type ScheduleConfig = {
  schemaVersion: 1; name: string; timezone: string; autoContinue: boolean;
  windows: Array<{ id: string; localDate: string; fopId: string; startLocalTime: string; endLocalTime: string;
    enabled: boolean; breaks: Array<{ startLocalTime: string; endLocalTime: string }> }>;
  blocks: Array<{ id: string; groupKey: string; categoryIds: string[]; estimatedDurationSeconds?: number; turnaroundSeconds?: number }>;
  earliestStarts: Array<{ target: { matchId: string } | { blockId: string; stageKey: string }; notBefore: string }>;
  matchOrders: Array<{ categoryId: string; drawId: string; stageKey: string; orderedMatchIds: string[] }>;
  pinnedStarts: Array<{ matchId: string; startTime: string }>;
};
export const uid = () => crypto.randomUUID();
// Only prepare availability here. The backend still orders and places every match.
export function automaticScheduleConfig(config: ScheduleConfig, input: any): ScheduleConfig {
  const first = config.windows[0];
  if (!first?.localDate || !first.fopId || !config.blocks.length) return config;
  const categories = input.categories.filter((category: any) => config.blocks.some((block) => block.categoryIds.includes(category.id)));
  const endLocalTime = categories.map((category: any) => input.rules.find((rule: any) => rule.sportId === category.sportId)?.latestEnd || '22:00').sort().at(-1) || '22:00';
  return { ...config, autoContinue: true, windows: input.days.filter((day: string) => day >= first.localDate).map((localDate: string, index: number) => ({
    ...first, id: index === 0 ? first.id : `auto-${first.id}-${localDate}`, localDate, endLocalTime, enabled: true, breaks: [],
  })) };
}
export const navigateSchedule = (navigate: () => void) => {
  const event = new CustomEvent('sportdata:schedule-navigation', { cancelable: true, detail: navigate });
  if (window.dispatchEvent(event)) navigate();
};
export const localTime = (value: string | number, zone: string) => dayjs(value).tz(zone).format('HH:mm');
export const localDay = (value: string | number, zone: string) => dayjs(value).tz(zone).format('YYYY-MM-DD');
export const localDateTime = (value: string | number, zone: string) => dayjs(value).tz(zone).format('HH:mm DD/MM/YYYY');
export const localISO = (day: string, time: string, zone: string) => dayjs.tz(`${day} ${time}`, zone).toISOString();
export const clearMatchStart = (config: ScheduleConfig, matchId: string): ScheduleConfig => ({ ...config,
  pinnedStarts: config.pinnedStarts.filter((pin) => pin.matchId !== matchId),
  earliestStarts: config.earliestStarts.filter((marker) => !('matchId' in marker.target && marker.target.matchId === matchId)),
});
export function updateMatchStart(config: ScheduleConfig, matchId: string, instant: string, fixed: boolean): ScheduleConfig {
  const cleared = clearMatchStart(config, matchId);
  return fixed ? { ...cleared, pinnedStarts: [...cleared.pinnedStarts, { matchId, startTime: instant }] }
    : { ...cleared, earliestStarts: [...cleared.earliestStarts, { target: { matchId }, notBefore: instant }] };
}
export const errorText = (error: any) => {
  const value = error?.response?.data?.message || error?.message || 'Không thể kết nối. Bản nháp vẫn được giữ.';
  return Array.isArray(value) ? value.join(', ') : value;
};
export const stageLabel = (key: string, round?: number) => key.startsWith('REP_') || key.startsWith('LOWER_')
  ? round ? `Vòng ${round} – Nhánh thua` : 'Nhánh thua'
  : ({ F: 'Chung kết', SF: 'Bán kết', QF: 'Tứ kết', BRONZE: 'Tranh HCĐ',
  GRAND_FINAL: 'Chung kết toàn giải', R64: 'Vòng 64 người · 1/32', R32: 'Vòng 32 người · 1/16', R16: 'Vòng 16 người · 1/8' }[key]
  || (key.startsWith('POOL_') ? `Vòng bảng ${key.slice(5)}` : key.startsWith('HEAT_') ? `Lượt vòng ${key.slice(5)}`
    : key));
export const groupLabel = (category: any) => [category.discipline === 'NEWAZA' ? category.uniform === 'NO_GI' ? 'No-GI' : 'GI'
  : ({ FIGHTING: 'Fighting', DUO: 'Duo', SHOW: 'Show' }[category.discipline] || category.discipline || 'Nội dung chưa phân loại'),
  { MALE: 'Nam', FEMALE: 'Nữ', MIXED: 'Hỗn hợp' }[category.gender],
  category.minAge != null || category.maxAge != null ? `${category.minAge ?? '…'}–${category.maxAge ?? '…'} tuổi` : '', category.beltLevel].filter(Boolean).join(' · ');
