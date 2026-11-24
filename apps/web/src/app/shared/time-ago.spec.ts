import { timeAgo } from './time-ago.pipe';

describe('timeAgo', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  it('formats relative times', () => {
    expect(timeAgo('2026-11-04T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-11-04T11:55:00Z', now)).toBe('5 minutes ago');
    expect(timeAgo('2026-11-03T10:00:00Z', now)).toBe('yesterday');
    expect(timeAgo(null, now)).toBe('');
  });
});
