import { withTransaction } from '../config/db.js';
import { decrypt, encrypt } from '../utils/secrets.js';
import { randomUUID } from 'node:crypto';
function rotateNested(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('enc:')) return encrypt(decrypt(value));
  if (Array.isArray(value)) return value.map(rotateNested);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rotateNested(v)]));
  return value;
}
export async function rotateSecrets(dryRun: boolean) {
  return withTransaction(async (tx) => {
    await tx.request().query('SELECT pg_advisory_xact_lock(741203,3)');
    let count = 0;
    // One transaction prevents a partially committed key rotation. Locked records cannot change during rotation.
    const targets = [
      ['Destinations', 'id', 'endpoint', false],
      ['Channels', 'id', 'source_api_key', false],
      ['Messages', 'id', 'transport_config', true],
      ['ChannelRevisions', 'channel_id', 'configuration', true],
    ] as const;
    for (const [table, id, column, nested] of targets) {
      const rows = (
        await tx
          .request()
          .query(
            `SELECT ${id} id,${column} value${table === 'ChannelRevisions' ? ',revision' : ''} FROM "${table}" WHERE ${column} IS NOT NULL ORDER BY ${id} FOR UPDATE`,
          )
      ).recordset;
      for (const row of rows) {
        const plaintext = decrypt(row.value); // GCM authentication must succeed even during dry-run.
        const value = encrypt(
          nested ? JSON.stringify(rotateNested(JSON.parse(plaintext))) : plaintext,
        );
        if (!dryRun)
          await tx
            .request()
            .input('id', row.id)
            .input('revision', row.revision || null)
            .input('value', value)
            .query(
              `UPDATE "${table}" SET ${column}=@value WHERE ${id}=@id${table === 'ChannelRevisions' ? ' AND revision=@revision' : ''}`,
            );
        count++;
      }
    }
    if (!dryRun)
      await tx
        .request()
        .input('request', randomUUID())
        .query(
          "INSERT INTO \"AuditLog\"(action,resource_type,request_id,ip_address) VALUES('ROTATE_ENCRYPTION_KEYS','configuration',@request,'local-cli')",
        );
    return { dryRun, recordsVerified: count, recordsUpdated: dryRun ? 0 : count };
  });
}
