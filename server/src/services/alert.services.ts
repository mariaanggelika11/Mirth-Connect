import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { getConnection, withTransaction } from '../config/db.js';
import { sendRest } from '../utils/transport.js';
import { logger } from '../utils/logger.js';
const sent = new Map<string, { active: boolean; at: number }>();
export async function sendOperationalAlert(
  code: 'DEAD_LETTER' | 'QUEUE_AGE' | 'CHANNEL_ERROR' | 'DATABASE_UNAVAILABLE',
  active: boolean,
) {
  if (!config.alerts.webhook) return;
  const previous = sent.get(code),
    now = Date.now();
  if (
    previous &&
    previous.active === active &&
    now - previous.at < config.alerts.cooldownSeconds * 1000
  )
    return;
  sent.set(code, { active, at: now });
  try {
    const reserved = await withTransaction(async (tx) => {
      await tx
        .request()
        .input('code', code)
        .query("SELECT pg_advisory_xact_lock(hashtextextended('alert:' || @code,0))");
      const old = (
        await tx
          .request()
          .input('code', code)
          .query(
            'SELECT *,EXTRACT(EPOCH FROM CURRENT_TIMESTAMP-last_attempt_at) age FROM "OperationalAlerts" WHERE code=@code FOR UPDATE',
          )
      ).recordset[0];
      if (
        !active &&
        !old?.active &&
        !old?.delivery_pending &&
        !(code === 'DATABASE_UNAVAILABLE' && previous?.active)
      )
        return false;
      if (old?.state === 'ACKNOWLEDGED' && old.active === active && !old.delivery_pending)
        return false;
      if (old && old.active === active && Number(old.age) < config.alerts.cooldownSeconds)
        return false;
      await tx
        .request()
        .input('code', code)
        .input('active', active)
        .query(
          'INSERT INTO "OperationalAlerts"(code,active,state,last_attempt_at) VALUES(@code,@active,CASE WHEN @active THEN \'OPEN\' ELSE \'RECOVERED\' END,CURRENT_TIMESTAMP) ON CONFLICT(code) DO UPDATE SET active=EXCLUDED.active,state=CASE WHEN NOT EXCLUDED.active THEN \'RECOVERED\' WHEN "OperationalAlerts".active THEN "OperationalAlerts".state ELSE \'OPEN\' END,delivery_pending=true,last_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,acknowledged_by=CASE WHEN "OperationalAlerts".active=EXCLUDED.active THEN "OperationalAlerts".acknowledged_by ELSE NULL END,acknowledged_at=CASE WHEN "OperationalAlerts".active=EXCLUDED.active THEN "OperationalAlerts".acknowledged_at ELSE NULL END',
        );
      return true;
    });
    if (!reserved) return;
    await sendRest(
      config.alerts.webhook,
      JSON.stringify({
        code,
        severity: active ? 'warning' : 'info',
        status: active ? 'FIRING' : 'RECOVERED',
        timestamp: new Date().toISOString(),
      }),
      { 'Content-Type': 'application/json' },
      5000,
    );
    const pool = await getConnection();
    await pool
      .request()
      .input('code', code)
      .query(
        'UPDATE "OperationalAlerts" SET delivery_pending=false,last_notified_at=CURRENT_TIMESTAMP WHERE code=@code',
      );
    await pool
      .request()
      .input('action', active ? 'ALERT_SENT' : 'ALERT_RECOVERED')
      .input('request', randomUUID())
      .query(
        "INSERT INTO \"AuditLog\"(action,resource_type,request_id,ip_address) VALUES(@action,'alert',@request,'worker')",
      );
  } catch {
    if (code === 'DATABASE_UNAVAILABLE' && active) {
      try {
        await sendRest(
          config.alerts.webhook,
          JSON.stringify({
            code,
            severity: 'critical',
            status: 'FIRING',
            timestamp: new Date().toISOString(),
          }),
          { 'Content-Type': 'application/json' },
          5000,
        );
      } catch {
        /* DB-independent outage notification is best effort and bounded by memory cooldown. */
      }
    }
    logger.error({ code: 'ALERT_DELIVERY_FAILED' }, 'Operational alert failed');
  }
}
export async function alertTick() {
  if (!config.alerts.webhook) return;
  try {
    const pool = await getConnection();
    const row = (
      await pool
        .request()
        .query(
          `SELECT COUNT(*) FILTER(WHERE status='DEAD_LETTER' AND NOT EXISTS(SELECT 1 FROM "DeadLetterCases" dc WHERE dc.message_id="Messages".id AND dc.state IN ('RESOLVED','IGNORED'))) dead_letters,COALESCE(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP-MIN(created_at) FILTER(WHERE status IN ('QUEUED','RETRYING'))),0) queue_age,(SELECT COUNT(*) FROM "Channels" WHERE status='ERROR') channel_errors FROM "Messages"`,
        )
    ).recordset[0];
    await sendOperationalAlert('DATABASE_UNAVAILABLE', false);
    await sendOperationalAlert('DEAD_LETTER', Number(row.dead_letters) > 0);
    await sendOperationalAlert('QUEUE_AGE', Number(row.queue_age) > config.alerts.queueAgeSeconds);
    await sendOperationalAlert('CHANNEL_ERROR', Number(row.channel_errors) > 0);
  } catch {
    await sendOperationalAlert('DATABASE_UNAVAILABLE', true);
  }
}
