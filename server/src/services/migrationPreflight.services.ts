import type { DatabaseTransaction } from '../config/db.js';
import { decrypt } from '../utils/secrets.js';
export async function migrationPreflight(tx: DatabaseTransaction) {
  const version = (await tx.request().query('SHOW server_version_num')).recordset[0];
  if (Number(version?.server_version_num) < 140000)
    throw new Error('POSTGRESQL_14_OR_NEWER_REQUIRED');
  const tables = (
    await tx
      .request()
      .query(
        'SELECT to_regclass(\'"Users"\') users,to_regclass(\'"Destinations"\') destinations,to_regclass(\'"Channels"\') channels,to_regclass(\'"Messages"\') messages,to_regclass(\'"SchemaMigrations"\') migrations',
      )
  ).recordset[0];
  const schemaVersions = tables?.migrations
    ? (
        await tx.request().query('SELECT version FROM "SchemaMigrations" ORDER BY version')
      ).recordset.map((row) => Number(row.version))
    : [];
  if (schemaVersions.some((version) => version > 8))
    throw new Error('UNSUPPORTED_MIGRATION_SCHEMA_VERSION');
  let duplicateUsernames = 0,
    legacyRoles = 0,
    encryptedVerified = 0;
  if (tables?.users) {
    duplicateUsernames = (
      await tx.request().query('SELECT username FROM "Users" GROUP BY username HAVING count(*)>1')
    ).recordset.length;
    legacyRoles = (
      await tx
        .request()
        .query(
          "SELECT id FROM \"Users\" WHERE upper(role) NOT IN ('ADMIN','DEVELOPER','OPERATOR','VIEWER')",
        )
    ).recordset.length;
  }
  if (duplicateUsernames) throw new Error('DUPLICATE_USERNAMES_REQUIRES_MANUAL_RECONCILIATION');
  if (tables?.destinations) {
    for (const row of (
      await tx.request().query('SELECT endpoint FROM "Destinations" WHERE endpoint LIKE \'enc:%\'')
    ).recordset) {
      decrypt(row.endpoint);
      encryptedVerified++;
    }
  }
  for (const [table, column] of [
    ['Channels', 'source_api_key'],
    ['Messages', 'transport_config'],
    ['ChannelRevisions', 'configuration'],
  ]) {
    const present = (
      await tx
        .request()
        .input('table', table)
        .input('column', column)
        .query(
          'SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=@table AND column_name=@column',
        )
    ).recordset.length;
    if (present)
      for (const row of (
        await tx
          .request()
          .query(`SELECT ${column} value FROM "${table}" WHERE ${column} LIKE 'enc:%'`)
      ).recordset) {
        decrypt(row.value);
        encryptedVerified++;
      }
  }
  return {
    postgresVersion: Number(version?.server_version_num),
    duplicateUsernames,
    legacyRoles,
    encryptedVerified,
    schemaVersions,
    targetSchemaVersion: 8,
    browserSessionsRequireFreshLogin: !schemaVersions.includes(8),
    storageCapacity: 'RUNTIME VERIFICATION REQUIRED',
  };
}
