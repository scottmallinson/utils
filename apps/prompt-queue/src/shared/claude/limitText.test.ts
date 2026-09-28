import { describe, expect, it } from 'vitest';
import { isUsageLimitMessage, parseResetTime } from './limitText';

// 12:00 UTC, which is 13:00 in London (BST) and 08:00 in New York (EDT).
const NOW = Date.UTC(2026, 8, 27, 12, 0);

describe('isUsageLimitMessage', () => {
  it.each([
    "You've hit your limit · resets 3pm (Europe/London)",
    'You’ve reached your weekly limit · resets Oct 3, 2pm',
    "You're out of extra usage · resets 5pm",
    'Claude AI usage limit reached|1760000000',
    '5-hour limit reached ∙ resets 3pm',
  ])('recognises %s', (text) => {
    expect(isUsageLimitMessage(text)).toBe(true);
  });

  it.each(['All done! The tests pass.', 'I hit a rate limit in the test suite', ''])(
    'ignores %s',
    (text) => {
      expect(isUsageLimitMessage(text)).toBe(false);
    },
  );
});

describe('parseResetTime', () => {
  it('reads epoch seconds from the old format', () => {
    expect(parseResetTime('Claude AI usage limit reached|1760000000', NOW)).toBe(1760000000000);
  });

  it('reads a time in a named zone', () => {
    expect(parseResetTime("You've hit your limit · resets 3pm (Europe/London)", NOW)).toBe(
      Date.UTC(2026, 8, 27, 14, 0),
    );
    expect(parseResetTime('resets 9:30am (America/New_York)', NOW)).toBe(
      Date.UTC(2026, 8, 27, 13, 30),
    );
  });

  it('rolls a time already past over to tomorrow', () => {
    expect(parseResetTime('resets 7am (America/New_York)', NOW)).toBe(Date.UTC(2026, 8, 28, 11, 0));
  });

  it('reads a date and time', () => {
    expect(parseResetTime('weekly limit · resets Oct 3, 2pm (UTC)', NOW)).toBe(
      Date.UTC(2026, 9, 3, 14, 0),
    );
    expect(parseResetTime('resets Oct 3 at 2:15pm (UTC)', NOW)).toBe(Date.UTC(2026, 9, 3, 14, 15));
  });

  it('uses local time when there is no zone', () => {
    const expected = new Date(NOW);
    expected.setHours(23, 0, 0, 0);
    if (expected.getTime() <= NOW) expected.setDate(expected.getDate() + 1);
    expect(parseResetTime('resets 11pm', NOW)).toBe(expected.getTime());
  });

  it('reads relative times', () => {
    expect(parseResetTime('resets in 2h 30m', NOW)).toBe(NOW + 150 * 60_000);
    expect(parseResetTime('resets in 45 minutes', NOW)).toBe(NOW + 45 * 60_000);
  });

  it('returns undefined when there is no time', () => {
    expect(parseResetTime("You've hit your limit", NOW)).toBeUndefined();
    expect(parseResetTime('resets 3 (UTC)', NOW)).toBeUndefined();
    expect(parseResetTime('resets 13pm', NOW)).toBeUndefined();
  });
});
