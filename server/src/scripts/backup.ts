import { backupDatabase, restoreDatabase, restoreTarget } from '../utils/backup.js';
import { readFile } from 'node:fs/promises';
// Explicit opt-in environment only; never load the application's .env or production connection implicitly.
try {
  const url = process.env.BACKUP_DATABASE_URL || '',
    key = process.env.BACKUP_ENCRYPTION_KEY_FILE
      ? (await readFile(process.env.BACKUP_ENCRYPTION_KEY_FILE, 'utf8')).trim()
      : process.env.BACKUP_ENCRYPTION_KEY || '';
  const action = process.argv[2];
  if (action === 'backup') {
    await backupDatabase(url, process.env.BACKUP_DIRECTORY || './backups', key);
    console.info('Encrypted backup and checksum manifest created');
  } else if (action === 'restore' || action === 'verify-restore') {
    const file = process.argv[process.argv.indexOf('--file') + 1];
    if (!process.argv.includes('--file') || !file) throw new Error('BACKUP_FILE_REQUIRED');
    restoreTarget(url, process.env.RESTORE_DISPOSABLE_CONFIRMED === 'true');
    await restoreDatabase(url, file, key, true);
    console.info('Backup restored into empty disposable database');
    if (action === 'verify-restore') {
      process.env.DATABASE_URL = url;
      process.env.PG_SCHEMA = process.env.BACKUP_SCHEMA || 'public';
      process.env.NODE_ENV = 'test';
      const { verifyRestoredDatabase } =
        await import('../services/restoreVerification.services.js');
      console.info(JSON.stringify(await verifyRestoredDatabase(url, process.env.PG_SCHEMA)));
    }
  } else throw new Error('INVALID_BACKUP_ACTION');
} catch (error) {
  const diagnostic =
    error instanceof Error && /^[A-Z_]{1,80}$/.test(error.message)
      ? error.message
      : 'BACKUP_RESTORE_FAILED';
  console.error(diagnostic);
  console.error(
    'Backup/restore failed; inspect environment, tools, checksum and disposable target. No credential or database output is printed.',
  );
  process.exitCode = 1;
}
