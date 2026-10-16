import { z } from 'zod';
import { config } from '../config/env.js';
import type { RequestHandler } from 'express';
import { AppError } from './errors.js';
const script = z.string().max(65536).default('');
const dataType = z.enum(['HL7V2', 'JSON', 'XML', 'TEXT']);
const xmlPath = z
  .string()
  .max(300)
  .regex(/^[A-Za-z_][\w:-]*(?:\.[A-Za-z_][\w:-]*){0,15}$/);
export const xmlProfileSchema = z
  .object({
    root: z
      .string()
      .max(100)
      .regex(/^[A-Za-z_][\w:-]*$/)
      .optional(),
    requiredPaths: z.array(xmlPath).max(50).optional(),
    values: z
      .array(
        z.object({ path: xmlPath, allowed: z.array(z.string().max(300)).min(1).max(50) }).strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();
export const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9_.@-]+$/),
  password: z
    .string()
    .min(1)
    .max(72)
    .refine((v) => Buffer.byteLength(v) <= 72, 'Password exceeds bcrypt byte limit'),
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
export const deliveryPolicySchema = z
  .object({
    failureThreshold: z.number().int().min(1).max(100).optional(),
    openSeconds: z.number().int().min(1).max(3600).optional(),
    maxConcurrency: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const destinationSchema = z.object({
  deliveryPolicy: deliveryPolicySchema.default({}),
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
  validationProfile: z
    .object({
      basicSyntax: z.boolean().optional(),
      jsonSchema: z.record(z.string(), z.unknown()).optional(),
      xml: xmlProfileSchema.optional(),
      hl7: z
        .object({
          messageTypes: z.array(z.string().max(50)).max(50).optional(),
          versions: z.array(z.string().max(20)).max(20).optional(),
          requiredFields: z
            .array(z.string().regex(/^[A-Z0-9]{3}\.[1-9][0-9]{0,2}$/))
            .max(50)
            .optional(),
        })
        .optional(),
      script: z.string().max(65536).optional(),
    })
    .default({}),
  idempotencyMode: z
    .enum(['OPTIONAL', 'REQUIRED', 'DISABLED'])
    .default(config.inbound.idempotencyMode),
  changeSummary: z.string().trim().min(1).max(500).optional(),
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
// A revision editor never needs to receive/repost credentials or hidden script bodies.
// Only this explicit public subset can be patched; all other fields are retained server-side.
export const draftPatchSchema = z
  .object({
    expectedChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    changeSummary: z.string().trim().min(1).max(500),
    patch: z
      .object({
        name: channelSchema.shape.name.optional(),
        idempotencyMode: z.enum(['OPTIONAL', 'REQUIRED', 'DISABLED']).optional(),
        source: z
          .object({
            type: z.enum(['HTTP', 'HL7']).optional(),
            inboundDataType: dataType.optional(),
          })
          .strict()
          .optional(),
        destinations: z
          .array(
            z
              .object({
                index: z.number().int().min(0).max(49),
                name: destinationSchema.shape.name.optional(),
                isEnabled: z.boolean().optional(),
                retryEnabled: z.boolean().optional(),
                maxRetries: z.number().int().min(0).max(10).optional(),
                retryIntervalSeconds: z.number().int().min(1).max(86400).optional(),
                timeoutMs: z.number().int().min(100).max(120000).optional(),
                outboundDataType: dataType.optional(),
                deliveryPolicy: deliveryPolicySchema.optional(),
              })
              .strict(),
          )
          .max(50)
          .optional(),
      })
      .strict()
      .refine((patch) => Object.keys(patch).length > 0, 'Provide changes'),
  })
  .strict();
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
