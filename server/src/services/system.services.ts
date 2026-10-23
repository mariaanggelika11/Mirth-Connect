import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/env.js';
import { getConnection, databasePoolStats } from '../config/db.js';
import { renderRuntimeMetrics } from '../utils/runtimeMetrics.js';
import { audit } from './audit.services.js';
export function effectiveSettings() {
  return {
    runtime: {
      node: process.version,
      environment: config.production ? 'production' : 'non-production',
      encryptionKeyVersion: config.encryptionKeyId,
    },
    session: {
      accessTokenSeconds: config.auth.uiExpiration,
      refreshTokenSeconds: config.auth.refreshExpiration,
      absoluteTimeoutSeconds: config.auth.absoluteExpiration,
      idleTimeoutSeconds: config.auth.idleExpiration,
      warningSeconds: config.auth.warningSeconds,
      cookieSecure: config.production,
      cookieSameSite: 'Strict',
      csrfRequired: true,
    },
    transport: {
      postgresTlsVerified: !!config.database.ssl && config.database.ssl.rejectUnauthorized,
      mllpEnabled: config.hl7.enabled,
      mllpTls: config.hl7.tls.enabled,
      mllpMutualTls: config.hl7.tls.requireClientCert,
    },
    retention: {
      enabled: config.retention.enabled,
      messageDays: config.retention.messages,
      auditDays: config.retention.audit,
    },
    masking: {
      jsonPaths: config.masking.jsonPaths,
      hl7Paths: config.masking.hl7Paths,
      xmlAndText: 'FULL_REDACTION',
    },
    delivery: { ...config.delivery },
    idempotency: {
      defaultMode: config.inbound.idempotencyMode,
      retentionHours: config.inbound.idempotencyRetentionHours,
    },
    alerts: {
      webhookConfigured: !!config.alerts.webhook,
      cooldownSeconds: config.alerts.cooldownSeconds,
      queueAgeSeconds: config.alerts.queueAgeSeconds,
    },
    configurationOwner: 'Deployment environment; changes require reviewed deployment',
  };
}
export async function systemConfiguration(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: effectiveSettings() });
  } catch (error) {
    next(error);
  }
}
export async function diagnosticBundle(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await getConnection();
    const versions = (
      await pool.request().query('SELECT version FROM "SchemaMigrations" ORDER BY version')
    ).recordset.map((r) => r.version);
    const states = (
      await pool
        .request()
        .query(
          'SELECT direction,status,count(*) total FROM "Messages" GROUP BY direction,status ORDER BY direction,status',
        )
    ).recordset;
    const channels = (
      await pool
        .request()
        .query('SELECT status,count(*) total FROM "Channels" GROUP BY status ORDER BY status')
    ).recordset;
    await audit('EXPORT_DIAGNOSTIC_METADATA', req, 'system');
    res.set('Cache-Control', 'no-store').json({
      success: true,
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      settings: effectiveSettings(),
      schemaVersions: versions,
      messageStates: states,
      channelStates: channels,
      databasePool: databasePoolStats(),
      runtimeMetrics: renderRuntimeMetrics(),
      exclusions: [
        'Payloads',
        'Scripts',
        'Credentials',
        'Endpoint URLs',
        'Patient identifiers',
        'Application logs',
        'Free-text operator notes',
      ],
    });
  } catch (error) {
    next(error);
  }
}
