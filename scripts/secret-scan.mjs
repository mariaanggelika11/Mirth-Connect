import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  [
    'environment-secret',
    /^(?:JWT_SECRET|CONFIG_ENCRYPTION_KEY|INBOUND_API_KEY|SQL_PASSWORD|DB_PASSWORD|DATABASE_URL)[ \t]*=[ \t]*(?![ \t]*$|.*(?:USER:PASSWORD|test-only|localhost|YOUR_|CHANGE_ME|placeholder))[^\s]+/m,
  ],
];
const findings = [];
const git = (args) => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 }).toString();
const inspect = (content, file, commit) => {
  for (const [type, pattern] of patterns)
    if (pattern.test(content)) findings.push({ type, file, commit, rotation: 'UNVERIFIED' });
};
for (const file of git(['ls-files', '--cached', '--others', '--exclude-standard'])
  .split('\n')
  .filter(Boolean))
  if (existsSync(file)) inspect(readFileSync(file, 'utf8'), file, 'WORKTREE');
if (process.argv.includes('--history'))
  for (const commit of git(['rev-list', '--all']).split('\n').filter(Boolean)) {
    for (const file of git(['ls-tree', '-r', '--name-only', commit]).split('\n').filter(Boolean)) {
      if (/(?:\.env|\.(?:ts|tsx|js|json|ya?ml|pem|key|md))$/.test(file))
        inspect(git(['show', commit + ':' + file]), file, commit);
    }
  }
// Never output matched values or context. This targeted scanner supplements Gitleaks in CI.
console.log(JSON.stringify({ scanner: 'targeted-patterns-v1', findings }, null, 2));
if (findings.some((f) => f.commit === 'WORKTREE')) process.exitCode = 1;
