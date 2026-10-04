import { Router } from 'express';
import { z } from 'zod';
import { parseHL7ToTree } from '../services/hl7Parser.service.js';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../utils/validator.js';
const router = Router();
router.post(
  '/parse',
  requirePermission('message:payload'),
  validate(z.object({ message: z.string().min(1).max(1048576) })),
  (req, res, next) => {
    try {
      res.json(parseHL7ToTree(req.body.message));
    } catch (error) {
      next(error);
    }
  },
);
export default router;
