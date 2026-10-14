import { z } from 'zod';
export const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  channelId: z.coerce.number().int().positive().optional(),
  direction: z.enum(['IN', 'OUT', 'ALL']).default('IN'),
  statusGroup: z.enum(['errors', 'pending']).optional(),
  status: z
    .enum([
      'IN-PROCESS',
      'IN-ERROR',
      'SUCCESS',
      'PARTIAL',
      'FAILED',
      'RECEIVED',
      'FILTERED',
      'OUT-SENT',
      'OUT-ERROR',
      'QUEUED',
      'RETRYING',
      'PROCESSING',
      'DEAD_LETTER',
    ])
    .optional(),
  search: z.string().max(100).optional(),
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
});
export type MonitorQuery = z.infer<typeof querySchema>;
