import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, chmod, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import pg from 'pg';
export function restoreTarget(url: string, confirmed: boolean) {
  const parsed = new URL(url),
    name = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !confirmed ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    !/^mirth_disposable_[a-z0-9_]+$/.test(name)
  )
    throw new Error('RESTORE_REQUIRES_CONFIRMED_LOCAL_DISPOSABLE_DATABASE');
  return name;
}
export function postgresEnvironment(url: string) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    throw new Error('INVALID_BACKUP_DATABASE');
  // libpq credentials go through child environment, never command-line arguments or inherited debug output.
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGSSLMODE: process.env.PGSSLMODE || 'verify-full',
  };
}
export async function runPostgres(program: string, args: string[], url: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, {
      env: postgresEnvironment(url),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('error', () => reject(new Error('POSTGRES_TOOL_UNAVAILABLE')));
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('POSTGRES_TOOL_FAILED')),
    );
  });
}
async function checksum(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function keyBytes(key: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('BACKUP_ENCRYPTION_KEY_REQUIRED');
  return Buffer.from(key, 'hex');
}
export async function encryptBackup(source: string, target: string, key: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  await pipeline(
    createReadStream(source),
    cipher,
    createWriteStream(target, { flags: 'wx', mode: 0o600 }),
  );
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    sha256: await checksum(target),
  };
  await writeFile(target + '.json', JSON.stringify(manifest) + '\n', { flag: 'wx', mode: 0o600 });
}
export async function decryptBackup(source: string, target: string, key: string) {
  const manifest = JSON.parse(await readFile(source + '.json', 'utf8'));
  if (manifest.version !== 1 || (await checksum(source)) !== manifest.sha256)
    throw new Error('BACKUP_CHECKSUM_MISMATCH');
  const cipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(manifest.iv, 'hex'));
  cipher.setAuthTag(Buffer.from(manifest.tag, 'hex'));
  try {
    await pipeline(
      createReadStream(source),
      cipher,
      createWriteStream(target, { flags: 'wx', mode: 0o600 }),
    );
  } catch {
    await unlink(target).catch(() => {});
    throw new Error('BACKUP_DECRYPTION_FAILED');
  }
}
export async function backupDatabase(url: string, directory: string, key: string) {
  keyBytes(key);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = await mkdtemp(path.join(tmpdir(), 'mirth-backup-'));
  const dump = path.join(temporary, 'database.dump'),
    target = path.join(
      directory,
      'mirth-' + new Date().toISOString().replace(/[:.]/g, '-') + '.dump.enc',
    );
  try {
    await runPostgres(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-acl', '--file', dump],
      url,
    );
    await chmod(dump, 0o600);
    await encryptBackup(dump, target, key);
    return target;
  } finally {
    await unlink(dump).catch(() => {});
    const { rmdir } = await import('node:fs/promises');
    await rmdir(temporary);
  }
}
export async function restoreDatabase(url: string, file: string, key: string, confirmed: boolean) {
  restoreTarget(url, confirmed);
  keyBytes(key);
  const connection = new pg.Client({ connectionString: url });
  await connection.connect();
  try {
    const rows = await connection.query(
      "SELECT count(*) count FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')",
    );
    if (Number(rows.rows[0].count) !== 0) throw new Error('RESTORE_TARGET_MUST_BE_EMPTY');
  } finally {
    await connection.end();
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'mirth-restore-')),
    dump = path.join(temporary, 'database.dump');
  try {
    await decryptBackup(file, dump, key);
    await runPostgres(
      'pg_restore',
      [
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-acl',
        '--dbname',
        restoreTarget(url, confirmed),
        dump,
      ],
      url,
    );
  } finally {
    await unlink(dump).catch(() => {});
    const { rmdir } = await import('node:fs/promises');
    await rmdir(temporary);
  }
}
