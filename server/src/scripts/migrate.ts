import { config } from '../config/env.js';
import { safeError } from '../utils/errors.js';
import { migrationPreflight } from '../services/migrationPreflight.services.js';
import { readFile } from 'node:fs/promises';
import { closeConnection, withTransaction } from '../config/db.js';
import { readRuntimeConfiguration, insertRevision } from '../services/revision.services.js';
import { encrypt, decrypt } from '../utils/secrets.js';
try {
  const dryRun = process.argv.includes('--dry-run');
  if (config.production && !dryRun && process.env.MIGRATION_BACKUP_CONFIRMED !== 'true')
    throw new Error('MIGRATION_BACKUP_CONFIRMATION_REQUIRED');
  await withTransaction(async (tx) => {
    // A session-scoped client owns this transaction and serializes concurrent migrations.
    await tx.request().query('SELECT pg_advisory_xact_lock(741203,2)');
    console.info(JSON.stringify(await migrationPreflight(tx)));
    if (dryRun) return;
    await tx
      .request()
      .batch(await readFile(new URL('../../migrations/001_engine.sql', import.meta.url), 'utf8'));
    await tx
      .request()
      .batch(
        await readFile(new URL('../../migrations/002_hardening.sql', import.meta.url), 'utf8'),
      );
    await tx
      .request()
      .batch(
        await readFile(
          new URL('../../migrations/003_delivery_controls.sql', import.meta.url),
          'utf8',
        ),
      );
    await tx
      .request()
      .batch(
        await readFile(
          new URL('../../migrations/004_operational_alerts.sql', import.meta.url),
          'utf8',
        ),
      );
    const channels = (
      await tx
        .request()
        .query('SELECT id FROM "Channels" WHERE active_revision=0 ORDER BY id FOR UPDATE')
    ).recordset;
    for (const channel of channels)
      await insertRevision(
        tx,
        channel.id,
        await readRuntimeConfiguration(tx, channel.id),
        'PUBLISHED',
        'Existing configuration migrated',
      );
    const rows = (
      await tx
        .request()
        .query('SELECT id,endpoint FROM "Destinations" WHERE endpoint NOT LIKE \'enc:%\'')
    ).recordset;
    for (const row of rows) {
      await tx
        .request()
        .input('id', row.id)
        .input('endpoint', encrypt(decrypt(row.endpoint)))
        .query('UPDATE "Destinations" SET endpoint=@endpoint WHERE id=@id');
    }
  });
  console.info(
    dryRun
      ? 'Migration preflight completed; no writes'
      : 'PostgreSQL schema and connector encryption migrations applied',
  );
} catch (error) {
  const code = safeError(error);
  console.error('Migration failed (' + code + '); no transaction changes committed');
  process.exitCode = 1;
} finally {
  await closeConnection();
}
