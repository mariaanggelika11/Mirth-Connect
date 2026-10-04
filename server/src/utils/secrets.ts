import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config/env.js';
import { AppError } from './errors.js';
export function encrypt(value: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return 'enc:v1:' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
export function decrypt(value: string): string {
  if (!value.startsWith('enc:v1:')) return value;
  const data = Buffer.from(value.slice(7), 'base64');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(config.encryptionKey, 'hex'),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
export function publicEndpoint(value: string): { endpoint: string; credentialConfigured: boolean } {
  const raw = decrypt(value);
  const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'tcp://' + raw);
  const credentialConfigured = !!(url.username || url.password || url.search);
  if (credentialConfigured) {
    url.username = '';
    url.password = '';
    url.search = '';
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
