/** Browser session metadata contains deadlines only; credentials never enter storage or messages. */
export interface BrowserSession {
  idleTimeoutSeconds: number;
  warningSeconds: number;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  serverTime: string;
}
export interface SessionClock {
  session: BrowserSession;
  offsetMs: number;
  receivedAt: number;
  monotonicAt: number;
}
export const ACTIVITY_THROTTLE_MS = 30_000;
export function readBrowserSession(value: unknown): BrowserSession | undefined {
  if (!value || typeof value !== 'object') return;
  const item = value as Record<string, unknown>;
  if (
    typeof item.idleTimeoutSeconds !== 'number' ||
    !Number.isFinite(item.idleTimeoutSeconds) ||
    item.idleTimeoutSeconds <= 0 ||
    typeof item.warningSeconds !== 'number' ||
    !Number.isFinite(item.warningSeconds) ||
    item.warningSeconds < 0 ||
    item.warningSeconds >= item.idleTimeoutSeconds ||
    !['idleExpiresAt', 'absoluteExpiresAt', 'serverTime'].every(
      (key) => typeof item[key] === 'string' && Number.isFinite(Date.parse(item[key] as string)),
    )
  )
    return;
  return item as unknown as BrowserSession;
}
export function sessionClock(session: BrowserSession, receivedAt = Date.now()): SessionClock {
  return {
    session,
    offsetMs: Date.parse(session.serverTime) - receivedAt,
    receivedAt,
    monotonicAt: performance.now(),
  };
}
export function sessionServerNow(clock: SessionClock, now = Date.now()) {
  const elapsed = Math.max(0, now - clock.receivedAt, performance.now() - clock.monotonicAt);
  return clock.receivedAt + clock.offsetMs + elapsed;
}
export function sessionRemaining(clock: SessionClock, now = Date.now()) {
  const serverNow = sessionServerNow(clock, now);
  return Math.max(
    0,
    Math.min(Date.parse(clock.session.idleExpiresAt), Date.parse(clock.session.absoluteExpiresAt)) -
      serverNow,
  );
}
/** Compatibility only for an older server response; repeated reads never extend this clock. */
export function fallbackSession(now = Date.now()): BrowserSession {
  return {
    idleTimeoutSeconds: 900,
    warningSeconds: 60,
    idleExpiresAt: new Date(now + 900_000).toISOString(),
    absoluteExpiresAt: new Date(now + 28_800_000).toISOString(),
    serverTime: new Date(now).toISOString(),
  };
}
export function shouldSendActivity(lastSent: number, now: number, force = false) {
  return force || now - lastSent >= ACTIVITY_THROTTLE_MS;
}
