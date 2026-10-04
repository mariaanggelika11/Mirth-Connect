import { Router } from 'express';
import { getDestinationLog } from '../services/destination.services.js';
import { requirePermission } from '../middleware/auth.js';
import { validateId } from '../utils/validator.js';
const router = Router();
router.get('/log/:messageId', requirePermission('message:payload'), validateId, getDestinationLog);
export default router;
