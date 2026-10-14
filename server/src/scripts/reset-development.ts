import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../config/env.js';
import { backupDatabase, decryptBackup } from '../utils/backup.js';
import {
  inspectResetDatabase,
  lockResetDatabase,
  resetToSingleAdmin,
} from './development-reset-core.js';
const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
};
const mode = process.argv.includes('--prepare-backup')
  ? 'BACKUP'
  : process.argv.includes('--execute')
    ? 'EXECUTE'
    : 'PREVIEW';
const url = new URL(config.database.connectionString);
const identity = {
  host: url.hostname,
  database: config.database.database,
  schema: config.database.schema,
};
const client = new pg.Client({
  connectionString: config.database.connectionString,
  application_name: 'mirth-development-reset',
  options: '-c timezone=UTC -c search_path=' + config.database.schema,
  connectionTimeoutMillis: 10000,
  statement_timeout: 60000,
  ssl: config.database.ssl && {
    ...config.database.ssl,
    ...(config.database.caFile ? { ca: await readFile(config.database.caFile, 'utf8') } : {}),
  },
});
let stage = 'TARGET_GUARDS';
let committed = false;
let commitAttempted = false;
let transactionStarted = false;
let preparedReport: string | undefined;
try {
  if (
    ['--prepare-backup', '--execute', '--dry-run'].filter((flag) => process.argv.includes(flag))
      .length > 1
  )
    throw new Error('CONFLICTING_RESET_MODES');
  if (config.production || !/dev|test|disposable/i.test(identity.database))
    throw new Error('DEVELOPMENT_DATABASE_REQUIRED');
  if (
    mode !== 'PREVIEW' &&
    (option('--confirm-database') !== identity.database ||
      option('--confirm-host') !== identity.host)
  )
    throw new Error('EXACT_RESET_TARGET_CONFIRMATION_REQUIRED');
  stage = 'CONNECT';
  await client.connect();
  await client.query(mode === 'BACKUP' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
  transactionStarted = true;
  if (mode === 'PREVIEW') await client.query('SET TRANSACTION READ ONLY');
  stage = 'READ_PLAN';
  const before = await inspectResetDatabase(client, identity.schema);
  if (mode === 'PREVIEW') {
    console.info(
      JSON.stringify({ mode, identity, versions: before.versions, counts: before.counts }),
    );
  } else {
    stage = 'LOCK_SOURCE';
    await lockResetDatabase(
      client,
      identity.schema,
      before.tables,
      mode === 'BACKUP' ? 'SHARE' : 'ACCESS EXCLUSIVE',
    );
    const source = await inspectResetDatabase(client, identity.schema);
    if (mode === 'BACKUP') {
      const directory = path.resolve(
        option('--directory') ||
          'backups/development-reset-' + new Date().toISOString().replace(/[:.]/g, '-'),
      );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const key = randomBytes(32).toString('hex'),
        keyFile = path.join(directory, 'recovery.key');
      await writeFile(keyFile, key + '\n', { flag: 'wx', mode: 0o600 });
      process.env.PGSSLMODE = config.database.ssl ? 'verify-full' : 'disable';
      if (config.database.caFile) process.env.PGSSLROOTCERT = config.database.caFile;
      const snapshot = (await client.query('SELECT pg_export_snapshot() snapshot')).rows[0]
        .snapshot;
      const file = await backupDatabase(config.database.connectionString, directory, key, snapshot);
      const receipt = path.join(directory, 'receipt.json');
      await writeFile(
        receipt,
        JSON.stringify(
          {
            version: 1,
            createdAt: new Date().toISOString(),
            identity,
            file,
            keyFile,
            source,
            restoreVerified: false,
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
      console.info(
        JSON.stringify({ mode, identity, file, keyFile, receipt, counts: source.counts }),
      );
    } else {
      stage = 'READ_VERIFIED_RECEIPT';
      const receipt = JSON.parse(await readFile(option('--receipt'), 'utf8'));
      if (
        receipt.version !== 1 ||
        !receipt.restoreVerified ||
        JSON.stringify(receipt.identity) !== JSON.stringify(identity)
      )
        throw new Error('VERIFIED_MATCHING_BACKUP_REQUIRED');
      stage = 'SOURCE_FINGERPRINT';
      if (JSON.stringify(receipt.source.fingerprints) !== JSON.stringify(source.fingerprints))
        throw new Error('SOURCE_CHANGED_SINCE_BACKUP');
      stage = 'VERIFY_BACKUP_FILE';
      const temporary = await mkdtemp(path.join(tmpdir(), 'mirth-reset-verify-'));
      try {
        await decryptBackup(
          receipt.file,
          path.join(temporary, 'verified.dump'),
          (await readFile(receipt.keyFile, 'utf8')).trim(),
        );
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
      if (!option('--keep-user')) throw new Error('EXPLICIT_ADMIN_REQUIRED');
      stage = 'MIGRATE_AND_RESET';
      const result = await resetToSingleAdmin(client, identity.schema, option('--keep-user'));
      await writeFile(
        path.join(path.dirname(option('--receipt')), 'reset-result.json'),
        JSON.stringify(
          { status: 'PREPARED', identity, result, executedAt: new Date().toISOString() },
          null,
          2,
        ) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
      preparedReport = path.join(path.dirname(option('--receipt')), 'reset-result.json');
      stage = 'COMMIT';
      commitAttempted = true;
      await client.query('COMMIT');
      transactionStarted = false;
      committed = true;
      await writeFile(
        path.join(path.dirname(option('--receipt')), 'reset-result.json'),
        JSON.stringify(
          { status: 'COMMITTED', identity, result, executedAt: new Date().toISOString() },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      );
      console.info(JSON.stringify({ mode, status: 'COMMITTED', ...result }));
    }
  }
  if (mode !== 'EXECUTE') {
    await client.query('ROLLBACK');
    transactionStarted = false;
  }
} catch (error) {
  if (transactionStarted) await client.query('ROLLBACK').catch(() => {});
  if (!commitAttempted && preparedReport) await rm(preparedReport, { force: true }).catch(() => {});
  console.error(
    JSON.stringify({
      stage,
      errorType: error instanceof Error ? error.name : 'Unknown',
      diagnostic:
        error instanceof TypeError && /^Cannot (?:read|convert)/.test(error.message)
          ? error.message
          : undefined,
      status: committed
        ? 'RESET_COMMITTED_REPORT_WRITE_FAILED'
        : commitAttempted
          ? 'RESET_COMMIT_OUTCOME_UNKNOWN'
          : 'RESET_NOT_COMPLETED',
      code:
        error instanceof Error && /^[A-Z_0-9]{1,100}$/.test(error.message)
          ? error.message
          : typeof (error as { code?: unknown })?.code === 'string'
            ? (error as { code: string }).code
            : 'RESET_FAILED',
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
