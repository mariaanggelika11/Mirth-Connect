import { Router } from 'express';
import { z } from 'zod';
import * as service from '../services/channel.services.js';
import { requirePermission } from '../middleware/auth.js';
import { validate, validateId, channelSchema } from '../utils/validator.js';
const router = Router();
router.get('/', requirePermission('channel:read'), service.getAllChannels);
router.post(
  '/',
  requirePermission('channel:write'),
  validate(channelSchema),
  service.createChannel,
);
router.put(
  '/:id',
  requirePermission('channel:write'),
  validateId,
  validate(channelSchema),
  service.updateChannel,
);
router.delete('/:id', requirePermission('channel:delete'), validateId, service.deleteChannel);
router.put(
  '/:id/status',
  requirePermission('channel:operate'),
  validateId,
  validate(z.object({ status: z.enum(['RUNNING', 'STOPPED', 'PAUSED', 'ERROR']) })),
  service.updateChannelStatus,
);
router.put(
  '/:id/credential',
  requirePermission('channel:write'),
  validateId,
  service.rotateSourceCredential,
);
export default router;
