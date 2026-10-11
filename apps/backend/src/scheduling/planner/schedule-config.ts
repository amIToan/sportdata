export type ScheduleConfig = {
  schemaVersion: 1;
  name: string;
  timezone: string;
  autoContinue: boolean;
  windows: Array<{ id: string; localDate: string; fopId: string; startLocalTime: string; endLocalTime: string;
    enabled: boolean; breaks: Array<{ startLocalTime: string; endLocalTime: string }> }>;
  blocks: Array<{ id: string; groupKey: string; categoryIds: string[];
    estimatedDurationSeconds?: number; turnaroundSeconds?: number }>;
  earliestStarts: Array<{ target: { matchId: string } | { blockId: string; stageKey: string }; notBefore: string }>;
  matchOrders: Array<{ categoryId: string; drawId: string; stageKey: string; orderedMatchIds: string[] }>;
  pinnedStarts: Array<{ matchId: string; startTime: string }>;
};

export function localDay(value: Date | string | number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(value));
}

export function localInstant(day: string, time: string, timezone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Ngày/giờ không hợp lệ.');
  const wall = Date.parse(`${day}T${time}:00Z`);
  const format = (instant: number) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  let instant = wall;
  for (let i = 0; i < 3; i += 1) {
    const parts = format(instant);
    const rendered = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    instant += wall - rendered;
  }
  const parts = format(instant);
  if (`${parts.year}-${parts.month}-${parts.day}` !== day || `${parts.hour}:${parts.minute}` !== time) {
    throw new Error('Giờ địa phương không tồn tại trong múi giờ này.');
  }
  // An ambiguous wall clock must be made explicit instead of silently selecting
  // an occurrence at a daylight-saving transition.
  if ([-3600000, 3600000, -1800000, 1800000].some((offset) => {
    const other = format(instant + offset);
    return `${other.year}-${other.month}-${other.day}T${other.hour}:${other.minute}` === `${day}T${time}`;
  })) throw new Error('Giờ địa phương bị trùng do đổi múi giờ; chọn giờ khác.');
  return instant;
}

export function eventDays(start: Date | string, end: Date | string, timezone: string): string[] {
  const first = localDay(start, timezone);
  const last = localDay(end, timezone);
  const result: string[] = [];
  for (let cursor = Date.parse(`${first}T12:00:00Z`); cursor <= Date.parse(`${last}T12:00:00Z`); cursor += 86400000) {
    result.push(new Date(cursor).toISOString().slice(0, 10)); // UTC date arithmetic on an already-local day key.
  }
  return result;
}

export function assertScheduleConfig(config: unknown, complete = true): asserts config is ScheduleConfig {
  const object = config as ScheduleConfig;
  if (!object || typeof object !== 'object' || Array.isArray(object) || JSON.stringify(object).length > 1000000
    || object.schemaVersion !== 1 || typeof object.name !== 'string' || object.name.length > 200
    || (complete && !object.name.trim()) || typeof object.timezone !== 'string'
    || typeof object.autoContinue !== 'boolean') throw new Error('Cấu hình lịch không hợp lệ.');
  new Intl.DateTimeFormat('en', { timeZone: object.timezone });
  const string = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 500;
  for (const field of ['windows', 'blocks', 'earliestStarts', 'matchOrders', 'pinnedStarts']) {
    if (!Array.isArray(object[field]) || object[field].length > 20000) throw new Error(`Danh sách ${field} không hợp lệ.`);
  }
  if (complete && (!object.windows.length || !object.blocks.length)) throw new Error('Chọn nội dung và ngày/thảm để xem trước.');
  for (const window of object.windows) {
    if (!window || !string(window.id) || typeof window.enabled !== 'boolean' || !Array.isArray(window.breaks)
      || window.breaks.length > 100 || ![window.localDate, window.fopId, window.startLocalTime, window.endLocalTime]
        .every((value) => typeof value === 'string' && (!complete || string(value)))) throw new Error('Cửa sổ thi đấu không hợp lệ.');
    for (const pause of window.breaks) if (!pause || !string(pause.startLocalTime) || !string(pause.endLocalTime)) throw new Error('Khoảng nghỉ không hợp lệ.');
  }
  for (const block of object.blocks) {
    if (!block || !string(block.id) || !string(block.groupKey) || !Array.isArray(block.categoryIds)
      || !block.categoryIds.every(string) || (complete && !block.categoryIds.length)) throw new Error('Nội dung/hạng đấu không hợp lệ.');
    if (block.estimatedDurationSeconds !== undefined && (!Number.isInteger(block.estimatedDurationSeconds)
      || block.estimatedDurationSeconds < 1 || block.estimatedDurationSeconds > 43200)) throw new Error('Thời lượng trận không hợp lệ.');
    if (block.turnaroundSeconds !== undefined && (!Number.isInteger(block.turnaroundSeconds)
      || block.turnaroundSeconds < 0 || block.turnaroundSeconds > 10800)) throw new Error('Thời gian chuyển trận không hợp lệ.');
  }
  if (new Set(object.blocks.map((block) => block.id)).size !== object.blocks.length) throw new Error('Mã nội dung bị trùng.');
  for (const order of object.matchOrders) if (!order || ![order.categoryId, order.drawId, order.stageKey].every(string)
    || !Array.isArray(order.orderedMatchIds) || !order.orderedMatchIds.every(string)) throw new Error('Thứ tự trận không hợp lệ.');
  for (const marker of object.earliestStarts) if (!marker?.target
    || !(/^\d{4}-.*(?:Z|[+-]\d\d:\d\d)$/.test(marker.notBefore)) || !Number.isFinite(Date.parse(marker.notBefore))
    || !('matchId' in marker.target ? string(marker.target.matchId) : string(marker.target.blockId) && string(marker.target.stageKey))) throw new Error('Mốc sớm nhất không hợp lệ.');
  for (const pin of object.pinnedStarts) if (!pin || !string(pin.matchId)
    || !(/^\d{4}-.*(?:Z|[+-]\d\d:\d\d)$/.test(pin.startTime)) || !Number.isFinite(Date.parse(pin.startTime))) throw new Error('Mốc cố định không hợp lệ.');
}
