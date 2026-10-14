import pino from 'pino';
import { safeLogRecord } from './masking.js';
import { config } from '../config/env.js';
// Log only identifiers/status codes. Never pass payloads, request bodies or Error objects here.
export const logger = pino({
  level: config.logLevel,
  formatters: { log: safeLogRecord },
  redact: {
    paths: ['password', 'token', 'authorization', 'payload', 'rawMessage', 'secret'],
    censor: '[REDACTED]',
  },
});
