import { Router, text } from 'express';
import * as service from '../services/message.services.js';
import { requirePermission } from '../middleware/auth.js';
import { validateId } from '../utils/validator.js';
import { config } from '../config/env.js';
const router = Router();
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
