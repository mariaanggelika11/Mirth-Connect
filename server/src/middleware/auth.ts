import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { getConnection } from '../config/db.js';
export const roles = ['ADMIN', 'DEVELOPER', 'OPERATOR', 'VIEWER'] as const;
export type UserRole = (typeof roles)[number];
export type Permission =
  | 'channel:read'
  | 'channel:write'
  | 'channel:delete'
  | 'channel:operate'
  | 'message:read'
  | 'message:payload'
  | 'message:resend'
  | 'audit:read'
  | 'user:manage'
  | 'inbound:send';
const permissions: Record<UserRole, readonly Permission[]> = {
  ADMIN: [
    'channel:read',
    'channel:write',
    'channel:delete',
    'channel:operate',
    'message:read',
    'message:payload',
    'message:resend',
    'audit:read',
    'user:manage',
    'inbound:send',
  ],
  DEVELOPER: [
    'channel:read',
    'channel:write',
    'channel:operate',
    'message:read',
    'message:payload',
    'inbound:send',
  ],
  OPERATOR: [
    'channel:read',
    'channel:operate',
    'message:read',
    'message:payload',
    'message:resend',
  ],
  VIEWER: ['channel:read', 'message:read'],
};
export function normalizeRole(role: string): UserRole {
  const r = String(role).toUpperCase();
  return roles.includes(r as UserRole) ? (r as UserRole) : 'VIEWER';
}
export function hasPermission(role: UserRole, permission: Permission) {
  return permissions[role].includes(permission);
}
export const authenticate: RequestHandler = async (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) {
    res
      .status(401)
      .json({
        success: false,
        code: 'NO_TOKEN',
        message: 'Unauthorized',
        requestId: req.requestId,
      });
    return;
  }
  let decoded: jwt.JwtPayload;
  try {
    const d = jwt.verify(token, config.auth.jwtSecret, {
      algorithms: ['HS256'],
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    });
    if (typeof d === 'string' || !Number.isSafeInteger(d.id) || !d.exp || typeof d.jti!=='string') throw new Error();
    decoded = d;
  } catch (error) {
    res
      .status(401)
      .json({
        success: false,
        code: error instanceof jwt.TokenExpiredError ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        message: 'Session invalid or expired',
        requestId: req.requestId,
      });
    return;
  }
  try {
    // Read current role so role removal and user deletion invalidate stale JWT grants.
    const pool = await getConnection();
    const user = (
      await pool
        .request()
        .input('id', decoded.id).input('token',decoded.jti)
        .query('SELECT id,name,role FROM "Users" WHERE id=@id AND NOT EXISTS(SELECT 1 FROM "RevokedTokens" WHERE token_id=@token)')
    ).recordset[0];
    if (!user) {
      res
        .status(401)
        .json({
          success: false,
          code: 'TOKEN_INVALID',
          message: 'Session invalid',
          requestId: req.requestId,
        });
      return;
    }
    req.user = { id: user.id, name: user.name, role: normalizeRole(user.role),tokenId:decoded.jti,expiresAt:decoded.exp };
    next();
  } catch (error) {
    next(error);
  }
};
export function requirePermission(permission: Permission): RequestHandler {
  return (req, res, next) => {
    if (!req.user || !hasPermission(req.user.role, permission)) {
      res
        .status(403)
        .json({
          success: false,
          code: 'FORBIDDEN',
          message: 'Permission denied',
          requestId: req.requestId,
        });
      return;
    }
    next();
  };
}
