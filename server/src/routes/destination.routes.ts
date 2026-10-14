import { Router } from 'express';
import { getDestinationLog } from '../services/destination.services.js';
import { requirePermission } from '../middleware/auth.js';
import { validateId, validate } from '../utils/validator.js';
import { z } from 'zod';
import { resetCircuit } from '../services/circuitBreaker.services.js';
const router = Router();
router.get('/log/:messageId', requirePermission('message:payload'), validateId, getDestinationLog);
router.post(
  '/:id/circuit/reset',
  requirePermission('channel:write'),
  validateId,
  validate(
    z
      .object({
        reason: z.enum(['DESTINATION_RECOVERED', 'CONFIGURATION_FIXED', 'SYNTHETIC_TEST']),
      })
      .strict(),
  ),
  resetCircuit,
);
export default router;
