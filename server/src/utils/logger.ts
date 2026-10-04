import pino from 'pino';
import { config } from '../config/env.js';
// Log only identifiers/status codes. Never pass payloads, request bodies or Error objects here.
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ['password', 'token', 'authorization', 'payload', 'rawMessage', 'secret'],
    censor: '[REDACTED]',
  },
});
