import { Router, text, json } from 'express';
import * as service from '../services/message.services.js';
import { requirePermission } from '../middleware/auth.js';
import { validateId } from '../utils/validator.js';
import { config } from '../config/env.js';
import { z } from 'zod';
import { validate } from '../utils/validator.js';
import { reconcileDeadLetter } from '../services/deadLetter.services.js';
const router = Router();
router.put(
  '/:id/reconciliation',
  requirePermission('message:resend'),
  json({ limit: config.server.payloadLimit }),
  validateId,
  validate(
    z
      .object({
        state: z.enum(['OPEN', 'ACKNOWLEDGED', 'IN_REVIEW', 'RESOLVED', 'IGNORED']),
        note: z.string().trim().min(1).max(1000),
        category: z.enum(['TRANSPORT', 'ACK', 'SCRIPT', 'CONFIGURATION', 'CAPACITY', 'UNKNOWN']),
        assignedTo: z.number().int().positive().optional(),
      })
      .strict(),
  ),
  reconcileDeadLetter,
);
// Backward-compatible management-JWT source endpoint; external sources use /api/inbound.
router.post(
  '/inbound/:channelId',
  requirePermission('inbound:send'),
  validateId,
  text({ type: '*/*', limit: config.server.payloadLimit }),
  service.handleInboundMessage,
);
router.get('/', requirePermission('message:read'), service.getMessages);
router.get('/stats', requirePermission('message:read'), service.getMessageStats);
router.get('/:id', requirePermission('message:read'), validateId, service.getMessageDetail);
router.post('/resend/:id', requirePermission('message:resend'), validateId, service.resendMessage);
export default router;
