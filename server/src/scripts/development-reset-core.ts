import type { Client } from 'pg';
import { readFile } from 'node:fs/promises';
export const operationalTables = [
  'BrowserSessions',
  'OperationalAlerts',
  'DeadLetterCases',
  'DeliverySlots',
  'MessageDestinationLog',
  'Messages',
  'DestinationRuntime',
  'ChannelRevisions',
  'Destinations',
  'Channels',
  'AuditLog',
];
export const preservedTables = ['Users', 'SchemaMigrations', 'RevokedTokens'];
export function quoteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(value)) throw new Error('INVALID_RESET_IDENTIFIER');
  return '"' + value + '"';
}
export async function inspectResetDatabase(client: Client, schema: string) {
  const tables = (
    await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', [
      schema,
    ])
  ).rows.map((r) => String(r.tablename));
  if (
    !tables.includes('Users') ||
    !tables.includes('SchemaMigrations') ||
    tables.some((t) => ![...preservedTables, ...operationalTables].includes(t))
  )
    throw new Error('RESET_SCHEMA_NOT_EXCLUSIVELY_MIRTH');
  const external = await client.query(
    `SELECT 1 FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid JOIN pg_namespace cn ON cn.oid=child.relnamespace JOIN pg_class parent ON parent.oid=f.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace WHERE f.contype='f' AND pn.nspname=$1 AND parent.relname=ANY($2::text[]) AND (cn.nspname<>$1 OR NOT(child.relname=ANY($2::text[]))) LIMIT 1`,
    [schema, tables],
  );
  const triggers = await client.query(
    `SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND NOT t.tgisinternal AND t.tgenabled<>'D' LIMIT 1`,
    [schema, tables],
  );
  if (external.rowCount || triggers.rowCount) throw new Error('EXTERNAL_DEPENDENCY_PREVENTS_RESET');
  const versions = (
    await client.query(
      `SELECT version FROM ${quoteIdentifier(schema)}."SchemaMigrations" ORDER BY version`,
    )
  ).rows.map((r) => Number(r.version));
  if (!versions.includes(1) || versions.some((v) => v > 6))
    throw new Error('UNSUPPORTED_RESET_SCHEMA_VERSION');
  const counts: Record<string, number> = {},
    fingerprints: Record<string, string> = {};
  for (const table of tables) {
    const qualified = quoteIdentifier(schema) + '.' + quoteIdentifier(table);
    counts[table] = Number(
      (await client.query('SELECT count(*) total FROM ' + qualified)).rows[0].total,
    );
    if (counts[table] > 100000) throw new Error('RESET_DATASET_REQUIRES_OFFLINE_PROCEDURE');
    // Only fixed-size digests cross the boundary; no payload/password data is logged.
    fingerprints[table] = (
      await client.query(
        `SELECT encode(sha256(convert_to(COALESCE(string_agg(digest,'' ORDER BY digest),''),'UTF8')),'hex') fingerprint FROM (SELECT encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') digest FROM ${qualified} t) h`,
      )
    ).rows[0].fingerprint;
  }
  return { tables, versions, counts, fingerprints };
}
export async function lockResetDatabase(
  client: Client,
  schema: string,
  tables: string[],
  mode: 'SHARE' | 'ACCESS EXCLUSIVE',
) {
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('SELECT pg_advisory_xact_lock(741203,2)');
  await client.query(
    'LOCK TABLE ' +
      tables.map((t) => quoteIdentifier(schema) + '.' + quoteIdentifier(t)).join(',') +
      ' IN ' +
      mode +
      ' MODE',
  );
}
// Caller owns BEGIN/COMMIT: backup verification and source fingerprint checks precede this.
export async function resetToSingleAdmin(client: Client, schema: string, username: string) {
  await client.query('SET LOCAL search_path=' + quoteIdentifier(schema));
  const rows = (await client.query('SELECT * FROM "Users" WHERE username=$1', [username])).rows;
  const user = rows[0];
  if (
    rows.length !== 1 ||
    user.role !== 'ADMIN' ||
    !/^\$2[aby]\$[0-9]{2}\$/.test(user.password_hash || '')
  )
    throw new Error('RESET_REQUIRES_EXISTING_BCRYPT_ADMIN');
  const busy = Number(
    (
      await client.query(
        `SELECT count(*) total FROM "Messages" WHERE status IN ('IN-PROCESS','PROCESSING','RETRYING')`,
      )
    ).rows[0].total,
  );
  if (busy) throw new Error('ACTIVE_WORK_PREVENTS_RESET');
  for (const file of [
    '001_engine.sql',
    '002_hardening.sql',
    '003_delivery_controls.sql',
    '004_operational_alerts.sql',
    '005_operational_controls.sql',
    '006_delivery_http_status.sql',
  ])
    await client.query(
      await readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8'),
    );
  // No CASCADE: a foreign table referencing this application causes rollback, never collateral deletion.
  await client.query(
    'TRUNCATE TABLE ' + operationalTables.map(quoteIdentifier).join(',') + ' RESTART IDENTITY',
  );
  await client.query('DELETE FROM "Users" WHERE id<>$1', [user.id]);
  const kept = (await client.query('SELECT * FROM "Users"')).rows;
  if (kept.length !== 1 || JSON.stringify(kept[0]) !== JSON.stringify(user))
    throw new Error('LOGIN_PRESERVATION_VERIFICATION_FAILED');
  const after = await inspectResetDatabase(client, schema);
  if (
    after.versions.join(',') !== '1,2,3,4,5,6' ||
    operationalTables.some((t) => after.counts[t] !== 0)
  )
    throw new Error('RESET_POSTCHECK_FAILED');
  return {
    username,
    role: 'ADMIN',
    userId: user.id,
    passwordHashPreserved: true,
    schemaVersions: after.versions,
    counts: after.counts,
  };
}
