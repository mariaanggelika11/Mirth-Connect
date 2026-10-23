import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fallbackSession,
  readBrowserSession,
  sessionClock,
  sessionRemaining,
  shouldSendActivity,
} from '../src/services/sessionLifecycle';
afterEach(() => vi.restoreAllMocks());
describe('Browser session clock and activity policy', () => {
  it('validates authoritative metadata and rejects impossible or missing deadlines', () => {
    const session = fallbackSession(0);
    expect(readBrowserSession(session)).toEqual(session);
    expect(readBrowserSession({ ...session, warningSeconds: 900 })).toBeUndefined();
    expect(readBrowserSession({ ...session, idleTimeoutSeconds: Infinity })).toBeUndefined();
    expect(readBrowserSession({ ...session, absoluteExpiresAt: 'invalid' })).toBeUndefined();
    expect(readBrowserSession(undefined)).toBeUndefined();
  });
  it('honors server clock offset and the earliest idle or absolute limit', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const session = fallbackSession(60_000);
    const clock = sessionClock(session, 0);
    expect(sessionRemaining(clock, 0)).toBe(900_000);
    expect(sessionRemaining(clock, 840_000)).toBe(60_000);
    const absolute = sessionClock(
      { ...session, absoluteExpiresAt: new Date(120_000).toISOString() },
      0,
    );
    expect(sessionRemaining(absolute, 0)).toBe(60_000);
    expect(sessionRemaining(absolute, 60_000)).toBe(0);
  });
  it('uses monotonic elapsed time when a workstation clock is moved backwards', () => {
    const timer = vi.spyOn(performance, 'now').mockReturnValue(100);
    const clock = sessionClock(fallbackSession(0), 0);
    timer.mockReturnValue(60_100);
    expect(sessionRemaining(clock, -3_600_000)).toBe(840_000);
  });
  it('checks elapsed wall time after a suspended browser wakes even if monotonic time paused', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const clock = sessionClock(fallbackSession(0), 0);
    expect(sessionRemaining(clock, 3 * 86_400_000)).toBe(0);
  });
  it('throttles trusted activity to once per thirty seconds and permits explicit continuation', () => {
    expect(shouldSendActivity(100_000, 110_000)).toBe(false);
    expect(shouldSendActivity(100_000, 130_000)).toBe(true);
    expect(shouldSendActivity(100_000, 110_000, true)).toBe(true);
  });
  it('fallback starts with fifteen-minute idle and eight-hour absolute limits', () => {
    const first = fallbackSession(123_000);
    expect(Date.parse(first.idleExpiresAt) - Date.parse(first.serverTime)).toBe(900_000);
    expect(Date.parse(first.absoluteExpiresAt) - Date.parse(first.serverTime)).toBe(28_800_000);
  });
});
