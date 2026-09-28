// Claude Code reports a reached usage limit as text, e.g.
//   "You've hit your limit · resets 3pm (Europe/London)"
//   "5-hour limit reached ∙ resets 3pm"
//   "Claude AI usage limit reached|1760000000"   (older versions: epoch seconds)
// The structured `rate_limit_event` is preferred; this is the fallback.

const LIMIT_PATTERN =
  /^\s*(?:you['’]ve (?:hit|reached) your|you['’]re out of (?:usage credits|extra usage))|usage limit reached|limit reached\s*[·∙•|-]\s*resets/i;

export function isUsageLimitMessage(text: string): boolean {
  return LIMIT_PATTERN.test(text);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const DAY_MS = 24 * 60 * 60_000;

/**
 * Finds when a limit resets from Claude Code's message. Times without a zone
 * are local. Returns ms since epoch, or undefined if the text doesn't say.
 */
export function parseResetTime(text: string, now: number): number | undefined {
  const epoch = /\|\s*(\d{10,13})\s*$/.exec(text);
  if (epoch?.[1]) {
    const value = Number(epoch[1]);
    return value < 1e12 ? value * 1000 : value;
  }

  const relative =
    /resets in\s+(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i.exec(text);
  if (relative && (relative[1] || relative[2])) {
    return now + (Number(relative[1] ?? 0) * 60 + Number(relative[2] ?? 0)) * 60_000;
  }

  const match =
    /resets\s+(?:at\s+|on\s+)?(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i.exec(
      text,
    );
  if (!match) return undefined;
  const [, monthName, dayText, hourText, minuteText, meridiem, zone] = match;
  let hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  } else if (!minuteText) {
    return undefined; // A bare number isn't a time.
  }
  if (hour > 23 || minute > 59) return undefined;

  const timeZone = zone && isValidTimeZone(zone.trim()) ? zone.trim() : undefined;
  const today = datePartsIn(now, timeZone);
  const month = monthName ? MONTHS.indexOf(monthName.toLowerCase()) : today.month;
  if (month < 0) return undefined;
  const day = dayText ? Number(dayText) : today.day;

  let result = wallTimeToEpoch({ year: today.year, month, day, hour, minute }, timeZone);
  if (!monthName && result <= now) result += DAY_MS;
  if (monthName && result < now - DAY_MS) {
    result = wallTimeToEpoch({ year: today.year + 1, month, day, hour, minute }, timeZone);
  }
  return result;
}

interface WallTime {
  year: number;
  /** 0-based. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function datePartsIn(time: number, timeZone: string | undefined): WallTime {
  if (!timeZone) {
    const date = new Date(time);
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
      .formatToParts(time)
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year ?? 0,
    month: (parts.month ?? 1) - 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
  };
}

function wallTimeToEpoch(wall: WallTime, timeZone: string | undefined): number {
  if (!timeZone) {
    return new Date(wall.year, wall.month, wall.day, wall.hour, wall.minute).getTime();
  }
  // Treat the wall time as UTC, then correct by the zone's offset at that moment.
  const asUtc = Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute);
  const shown = datePartsIn(asUtc, timeZone);
  const offset = Date.UTC(shown.year, shown.month, shown.day, shown.hour, shown.minute) - asUtc;
  return asUtc - offset;
}
