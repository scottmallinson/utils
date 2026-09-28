import type { LimitWindow, ToolLimits } from './types';

/** A tool's report about one usage-limit window, normalised from its own format. */
export interface LimitReport {
  /** The tool's window name, e.g. `five_hour` or `seven_day`. */
  window: string;
  status: LimitWindow['status'];
  /** Percentage used, 0-100. */
  utilization?: number;
  /** When the window resets, ms since epoch. */
  resetsAt?: number;
}

/** Wait this long after a reported reset before trying again, to allow for clock skew. */
export const RESET_GRACE_MS = 60_000;
/** If a limit is hit and the tool doesn't say when it resets, try again after this long. */
export const UNKNOWN_RESET_PAUSE_MS = 60 * 60_000;
/** Forget windows with no reset time after this long. */
const STALE_WINDOW_MS = 7 * 24 * 60 * 60_000;

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly Opus',
  seven_day_sonnet: 'Weekly Sonnet',
  seven_day_overage_included: 'Weekly extra usage',
  overage: 'Extra usage',
  usage: 'Usage',
};

/** The windows shown even before the tool has reported on them. */
export const PRIMARY_WINDOWS = ['five_hour', 'seven_day'] as const;

export function windowLabel(window: string): string {
  return WINDOW_LABELS[window] ?? window.replace(/_/g, ' ');
}

export function applyLimitReport(limits: ToolLimits, report: LimitReport, now: number): ToolLimits {
  const previous = limits.windows[report.window];
  // Usage only goes up within a window, so keep what we knew until it resets.
  const sameWindow =
    previous?.resetsAt !== undefined &&
    previous.resetsAt > now &&
    (report.resetsAt === undefined || report.resetsAt === previous.resetsAt);
  const window: LimitWindow = {
    status: report.status,
    utilization:
      report.utilization ??
      (report.status === 'limited' ? 100 : sameWindow ? previous?.utilization : undefined),
    resetsAt: report.resetsAt ?? (sameWindow ? previous?.resetsAt : undefined),
    updatedAt: now,
  };
  const next: ToolLimits = { ...limits, windows: { ...limits.windows, [report.window]: window } };
  if (report.status === 'limited') {
    next.pausedUntil = Math.max(
      limits.pausedUntil ?? 0,
      (window.resetsAt ?? now + UNKNOWN_RESET_PAUSE_MS) + RESET_GRACE_MS,
    );
    next.pausedReason = `${windowLabel(report.window)} limit reached`;
  }
  return next;
}

/** Pauses a tool after it reported hitting a limit without saying which window. */
export function pauseForLimit(
  limits: ToolLimits,
  resetsAt: number | undefined,
  now: number,
): ToolLimits {
  if (limits.pausedUntil !== undefined && limits.pausedUntil > now) return limits;
  return applyLimitReport(limits, { window: 'usage', status: 'limited', resetsAt }, now);
}

/** Drops windows that have reset and pauses that have passed. */
export function effectiveLimits(limits: ToolLimits, now: number): ToolLimits {
  const windows: Record<string, LimitWindow> = {};
  for (const [key, window] of Object.entries(limits.windows)) {
    const expired =
      window.resetsAt !== undefined
        ? window.resetsAt <= now
        : window.updatedAt + STALE_WINDOW_MS <= now;
    if (!expired) windows[key] = window;
  }
  if (limits.pausedUntil !== undefined && limits.pausedUntil > now) {
    return { windows, pausedUntil: limits.pausedUntil, pausedReason: limits.pausedReason };
  }
  return { windows };
}

/** The most-used window with a known utilisation, if any. */
export function busiestWindow(
  limits: ToolLimits,
): { window: string; utilization: number } | undefined {
  let busiest: { window: string; utilization: number } | undefined;
  for (const [window, { utilization }] of Object.entries(limits.windows)) {
    if (utilization !== undefined && (!busiest || utilization > busiest.utilization)) {
      busiest = { window, utilization };
    }
  }
  return busiest;
}

/** The next time something about these limits changes (a reset or the end of a pause). */
export function nextLimitChange(limits: ToolLimits, now: number): number | undefined {
  const times = [
    limits.pausedUntil,
    ...Object.values(limits.windows).map((window) => window.resetsAt),
  ].filter((time): time is number => time !== undefined && time > now);
  return times.length > 0 ? Math.min(...times) : undefined;
}
