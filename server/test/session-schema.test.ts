import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import type { DatabaseTransaction } from '../src/config/db.js';
import { migrationPreflight } from '../src/services/migrationPreflight.services.js';
import { inspectResetDatabase } from '../src/scripts/development-reset-core.js';

function preflightDatabase(versions: number[]) {
  const query = vi.fn(async (sql: string) => ({
    recordset: sql.startsWith('SHOW')
      ? [{ server_version_num: 160000 }]
      : sql.includes('to_regclass')
        ? [{ migrations: true }]
        : sql.includes('SELECT version')
          ? versions.map((version) => ({ version }))
          : [],
  }));
  const request = { query, input: () => request };
  return { query, tx: { request: () => request } as unknown as DatabaseTransaction };
}

function resetDatabase(versions: number[], additionalTables: string[] = []) {
  const tables = ['Users', 'SchemaMigrations', 'BrowserSessions', 'BrowserSessionFamilies'];
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM pg_tables'))
      return { rows: [...tables, ...additionalTables].map((tablename) => ({ tablename })) };
    if (sql.includes('SELECT version')) return { rows: versions.map((version) => ({ version })) };
    if (sql.includes('SELECT count(*)')) return { rows: [{ total: 0 }] };
    if (sql.includes('fingerprint')) return { rows: [{ fingerprint: 'synthetic-digest' }] };
    return { rows: [], rowCount: 0 };
  });
  return { query, client: { query } as unknown as Client };
}

describe('Browser session policy schema compatibility', () => {
  it('preflight reports the one-time legacy login reset before upgrading schema 7', async () => {
    const { query, tx } = preflightDatabase([1, 2, 3, 4, 5, 6, 7]);
    expect(await migrationPreflight(tx)).toMatchObject({
      schemaVersions: [1, 2, 3, 4, 5, 6, 7],
      targetSchemaVersion: 8,
      browserSessionsRequireFreshLogin: true,
    });
    expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE|ALTER)/.test(sql))).toBe(false);
  });

  it('preflight does not request a repeated login reset after schema 8', async () => {
    const { tx } = preflightDatabase([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await migrationPreflight(tx)).browserSessionsRequireFreshLogin).toBe(false);
  });

  it('preflight refuses future schemas instead of applying an older migration set', async () => {
    const { query, tx } = preflightDatabase([1, 8, 9]);
    await expect(migrationPreflight(tx)).rejects.toThrow('UNSUPPORTED_MIGRATION_SCHEMA_VERSION');
    expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE|ALTER)/.test(sql))).toBe(false);
  });

  it('reset inspection recognizes family history as an application table at schema 8', async () => {
    const { client } = resetDatabase([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await inspectResetDatabase(client, 'mirth_test_session')).toMatchObject({
      versions: [1, 2, 3, 4, 5, 6, 7, 8],
      counts: { BrowserSessions: 0, BrowserSessionFamilies: 0 },
      fingerprints: { BrowserSessionFamilies: 'synthetic-digest' },
    });
  });

  it('reset still rejects future schemas and unrelated tables', async () => {
    await expect(
      inspectResetDatabase(resetDatabase([1, 8, 9]).client, 'mirth_test_session'),
    ).rejects.toThrow('UNSUPPORTED_RESET_SCHEMA_VERSION');
    await expect(
      inspectResetDatabase(
        resetDatabase([1, 8], ['UnrelatedPatientTable']).client,
        'mirth_test_session',
      ),
    ).rejects.toThrow('RESET_SCHEMA_NOT_EXCLUSIVELY_MIRTH');
  });
});
