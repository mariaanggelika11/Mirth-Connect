import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config/env.js';
import { AppError } from './errors.js';
export function loadKeyring() {
  let previous: unknown;
  try {
    previous = JSON.parse(config.previousEncryptionKeys);
  } catch {
    throw new Error('INVALID_ENCRYPTION_KEYRING');
  }
  if (!previous || typeof previous !== 'object' || Array.isArray(previous))
    throw new Error('INVALID_ENCRYPTION_KEYRING');
  const keys = new Map<string, string>();
  for (const [id, key] of Object.entries(previous)) {
    if (
      !/^[a-zA-Z0-9_-]{1,32}$/.test(id) ||
      typeof key !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(key)
    )
      throw new Error('INVALID_ENCRYPTION_KEYRING');
    keys.set(id, key);
  }
  if (keys.has(config.encryptionKeyId)) throw new Error('DUPLICATE_ENCRYPTION_KEY_ID');
  keys.set(config.encryptionKeyId, config.encryptionKey);
  return keys;
}
export function encrypt(value: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return (
    'enc:v2:' +
    config.encryptionKeyId +
    ':' +
    Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
  );
}
export function decrypt(value: string): string {
  if (!value.startsWith('enc:')) return value;
  try {
    const legacy = value.startsWith('enc:v1:');
    const match = value.match(/^enc:v2:([a-zA-Z0-9_-]{1,32}):(.+)$/);
    if (!legacy && !match) throw new Error();
    const ring = loadKeyring();
    const candidates = legacy ? [...ring.values()] : [ring.get(match![1])];
    const data = Buffer.from(legacy ? value.slice(7) : match![2], 'base64');
    if (data.length < 28) throw new Error();
    for (const key of candidates) {
      if (!key) continue;
      try {
        const cipher = createDecipheriv(
          'aes-256-gcm',
          Buffer.from(key, 'hex'),
          data.subarray(0, 12),
        );
        cipher.setAuthTag(data.subarray(12, 28));
        return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
      } catch {
        /* Try historical keys for v1 records without a key identifier. */
      }
    }
    throw new Error();
  } catch {
    throw new AppError(500, 'ENCRYPTION_KEY_UNAVAILABLE', 'Encrypted configuration cannot be read');
  }
}
export function publicEndpoint(value: string): { endpoint: string; credentialConfigured: boolean } {
  const raw = decrypt(value);
  const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'tcp://' + raw);
  const credentialConfigured = !!(url.username || url.password || url.search || url.hash);
  if (credentialConfigured) {
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
  }
  return { endpoint: credentialConfigured ? url.toString() : raw, credentialConfigured };
}
export function storeEndpoint(value: string, previous?: string): string {
  if (previous && publicEndpoint(previous).endpoint === value) return previous;
  if (
    previous &&
    publicEndpoint(previous).credentialConfigured &&
    !publicEndpoint(value).credentialConfigured
  )
    throw new AppError(
      400,
      'CREDENTIAL_REENTRY_REQUIRED',
      'Re-enter endpoint credentials when changing the destination URL',
    );
  return encrypt(value);
}
