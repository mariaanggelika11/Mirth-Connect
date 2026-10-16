import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';
import { testConnection } from '../utils/transport.js';
import { audit } from './audit.services.js';

export const connectionProbeSchema = z
  .object({
    endpoint: z.string().trim().min(1).max(2048),
    type: z.enum(['REST', 'HL7', 'MLLP', 'TCP', 'RAW']),
    timeoutMs: z.number().int().min(100).max(10000).default(5000),
  })
  .strict();

let activeProbes = 0;
export async function withConnectionProbe<T>(run: () => Promise<T>) {
  if (activeProbes >= 4)
    throw new AppError(503, 'CONNECTION_TEST_CAPACITY', 'Connection test capacity exceeded');
  activeProbes++;
  try {
    return await run();
  } finally {
    activeProbes--;
  }
}

export async function probeDestination(req: Request, res: Response, next: NextFunction) {
  try {
    const data = connectionProbeSchema.parse(req.body);
    const result = await withConnectionProbe(async () => {
      // Never persist an unsaved endpoint: credentials may be embedded in its URL.
      await audit('TEST_UNSAVED_DESTINATION_CONNECTION', req, 'channel');
      return testConnection(data.endpoint, data.type, data.timeoutMs);
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}
