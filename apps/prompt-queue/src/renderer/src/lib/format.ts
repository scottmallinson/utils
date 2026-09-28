export interface FormatOptions {
  locale?: string;
  timeZone?: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 42s, 12m, 1h 5m, 2d 3h. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, ms);
  if (total < MINUTE) return `${Math.floor(total / 1000)}s`;
  if (total < HOUR) return `${Math.floor(total / MINUTE)}m`;
  if (total < DAY) {
    const hours = Math.floor(total / HOUR);
    const minutes = Math.floor((total % HOUR) / MINUTE);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(total / DAY);
  const hours = Math.floor((total % DAY) / HOUR);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

/** "just now", "5m ago", "3d ago". */
export function formatAgo(time: number, now: number): string {
  const elapsed = now - time;
  return elapsed < MINUTE ? 'just now' : `${formatDuration(elapsed)} ago`;
}

/** A clock time, with the day when it isn't today: "15:05", "Tue 09:00", "3 Oct, 14:00". */
export function formatTime(time: number, now: number, options: FormatOptions = {}): string {
  const { locale, timeZone } = options;
  const clock: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone };
  const dayKey = (t: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(t);
  if (dayKey(time) === dayKey(now)) return new Intl.DateTimeFormat(locale, clock).format(time);
  if (Math.abs(time - now) < 6 * DAY) {
    return new Intl.DateTimeFormat(locale, { ...clock, weekday: 'short' }).format(time);
  }
  return new Intl.DateTimeFormat(locale, { ...clock, day: 'numeric', month: 'short' }).format(time);
}

/**
 * Claude Code's cost figure is an estimate at API prices; on a subscription it's
 * a sense of size, not a bill. Hence the "~".
 */
export function formatCost(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `~$${usd.toFixed(2)}`;
}
