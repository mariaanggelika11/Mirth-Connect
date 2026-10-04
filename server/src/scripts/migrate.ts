import { readFile } from 'node:fs/promises';
import { closeConnection, withTransaction } from '../config/db.js';
import { encrypt } from '../utils/secrets.js';
try {
  await withTransaction(async (tx) => {
    // A session-scoped client owns this transaction and serializes concurrent migrations.
    await tx.request().query('SELECT pg_advisory_xact_lock(741203,2)');
    await tx
      .request()
      .batch(await readFile(new URL('../../migrations/001_engine.sql', import.meta.url), 'utf8'));
    const rows = (
      await tx
        .request()
        .query('SELECT id,endpoint FROM "Destinations" WHERE endpoint NOT LIKE \'enc:v1:%\'')
    ).recordset;
    for (const row of rows) {
      await tx
        .request()
        .input('id', row.id)
        .input('endpoint', encrypt(row.endpoint))
        .query('UPDATE "Destinations" SET endpoint=@endpoint WHERE id=@id');
    }
  });
  console.info('PostgreSQL schema and connector encryption migrations applied');
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : 'MIGRATION_FAILED';
  console.error('Migration failed (' + code + '); no transaction changes committed');
  process.exitCode = 1;
} finally {
  await closeConnection();
}
