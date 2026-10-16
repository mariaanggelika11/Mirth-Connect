import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { restoreTarget } from '../utils/backup.js';
export async function verifyRestoredDatabase(url: string, schema: string) {
  restoreTarget(url, true);
  if (!/^[a-z_][a-z_0-9]*$/.test(schema)) throw new Error('INVALID_RESTORE_SCHEMA');
  // Import crypto configuration only after the CLI has explicitly selected the disposable database.
  const { decrypt } = await import('../utils/secrets.js');
  const client = new pg.Client({ connectionString: url, options: '-c search_path=' + schema });
  await client.connect();
  try {
    const versions = (
      await client.query('SELECT version FROM "SchemaMigrations" ORDER BY version')
    ).rows.map((r) => r.version);
    if (!versions.includes(7)) throw new Error('RESTORED_SCHEMA_VERSION_MISSING');
    const counts: Record<string, number> = {};
    for (const table of ['Users', 'Channels', 'Destinations', 'AuditLog', 'Messages'])
      counts[table] = Number(
        (await client.query(`SELECT count(*) total FROM "${table}"`)).rows[0].total,
      );
    let verified = 0;
    for (const [table, column] of [
      ['Destinations', 'endpoint'],
      ['Channels', 'source_api_key'],
      ['Messages', 'transport_config'],
      ['ChannelRevisions', 'configuration'],
    ])
      for (const row of (
        await client.query(`SELECT ${column} value FROM "${table}" WHERE ${column} IS NOT NULL`)
      ).rows) {
        decrypt(row.value);
        verified++;
      }
    const inconsistent = Number(
      (
        await client.query(
          'SELECT count(*) total FROM "Messages" m LEFT JOIN "Messages" p ON p.id=m.inbound_message_id WHERE m.inbound_message_id IS NOT NULL AND (p.id IS NULL OR p.direction<>\'IN\' OR p.channel_id<>m.channel_id)',
        )
      ).rows[0].total,
    );
    if (inconsistent) throw new Error('RESTORED_MESSAGE_INCONSISTENCY');
    const bcrypt = (await import('bcrypt')).default;
    const username = 'restore-' + randomUUID(),
      password = randomUUID() + randomUUID();
    await client.query(
      'INSERT INTO "Users"(username,name,password_hash,role) VALUES($1,$2,$3,$4)',
      [username, 'Synthetic restore verification', await bcrypt.hash(password, 12), 'VIEWER'],
    );
    const request = (await import('supertest')).default;
    const app = (await import('../app.js')).default;
    const login = await request(app).post('/api/auth/login').send({ username, password });
    const health = await request(app).get('/health'),
      ready = await request(app).get('/ready');
    if (login.status !== 200 || health.status !== 200 || ready.status !== 200)
      throw new Error('RESTORED_RUNTIME_VERIFICATION_FAILED');
    return {
      versions,
      counts,
      encryptedRecordsVerified: verified,
      messageConsistency: true,
      syntheticLogin: true,
      health: true,
      readiness: true,
    };
  } finally {
    await client.end();
    const { closeConnection } = await import('../config/db.js');
    await closeConnection();
  }
}
