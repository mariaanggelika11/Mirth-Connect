import type { Request, Response, NextFunction } from 'express';
import { withTransaction } from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { audit } from './audit.services.js';
export async function reconcileDeadLetter(req: Request, res: Response, next: NextFunction) {
  try {
    await withTransaction(async (tx) => {
      const id = Number(req.params.id);
      const row = (
        await tx
          .request()
          .input('id', id)
          .query(
            "SELECT id FROM \"Messages\" WHERE id=@id AND direction='OUT' AND status='DEAD_LETTER' FOR UPDATE",
          )
      ).recordset[0];
      if (!row)
        throw new AppError(
          409,
          'DEAD_LETTER_UNAVAILABLE',
          'Reconciliation requires a dead-letter message',
        );
      if (req.body.assignedTo) {
        const user = (
          await tx
            .request()
            .input('user', req.body.assignedTo)
            .query("SELECT id FROM \"Users\" WHERE id=@user AND role IN ('ADMIN','OPERATOR')")
        ).recordset[0];
        if (!user)
          throw new AppError(400, 'INVALID_ASSIGNEE', 'Assign an operator or administrator');
      }
      await tx
        .request()
        .input('id', id)
        .input('state', req.body.state)
        .input('note', req.body.note)
        .input('category', req.body.category)
        .input('assigned', req.body.assignedTo || null)
        .input('user', req.user?.id)
        .query(
          "INSERT INTO \"DeadLetterCases\" AS old_case (message_id,state,note,category,assigned_to,updated_by,resolved_at) VALUES(@id,@state,@note,@category,@assigned,@user,CASE WHEN @state IN ('RESOLVED','IGNORED') THEN CURRENT_TIMESTAMP ELSE NULL END) ON CONFLICT(message_id) DO UPDATE SET state=EXCLUDED.state,note=EXCLUDED.note,category=EXCLUDED.category,assigned_to=COALESCE(EXCLUDED.assigned_to,old_case.assigned_to),updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP,resolved_at=EXCLUDED.resolved_at",
        );
      await audit('RECONCILE_DEAD_LETTER', req, 'message', id, tx);
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
