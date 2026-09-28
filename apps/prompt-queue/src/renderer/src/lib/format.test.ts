import { describe, expect, it } from 'vitest';
import { formatAgo, formatCost, formatDuration, formatTime } from './format';

const NOW = Date.UTC(2026, 8, 27, 12, 0); // A Sunday.
const utc = { locale: 'en-GB', timeZone: 'UTC' };

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [42_000, '42s'],
    [12 * 60_000 + 5_000, '12m'],
    [65 * 60_000, '1h 5m'],
    [2 * 3_600_000, '2h'],
    [51 * 3_600_000, '2d 3h'],
    [-5, '0s'],
  ])('%d → %s', (ms, expected) => expect(formatDuration(ms)).toBe(expected));
});

describe('formatAgo', () => {
  it('describes elapsed time', () => {
    expect(formatAgo(NOW - 10_000, NOW)).toBe('just now');
    expect(formatAgo(NOW - 5 * 60_000, NOW)).toBe('5m ago');
  });
});

describe('formatTime', () => {
  it('adds the day only when needed', () => {
    expect(formatTime(Date.UTC(2026, 8, 27, 15, 5), NOW, utc)).toBe('15:05');
    expect(formatTime(Date.UTC(2026, 8, 29, 9, 0), NOW, utc)).toBe('Tue 09:00');
    expect(formatTime(Date.UTC(2026, 9, 10, 14, 0), NOW, utc)).toBe('10 Oct, 14:00');
  });
});

describe('formatCost', () => {
  it('shows estimated dollars', () => {
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(1.234)).toBe('~$1.23');
  });
});
