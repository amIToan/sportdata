import dayjs from 'dayjs';

// A clock time is local to the schedule, not a timestamp to convert to UTC.
export function parseLocalTime(value?: string | null) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return dayjs(`2000-01-01T${value}:00`);
}
