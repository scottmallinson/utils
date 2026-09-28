import { describe, expect, it } from 'vitest';
import {
  applyLimitReport,
  busiestWindow,
  effectiveLimits,
  nextLimitChange,
  pauseForLimit,
  RESET_GRACE_MS,
  UNKNOWN_RESET_PAUSE_MS,
  windowLabel,
} from './limits';
import type { ToolLimits } from './types';

const NOW = Date.UTC(2026, 8, 27, 12, 0);
const HOUR = 3_600_000;
const empty: ToolLimits = { windows: {} };

describe('applyLimitReport', () => {
  it('records warnings', () => {
    const limits = applyLimitReport(
      empty,
      { window: 'five_hour', status: 'warning', utilization: 75, resetsAt: NOW + HOUR },
      NOW,
    );
    expect(limits).toEqual({
      windows: {
        five_hour: { status: 'warning', utilization: 75, resetsAt: NOW + HOUR, updatedAt: NOW },
      },
    });
  });

  it('keeps known usage for the same window when a report leaves it out', () => {
    const warned = applyLimitReport(
      empty,
      { window: 'five_hour', status: 'warning', utilization: 75, resetsAt: NOW + HOUR },
      NOW,
    );
    const allowed = applyLimitReport(warned, { window: 'five_hour', status: 'ok' }, NOW + 1000);
    expect(allowed.windows.five_hour).toMatchObject({ status: 'ok', utilization: 75 });
    // A new window starts afresh.
    const next = applyLimitReport(
      warned,
      { window: 'five_hour', status: 'ok', resetsAt: NOW + 6 * HOUR },
      NOW + 1000,
    );
    expect(next.windows.five_hour?.utilization).toBeUndefined();
  });

  it('pauses the tool until a limit resets', () => {
    const limits = applyLimitReport(
      empty,
      { window: 'seven_day', status: 'limited', resetsAt: NOW + 48 * HOUR },
      NOW,
    );
    expect(limits.windows.seven_day).toMatchObject({ status: 'limited', utilization: 100 });
    expect(limits.pausedUntil).toBe(NOW + 48 * HOUR + RESET_GRACE_MS);
    expect(limits.pausedReason).toBe('Weekly limit reached');
  });

  it('pauses for a while when the reset time is unknown', () => {
    const limits = pauseForLimit(empty, undefined, NOW);
    expect(limits.pausedUntil).toBe(NOW + UNKNOWN_RESET_PAUSE_MS + RESET_GRACE_MS);
    // An existing pause wins.
    expect(pauseForLimit(limits, NOW + 10 * HOUR, NOW)).toBe(limits);
  });
});

describe('effectiveLimits', () => {
  it('drops windows that have reset and pauses that have ended', () => {
    const limits: ToolLimits = {
      windows: {
        five_hour: {
          status: 'limited',
          utilization: 100,
          resetsAt: NOW - 1,
          updatedAt: NOW - HOUR,
        },
        seven_day: { status: 'warning', utilization: 60, resetsAt: NOW + HOUR, updatedAt: NOW },
      },
      pausedUntil: NOW - 1,
      pausedReason: '5-hour limit reached',
    };
    expect(effectiveLimits(limits, NOW)).toEqual({
      windows: { seven_day: limits.windows.seven_day },
    });
  });
});

describe('busiestWindow and nextLimitChange', () => {
  const limits: ToolLimits = {
    windows: {
      five_hour: { status: 'warning', utilization: 55, resetsAt: NOW + 2 * HOUR, updatedAt: NOW },
      seven_day: { status: 'warning', utilization: 80, resetsAt: NOW + 50 * HOUR, updatedAt: NOW },
      overage: { status: 'ok', updatedAt: NOW },
    },
    pausedUntil: NOW + HOUR,
  };

  it('finds the most used window', () => {
    expect(busiestWindow(limits)).toEqual({ window: 'seven_day', utilization: 80 });
    expect(busiestWindow(empty)).toBeUndefined();
  });

  it('finds the next reset or end of pause', () => {
    expect(nextLimitChange(limits, NOW)).toBe(NOW + HOUR);
    expect(nextLimitChange(limits, NOW + HOUR)).toBe(NOW + 2 * HOUR);
    expect(nextLimitChange(empty, NOW)).toBeUndefined();
  });
});

describe('windowLabel', () => {
  it('names known windows', () => {
    expect(windowLabel('five_hour')).toBe('5-hour');
    expect(windowLabel('seven_day_opus')).toBe('Weekly Opus');
    expect(windowLabel('some_new_one')).toBe('some new one');
  });
});
