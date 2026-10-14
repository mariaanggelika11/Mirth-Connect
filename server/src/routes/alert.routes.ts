import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { getConnection, withTransaction } from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { audit } from '../services/audit.services.js';
const router = Router();
router.use(authenticate, requirePermission('audit:read'));
router.get('/', async (_req, res, next) => {
  try {
    const pool = await getConnection();
    res.json({
      success: true,
      data: (
        await pool
          .request()
          .query(
            'SELECT code,active,state,first_seen_at,last_attempt_at,last_notified_at,acknowledged_by,acknowledged_at FROM "OperationalAlerts" ORDER BY first_seen_at DESC LIMIT 100',
          )
      ).recordset,
    });
  } catch (error) {
    next(error);
  }
});
router.post('/:code/acknowledge', async (req, res, next) => {
  try {
    if (
      !['DEAD_LETTER', 'QUEUE_AGE', 'CHANNEL_ERROR', 'DATABASE_UNAVAILABLE'].includes(
        req.params.code,
      )
    )
      throw new AppError(400, 'INVALID_ALERT_CODE', 'Invalid alert code');
    await withTransaction(async (tx) => {
      const r = await tx
        .request()
        .input('code', req.params.code)
        .input('user', req.user?.id)
        .query(
          'UPDATE "OperationalAlerts" SET state=\'ACKNOWLEDGED\',acknowledged_by=@user,acknowledged_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE code=@code AND active=true',
        );
      if (!r.rowsAffected[0])
        throw new AppError(409, 'ALERT_NOT_ACTIVE', 'Only active alerts can be acknowledged');
      await audit('ACKNOWLEDGE_ALERT', req, 'alert', undefined, tx);
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
export default router;
