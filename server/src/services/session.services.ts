import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/env.js';
import { withTransaction, getConnection } from '../config/db.js';
import { audit } from './audit.services.js';
import { signToken, AuthService } from './auth.services.js';
import { AppError } from '../utils/errors.js';
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
export function sessionCookies(res: Response, refresh: string, csrf: string) {
  const options = {
    secure: config.production,
    sameSite: 'strict' as const,
    maxAge: config.auth.refreshExpiration * 1000,
  };
  res.cookie(refreshCookie, refresh, { ...options, httpOnly: true, path: '/api/auth/browser' });
  res.cookie(csrfCookie, csrf, { ...options, httpOnly: false, path: '/' });
  res.set('Cache-Control', 'no-store');
}
function clearCookies(res: Response) {
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
        .input('token', hashToken(refresh))
        .input('family', family)
        .input('user', result.id)
        .input('csrf', hashToken(csrf))
        .input('expires', new Date(Date.now() + config.auth.refreshExpiration * 1000))
        .query(
          'INSERT INTO "BrowserSessions"(token_hash,family_id,user_id,csrf_hash,expires_at) VALUES(@token,@family,@user,@csrf,@expires)',
        );
      req.user = { id: user.id, name: user.name, role: 'VIEWER' };
      await audit('BROWSER_LOGIN', req, 'user', result.id, tx);
      return user;
    });
    sessionCookies(res, refresh, csrf);
    res.json({
      token: signToken({ id: user.id, name: user.name, role: user.role }, family),
      csrfToken: csrf,
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
      if (
        !row ||
        row.revoked_at ||
        new Date(row.expires_at).getTime() <= Date.now() ||
        row.csrf_hash !== hashToken(csrf)
      )
        return null;
      req.user = { id: row.user_id, name: row.name, role: 'VIEWER' };
      if (row.used_at) {
        await tx
          .request()
          .input('family', row.family_id)
          .query(
            'UPDATE "BrowserSessions" SET revoked_at=CURRENT_TIMESTAMP WHERE family_id=@family',
          );
        await audit('REFRESH_REUSE', req, 'user', row.user_id, tx);
        return null; // Commit revocation before returning an authentication error.
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
        .input('expires', new Date(row.expires_at))
        .query(
          'INSERT INTO "BrowserSessions"(token_hash,family_id,user_id,csrf_hash,expires_at) VALUES(@token,@family,@user,@csrf,@expires)',
        );
      await audit('REFRESH_SESSION', req, 'user', row.user_id, tx);
      return row;
    });
    if (!result) {
      clearCookies(res);
      throw new AppError(401, 'SESSION_INVALID', 'Session invalid or expired');
    }
    sessionCookies(res, refresh, csrf);
    res.json({
      token: signToken(
        { id: result.user_id, name: result.name, role: result.role },
        result.family_id,
      ),
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
        await tx
          .request()
          .input('family', row.family_id)
          .query(
            'UPDATE "BrowserSessions" SET revoked_at=CURRENT_TIMESTAMP WHERE family_id=@family',
          );
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
export async function listSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await getConnection();
    const rows = await pool
      .request()
      .input('user', req.user?.id)
      .query(
        'SELECT family_id,MIN(created_at) created_at,MAX(expires_at) expires_at,bool_or(revoked_at IS NOT NULL) revoked FROM "BrowserSessions" WHERE user_id=@user GROUP BY family_id ORDER BY MIN(created_at) DESC LIMIT 100',
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
          'UPDATE "BrowserSessions" SET revoked_at=CURRENT_TIMESTAMP WHERE family_id=@family AND user_id=@user',
        );
      if (!result.rowsAffected[0])
        throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
      await audit('REVOKE_BROWSER_SESSION', req, 'user', req.user?.id, tx);
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
