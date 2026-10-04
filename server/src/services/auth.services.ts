import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { Request } from 'express';
import { audit } from './audit.services.js';
import { getConnection, withTransaction } from '../config/db.js';
import { config } from '../config/env.js';
import { normalizeRole } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { registration, credentials } from '../utils/validator.js';
export function signToken(user: { id: number; name: string; role: string }) {
  return jwt.sign(
    { id: user.id, name: user.name, role: normalizeRole(user.role) },
    config.auth.jwtSecret,
    {
      algorithm: 'HS256',
      jwtid: randomUUID(),
      expiresIn: config.auth.expiration,
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    },
  );
}
const dummyHash = await bcrypt.hash('not-a-real-user-password', 12);
export const AuthService = {
  async register(username: string, password: string, name: string, req?: Request) {
    const data = registration.parse({ username, password, name });
    const hash = await bcrypt.hash(data.password, 12);
    try {
      return await withTransaction(async (tx) => {
        const result = await tx
          .request()
          .input('username', data.username)
          .input('password_hash', hash)
          .input('name', data.name)
          .input('role', 'VIEWER')
          .query(
            'INSERT INTO "Users" (username,password_hash,name,role) VALUES (@username,@password_hash,@name,@role) RETURNING id',
          );
        const id = result.recordset[0].id;
        if (req) {
          req.user = { id, name: data.name, role: 'VIEWER' };
          await audit('CREATE_USER', req, 'user', id, tx);
        }
        return { id, token: signToken({ id, name: data.name, role: 'VIEWER' }) };
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new AppError(409, 'USERNAME_EXISTS', 'Username already exists');
      throw error;
    }
  },
  async login(username: string, password: string) {
    const data = credentials.parse({ username, password });
    const pool = await getConnection();
    const user = (
      await pool
        .request()
        .input('username', data.username)
        .query<{ id: number; name: string; role: string; password_hash: string }>(
          'SELECT id,name,role,password_hash FROM "Users" WHERE username=@username',
        )
    ).recordset[0];
    const valid = await bcrypt.compare(data.password, user?.password_hash || dummyHash);
    if (!user || !valid)
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
    return { token: signToken(user), id: user.id };
  },
};
