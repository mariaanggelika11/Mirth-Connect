import { renderRuntimeMetrics } from '../utils/runtimeMetrics.js';
import type { Request, Response, NextFunction } from 'express';
import { getConnection } from '../config/db.js';
export async function metrics(_req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await getConnection();
    const row =
      (
        await pool
          .request()
          .query(
            `SELECT COUNT(*) FILTER(WHERE direction='IN') inbound,COUNT(*) FILTER(WHERE direction='IN' AND status='SUCCESS') success,COUNT(*) FILTER(WHERE direction='IN' AND status='FAILED') failed,COUNT(*) FILTER(WHERE direction='IN' AND status='FILTERED') filtered,COUNT(*) FILTER(WHERE direction='IN' AND status='PARTIAL') partial,COUNT(*) FILTER(WHERE direction='OUT' AND status='QUEUED') queue,COUNT(*) FILTER(WHERE direction='OUT' AND status='RETRYING') retry,COUNT(*) FILTER(WHERE direction='OUT' AND status='DEAD_LETTER') dead_letter,COUNT(*) FILTER(WHERE direction='OUT' AND status='DEAD_LETTER' AND NOT EXISTS(SELECT 1 FROM "DeadLetterCases" dc WHERE dc.message_id="Messages".id AND dc.state IN ('RESOLVED','IGNORED'))) dead_letter_open,COALESCE(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP-MIN(created_at) FILTER(WHERE direction='OUT' AND status IN ('QUEUED','RETRYING'))),0) oldest_pending_seconds FROM "Messages"`,
          )
      ).recordset[0] || {};
    const circuits =
      (
        await pool
          .request()
          .query(
            'SELECT count(*) FILTER(WHERE open_until>CURRENT_TIMESTAMP) circuit_open,count(*) FILTER(WHERE probe_until>CURRENT_TIMESTAMP) circuit_half_open FROM "DestinationRuntime"',
          )
      ).recordset[0] || {};
    const alerts =
      (
        await pool
          .request()
          .query(
            `SELECT count(*) FILTER(WHERE active=true AND state='OPEN') alerts_open FROM "OperationalAlerts"`,
          )
      ).recordset[0] || {};
    const lines = Object.entries({ ...row, ...circuits, ...alerts }).map(([name, value]) => {
      const n = Number(value);
      return `# TYPE mirth_${name} gauge\nmirth_${name} ${Number.isFinite(n) ? n : 0}`;
    });
    res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n' + renderRuntimeMetrics());
  } catch (error) {
    next(error);
  }
}
