import type { Request } from 'express';
import { withTransaction, type DatabaseTransaction } from '../config/db.js';
import { config } from '../config/env.js';
import { audit } from './audit.services.js';
import { AppError } from '../utils/errors.js';

export interface BrowserSessionMetadata {
  idleTimeoutSeconds: number;
  warningSeconds: number;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  serverTime: string;
}
export interface BrowserSessionFamily {
  family_id: string;
  user_id: number;
  created_at: Date | string;
  expires_at: Date | string;
  last_activity_at: Date | string;
  revoked_at: Date | string | null;
}
export function sessionMetadata(
  row: BrowserSessionFamily,
  now = Date.now(),
): BrowserSessionMetadata {
  const absolute = Math.min(
    new Date(row.expires_at).getTime(),
    new Date(row.created_at).getTime() + config.auth.absoluteExpiration * 1000,
  );
  return {
    idleTimeoutSeconds: config.auth.idleExpiration,
    warningSeconds: config.auth.warningSeconds,
    idleExpiresAt: new Date(
      Math.min(
        absolute,
        new Date(row.last_activity_at).getTime() + config.auth.idleExpiration * 1000,
      ),
    ).toISOString(),
    absoluteExpiresAt: new Date(absolute).toISOString(),
    serverTime: new Date(now).toISOString(),
  };
}
export async function lockFamily(tx: DatabaseTransaction, family: string) {
  await tx
    .request()
    .input('family', family)
    .query("SELECT pg_advisory_xact_lock(hashtextextended('session:' || @family,0))");
}
export async function revokeFamily(tx: DatabaseTransaction, family: string) {
  await tx
    .request()
    .input('family', family)
    .query(
      'UPDATE "BrowserSessionFamilies" SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE family_id=@family',
    );
  await tx
    .request()
    .input('family', family)
    .query(
      'UPDATE "BrowserSessions" SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE family_id=@family',
    );
}
export async function readFamily(tx: DatabaseTransaction, family: string, user: number) {
  return (
    await tx
      .request()
      .input('family', family)
      .input('user', user)
      .query<BrowserSessionFamily>(
        'SELECT family_id,user_id,created_at,expires_at,last_activity_at,revoked_at FROM "BrowserSessionFamilies" WHERE family_id=@family AND user_id=@user FOR UPDATE',
      )
  ).recordset[0];
}
export async function checkFamily(
  tx: DatabaseTransaction,
  req: Request,
  row: BrowserSessionFamily | undefined,
  now = Date.now(),
) {
  if (!row || row.revoked_at) return { code: 'SESSION_INVALID' } as const;
  // Invalid persisted dates must fail closed, never construct a usable browser session.
  if (
    ![row.created_at, row.expires_at, row.last_activity_at].every((value) =>
      Number.isFinite(new Date(value).getTime()),
    )
  )
    return { code: 'SESSION_INVALID' } as const;
  const metadata = sessionMetadata(row, now);
  const code =
    new Date(metadata.absoluteExpiresAt).getTime() <= now
      ? 'SESSION_ABSOLUTE_EXPIRED'
      : new Date(metadata.idleExpiresAt).getTime() <= now
        ? 'SESSION_IDLE_EXPIRED'
        : undefined;
  if (code) {
    await revokeFamily(tx, row.family_id);
    await audit(code, req, 'user', row.user_id, tx);
    // Return the failure so the revocation and audit commit before emitting HTTP 401.
    return { code };
  }
  return { session: metadata };
}
export function sessionError(code: string) {
  return new AppError(
    401,
    code,
    code === 'SESSION_IDLE_EXPIRED'
      ? 'Session ended after inactivity. Please sign in again.'
      : code === 'SESSION_ABSOLUTE_EXPIRED'
        ? 'Session reached its time limit. Please sign in again.'
        : 'Session invalid or expired. Please sign in again.',
  );
}
export async function enforceBrowserSession(req: Request, family: string, user: number) {
  const result = await withTransaction(async (tx) => {
    await lockFamily(tx, family);
    return checkFamily(tx, req, await readFamily(tx, family, user));
  });
  if (!result.session) throw sessionError(result.code);
  req.browserSession = { familyId: family, ...result.session };
}
