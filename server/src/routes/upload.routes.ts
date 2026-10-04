import { Router } from 'express';
import multer from 'multer';
import { config } from '../config/env.js';
import { importChannelXml } from '../services/xmlLoader.services.js';
import { createChannel } from '../services/channel.services.js';
import { requirePermission } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.server.payloadLimit, files: 1, fields: 0 },
});
router.post(
  '/xml',
  requirePermission('channel:write'),
  (req, res, next) =>
    upload.single('file')(req, res, (error) =>
      error
        ? next(new AppError(400, 'UPLOAD_LIMIT', 'Invalid upload or size limit exceeded'))
        : next(),
    ),
  async (req, res, next) => {
    try {
      if (!req.file) throw new AppError(400, 'FILE_REQUIRED', 'XML file required');
      req.body = await importChannelXml(req.file.buffer.toString('utf8'));
      await createChannel(req, res, next);
    } catch (error) {
      next(error);
    }
  },
);
export default router;
