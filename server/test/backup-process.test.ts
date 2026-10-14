import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, chmod, mkdir, readFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { backupDatabase, decryptBackup } from '../src/utils/backup.js';
const url =
  'postgresql://synthetic:synthetic-fixture-password@localhost/mirth_disposable_backup_unit';
const key = 'a'.repeat(64);
let directory: string;
const previousPath = process.env.PATH,
  previousArgsFile = process.env.MIRTH_TEST_ARGS_FILE;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mirth-backup-process-test-'));
  const bin = path.join(directory, 'bin');
  await mkdir(bin);
  const program = path.join(bin, 'pg_dump');
  await writeFile(
    program,
    `#!/usr/bin/env node\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.writeFileSync(process.env.MIRTH_TEST_ARGS_FILE,JSON.stringify({args,passwordSupplied:!!process.env.PGPASSWORD}),{mode:0o600}); fs.writeFileSync(args[args.indexOf('--file')+1],'synthetic archive fixture',{mode:0o600});\n`,
    { mode: 0o700 },
  );
  await chmod(program, 0o700);
  process.env.PATH = bin + path.delimiter + previousPath;
  process.env.MIRTH_TEST_ARGS_FILE = path.join(directory, 'args.json');
});
afterEach(async () => {
  process.env.PATH = previousPath;
  if (previousArgsFile === undefined) delete process.env.MIRTH_TEST_ARGS_FILE;
  else process.env.MIRTH_TEST_ARGS_FILE = previousArgsFile;
  await rm(directory, { recursive: true, force: true });
});
describe('Backup snapshot process boundaries', () => {
  for (const snapshot of [undefined, '00000003-00000009-1'])
    it(
      'preserves encrypted archive and private modes with ' +
        (snapshot ? 'an exported snapshot' : 'legacy default arguments'),
      async () => {
        const target = await backupDatabase(url, path.join(directory, 'backups'), key, snapshot);
        const invocation = JSON.parse(await readFile(process.env.MIRTH_TEST_ARGS_FILE!, 'utf8'));
        expect(invocation.passwordSupplied).toBe(true);
        expect(JSON.stringify(invocation.args)).not.toContain('synthetic-fixture-password');
        expect(JSON.stringify(invocation.args)).not.toContain('postgresql://');
        if (snapshot)
          expect(invocation.args[invocation.args.indexOf('--snapshot') + 1]).toBe(snapshot);
        else expect(invocation.args).not.toContain('--snapshot');
        const restored = path.join(directory, 'restored');
        await decryptBackup(target, restored, key);
        expect(await readFile(restored, 'utf8')).toBe('synthetic archive fixture');
        expect((await stat(target)).mode & 0o777).toBe(0o600);
        expect((await stat(target + '.json')).mode & 0o777).toBe(0o600);
        expect((await stat(path.dirname(target))).mode & 0o777).toBe(0o700);
      },
    );
  it('rejects invalid snapshot options before spawning any process', async () => {
    await expect(
      backupDatabase(url, path.join(directory, 'unused'), key, 'invalid --file /private'),
    ).rejects.toThrow('INVALID_BACKUP_SNAPSHOT');
    await expect(stat(path.join(directory, 'unused'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves unavailable-tool error during cleanup of a missing dump', async () => {
    const empty = path.join(directory, 'empty');
    await mkdir(empty);
    process.env.PATH = empty;
    await expect(backupDatabase(url, path.join(directory, 'failed'), key)).rejects.toThrow(
      'POSTGRES_TOOL_UNAVAILABLE',
    );
  });
});
