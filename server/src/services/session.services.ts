import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/env.js';
import { withTransaction, getConnection } from '../config/db.js';
import { audit } from './audit.services.js';
import { signToken, AuthService } from './auth.services.js';
import { AppError } from '../utils/errors.js';
import { normalizeRole } from '../middleware/auth.js';
import {
  checkFamily,
  lockFamily,
  readFamily,
  revokeFamily,
  sessionError,
  sessionMetadata,
} from './sessionPolicy.services.js';
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export function cookie(req: Request, name: string) {
  const value = req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + '='));
  return value ? value.slice(name.length + 1) : '';
}
const refreshCookie = 'mirth_refresh';
const csrfCookie = 'mirth_csrf';
export function sessionCookies(
  res: Response,
  refresh: string,
  csrf: string,
  absoluteExpiresAt = new Date(Date.now() + config.auth.absoluteExpiration * 1000).toISOString(),
) {
  const options = {
    secure: config.production,
    sameSite: 'strict' as const,
    maxAge: Math.max(
      0,
      Math.min(
        config.auth.refreshExpiration * 1000,
        new Date(absoluteExpiresAt).getTime() - Date.now(),
      ),
    ),
  };
  res.cookie(refreshCookie, refresh, { ...options, httpOnly: true, path: '/api/auth/browser' });
  res.cookie(csrfCookie, csrf, { ...options, httpOnly: false, path: '/' });
  res.set('Cache-Control', 'no-store');
}
function clearCookies(res: Response) {
  res.set('Cache-Control', 'no-store');
  res.clearCookie(refreshCookie, {
    path: '/api/auth/browser',
    secure: config.production,
    sameSite: 'strict',
  });
  res.clearCookie(csrfCookie, { path: '/', secure: config.production, sameSite: 'strict' });
}
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  const origin = req.get('Origin');
  const supplied = req.get('X-CSRF-Token') || '';
  const expected = cookie(req, csrfCookie);
  const a = Buffer.from(supplied),
    b = Buffer.from(expected);
  if (
    (origin && !config.cors.allowedOrigins.includes(origin)) ||
    !b.length ||
    a.length !== b.length ||
    !timingSafeEqual(a, b)
  )
    return next(new AppError(403, 'CSRF_REJECTED', 'Session request could not be verified'));
  next();
}
export async function browserLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await AuthService.login(req.body.username, req.body.password);
    const refresh = randomBytes(32).toString('hex'),
      csrf = randomBytes(32).toString('hex'),
      family = randomUUID();
    const now = new Date(Date.now());
    const familyRow = {
      family_id: family,
      user_id: result.id,
      created_at: now,
      expires_at: new Date(now.getTime() + config.auth.absoluteExpiration * 1000),
      last_activity_at: now,
      revoked_at: null,
    };
    const user = await withTransaction(async (tx) => {
      const user = (
        await tx
          .request()
          .input('id', result.id)
          .query('SELECT id,name,role FROM "Users" WHERE id=@id')
      ).recordset[0];
      if (!user) throw new AppError(401, 'SESSION_INVALID', 'Session invalid');
      await tx
        .request()
        .input('family', family)
        .input('user', result.id)
        .input('created', now)
        .input('expires', familyRow.expires_at)
        .query(
          'INSERT INTO "BrowserSessionFamilies"(family_id,user_id,created_at,expires_at,last_activity_at) VALUES(@family,@user,@created,@expires,@created)',
        );
      await tx
        .request()
        .input('token', hashToken(refresh))
        .input('family', family)
        .input('user', result.id)
        .input('csrf', hashToken(csrf))
        .input('expires', familyRow.expires_at)
        .query(
          'INSERT INTO "BrowserSessions"(token_hash,family_id,user_id,csrf_hash,expires_at) VALUES(@token,@family,@user,@csrf,@expires)',
        );
      req.user = { id: user.id, name: user.name, role: normalizeRole(user.role) };
      await audit('BROWSER_LOGIN', req, 'user', result.id, tx);
      return user;
    });
    const session = sessionMetadata(familyRow);
    sessionCookies(res, refresh, csrf, session.absoluteExpiresAt);
    res.json({
      token: signToken({ id: user.id, name: user.name, role: user.role }, family),
      csrfToken: csrf,
      session,
    });
  } catch (error) {
    next(error);
  }
}
export async function browserRefresh(req: Request, res: Response, next: NextFunction) {
  try {
    const token = cookie(req, refreshCookie),
      csrf = cookie(req, csrfCookie);
    const refresh = randomBytes(32).toString('hex');
    const result = await withTransaction(async (tx) => {
      await tx
        .request()
        .input('token', hashToken(token))
        .query(
          'SELECT pg_advisory_xact_lock(hashtextextended(\'session:\' || family_id,0)) FROM "BrowserSessions" WHERE token_hash=@token',
        );
      const row = (
        await tx
          .request()
          .input('token', hashToken(token))
          .query(
            'SELECT s.*,u.name,u.role FROM "BrowserSessions" s JOIN "Users" u ON u.id=s.user_id WHERE s.token_hash=@token FOR UPDATE OF s',
          )
      ).recordset[0];
      if (!row || row.revoked_at || row.csrf_hash !== hashToken(csrf))
        return { code: 'SESSION_INVALID' };
      req.user = { id: row.user_id, name: row.name, role: normalizeRole(row.role) };
      const checked = await checkFamily(tx, req, await readFamily(tx, row.family_id, row.user_id));
      if (!checked.session) return checked;
      if (new Date(row.expires_at).getTime() <= Date.now()) return { code: 'SESSION_INVALID' };
      if (row.used_at) {
        await revokeFamily(tx, row.family_id);
        await audit('REFRESH_REUSE', req, 'user', row.user_id, tx);
        return { code: 'SESSION_INVALID' }; // Commit revocation before returning an authentication error.
      }
      await tx
        .request()
        .input('token', row.token_hash)
        .query('UPDATE "BrowserSessions" SET used_at=CURRENT_TIMESTAMP WHERE token_hash=@token');
      await tx
        .request()
        .input('token', hashToken(refresh))
        .input('family', row.family_id)
        .input('user', row.user_id)
        .input('csrf', row.csrf_hash)
        .input('expires', new Date(checked.session.absoluteExpiresAt))
        .query(
          'INSERT INTO "BrowserSessions"(token_hash,family_id,user_id,csrf_hash,expires_at) VALUES(@token,@family,@user,@csrf,@expires)',
        );
      await audit('REFRESH_SESSION', req, 'user', row.user_id, tx);
      return { row, session: checked.session };
    });
    if (!('row' in result)) {
      clearCookies(res);
      throw sessionError(result.code || 'SESSION_INVALID');
    }
    sessionCookies(res, refresh, csrf, result.session.absoluteExpiresAt);
    res.json({
      token: signToken(
        { id: result.row.user_id, name: result.row.name, role: result.row.role },
        result.row.family_id,
      ),
      session: result.session,
    });
  } catch (error) {
    next(error);
  }
}
export async function browserLogout(req: Request, res: Response, next: NextFunction) {
  try {
    await withTransaction(async (tx) => {
      await tx
        .request()
        .input('token', hashToken(cookie(req, refreshCookie)))
        .query(
          'SELECT pg_advisory_xact_lock(hashtextextended(\'session:\' || family_id,0)) FROM "BrowserSessions" WHERE token_hash=@token',
        );
      const row = (
        await tx
          .request()
          .input('token', hashToken(cookie(req, refreshCookie)))
          .query(
            'SELECT user_id,family_id,csrf_hash FROM "BrowserSessions" WHERE token_hash=@token FOR UPDATE',
          )
      ).recordset[0];
      if (row && row.csrf_hash !== hashToken(cookie(req, csrfCookie)))
        throw new AppError(403, 'CSRF_REJECTED', 'Session request could not be verified');
      if (row) {
        await revokeFamily(tx, row.family_id);
        req.user = { id: row.user_id, name: '', role: 'VIEWER' };
        await audit('BROWSER_LOGOUT', req, 'user', row.user_id, tx);
      }
    });
    clearCookies(res);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
export async function browserActivity(req: Request, res: Response, next: NextFunction) {
  try {
    const family = req.browserSession?.familyId;
    if (!family || !req.user) throw sessionError('SESSION_INVALID');
    const result = await withTransaction(async (tx) => {
      await lockFamily(tx, family);
      const row = await readFamily(tx, family, req.user!.id);
      const checked = await checkFamily(tx, req, row);
      if (!checked.session || !row) return checked;
      const token = (
        await tx
          .request()
          .input('token', hashToken(cookie(req, refreshCookie)))
          .input('family', family)
          .input('user', req.user!.id)
          .query(
            'SELECT csrf_hash FROM "BrowserSessions" WHERE token_hash=@token AND family_id=@family AND user_id=@user AND revoked_at IS NULL AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP',
          )
      ).recordset[0];
      if (!token || token.csrf_hash !== hashToken(cookie(req, csrfCookie)))
        return { code: 'SESSION_INVALID' };
      const rechecked = await checkFamily(tx, req, row);
      if (!rechecked.session) return rechecked;
      const now = new Date(Date.now());
      await tx
        .request()
        .input('family', family)
        .input('activity', now)
        .query(
          'UPDATE "BrowserSessionFamilies" SET last_activity_at=@activity WHERE family_id=@family AND revoked_at IS NULL',
        );
      return { session: sessionMetadata({ ...row, last_activity_at: now }, now.getTime()) };
    });
    if (!result.session) throw sessionError(result.code);
    res.set('Cache-Control', 'no-store').json({ success: true, session: result.session });
  } catch (error) {
    next(error);
  }
}
export async function listSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await getConnection();
    const rows = await pool
      .request()
      .input('user', req.user?.id)
      .input('absolute', config.auth.absoluteExpiration)
      .input('idle', config.auth.idleExpiration)
      .query(
        "SELECT family_id,created_at,LEAST(expires_at,created_at+(@absolute * INTERVAL '1 second')) expires_at,LEAST(expires_at,created_at+(@absolute * INTERVAL '1 second'),last_activity_at+(@idle * INTERVAL '1 second')) idle_expires_at,last_activity_at,revoked_at IS NOT NULL revoked FROM \"BrowserSessionFamilies\" WHERE user_id=@user ORDER BY created_at DESC LIMIT 100",
      );
    res.json({ success: true, data: rows.recordset });
  } catch (error) {
    next(error);
  }
}
export async function revokeSession(req: Request, res: Response, next: NextFunction) {
  try {
    const family = req.params.sessionId;
    if (!/^[a-f0-9-]{36}$/.test(family))
      throw new AppError(400, 'INVALID_SESSION_ID', 'Invalid session identifier');
    await withTransaction(async (tx) => {
      await tx
        .request()
        .input('family', family)
        .query("SELECT pg_advisory_xact_lock(hashtextextended('session:' || @family,0))");
      const result = await tx
        .request()
        .input('family', family)
        .input('user', req.user?.id)
        .query(
          'UPDATE "BrowserSessionFamilies" SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE family_id=@family AND user_id=@user',
        );
      if (!result.rowsAffected[0])
        throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
      await revokeFamily(tx, family);
      await audit('REVOKE_BROWSER_SESSION', req, 'user', req.user?.id, tx);
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
