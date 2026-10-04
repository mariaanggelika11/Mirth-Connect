import { z } from 'zod';
import { RequestHandler } from 'express';
import { AppError } from './errors.js';
const script = z.string().max(65536).default('');
const dataType = z.enum(['HL7V2', 'JSON', 'XML', 'TEXT']);
export const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9_.@-]+$/),
  password: z.string().min(1).max(72).refine(v=>Buffer.byteLength(v)<=72,'Password exceeds bcrypt byte limit'),
});
export const registration = credentials
  .extend({
    password: z
      .string()
      .min(12)
      .max(72)
      .refine((v) => Buffer.byteLength(v) <= 72, 'Password exceeds bcrypt byte limit'),
    name: z.string().trim().min(1).max(150),
  })
  .strict();
export const destinationSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(150),
  type: z.enum(['REST', 'HL7', 'MLLP', 'TCP', 'RAW']),
  endpoint: z.string().trim().min(1).max(2048),
  outboundDataType: dataType.default('HL7V2'),
  processingScript: script,
  responseScript: script,
  templateScript: script,
  filterScript: script,
  isEnabled: z.boolean().default(true),
  retryEnabled: z.boolean().default(false),
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryIntervalSeconds: z.number().int().min(1).max(86400).default(30),
  timeoutMs: z.number().int().min(100).max(120000).default(10000),
});
export const channelSchema = z.object({
  name: z.string().trim().min(1).max(150),
  source: z.object({
    type: z.enum(['HTTP', 'HL7']),
    inboundDataType: dataType.default('HL7V2'),
    endpoint: z.string().optional(),
  }),
  destinations: z.array(destinationSchema).max(50),
  processingScript: script,
  responseScript: script,
  filterScript: script,
});
export const validate =
  (schema: z.ZodType): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success)
      return next(
        new AppError(
          400,
          'VALIDATION_ERROR',
          'Invalid request fields: ' +
            [...new Set(result.error.issues.map((i) => i.path.join('.')))].join(', '),
        ),
      );
    req.body = result.data;
    next();
  };
export const validateId: RequestHandler = (req, _res, next) => {
  for (const [key, value] of Object.entries(req.params))
    if (/^(id|channelId|messageId)$/.test(key) && !/^[1-9]\d{0,9}$/.test(value))
      return next(new AppError(400, 'INVALID_ID', 'Invalid identifier'));
  next();
};
