import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { getConnection, withTransaction } from '../config/db.js';
import { requirePermission, roles } from '../middleware/auth.js';
import { registration, validate, validateId } from '../utils/validator.js';
import { AppError } from '../utils/errors.js';
import { audit } from '../services/audit.services.js';
const router = Router();
router.use(requirePermission('user:manage'));
router.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000)
      throw new AppError(400, 'INVALID_QUERY', 'Invalid page');
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('offset', (page - 1) * 50)
      .query('SELECT id,username,name,role FROM "Users" ORDER BY id LIMIT 50 OFFSET @offset');
    res.json({ success: true, data: result.recordset, page });
  } catch (error) {
    next(error);
  }
});
router.post('/', validate(registration.extend({ role: z.enum(roles) })), async (req, res, next) => {
  try {
    const hash = await bcrypt.hash(req.body.password, 12);
    const id = await withTransaction(async (tx) => {
      const row = (
        await tx
          .request()
          .input('username', req.body.username)
          .input('name', req.body.name)
          .input('hash', hash)
          .input('role', req.body.role)
          .query(
            'INSERT INTO "Users"(username,name,password_hash,role) VALUES(@username,@name,@hash,@role) RETURNING id',
          )
      ).recordset[0];
      await audit('CREATE_USER', req, 'user', row.id, tx);
      return row.id;
    });
    res.status(201).json({ success: true, data: { id } });
  } catch (error) {
    next(error);
  }
});
router.put(
  '/:id/role',
  validateId,
  validate(z.object({ role: z.enum(roles) }).strict()),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await withTransaction(async (tx) => {
        // Serialize role changes so two administrators cannot demote each other concurrently.
        await tx.request().query('SELECT pg_advisory_xact_lock(741203,1)');
        const old = (
          await tx
            .request()
            .input('id', id)
            .query('SELECT role FROM "Users" WHERE id=@id FOR UPDATE')
        ).recordset[0];
        if (!old) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
        if (old.role === 'ADMIN' && req.body.role !== 'ADMIN') {
          const admins = (
            await tx
              .request()
              .query('SELECT id FROM "Users" WHERE role=\'ADMIN\' ORDER BY id FOR UPDATE')
          ).recordset;
          if (admins.length <= 1)
            throw new AppError(409, 'LAST_ADMIN', 'Cannot remove the last administrator');
        }
        await tx
          .request()
          .input('id', id)
          .input('role', req.body.role)
          .query('UPDATE "Users" SET role=@role WHERE id=@id');
        await audit('ROLE_CHANGE', req, 'user', id, tx);
      });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);
export default router;
