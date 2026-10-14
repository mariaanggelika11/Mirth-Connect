import { Router } from 'express';
import { z } from 'zod';
import * as service from '../services/channel.services.js';
import { requirePermission } from '../middleware/auth.js';
import { validate, validateId, channelSchema, draftPatchSchema } from '../utils/validator.js';
import * as revision from '../services/revision.services.js';
import { dryRun } from '../services/dryRun.services.js';
import { AppError } from '../utils/errors.js';
const router = Router();
router.post('/dry-run', requirePermission('channel:write'), dryRun);
const revisionId = (
  req: Parameters<typeof validateId>[0],
  res: Parameters<typeof validateId>[1],
  next: Parameters<typeof validateId>[2],
) => {
  if (!/^[1-9]\d{0,9}$/.test(req.params.revision))
    return res.status(400).json({
      success: false,
      code: 'INVALID_ID',
      message: 'Invalid revision',
      requestId: req.requestId,
    });
  next();
};
const publishSchema = z
  .object({
    expectedActiveRevision: z.number().int().min(0),
    changeSummary: z.string().trim().min(1).max(500),
  })
  .strict();
router.get(
  '/:id/revisions',
  requirePermission('channel:write'),
  validateId,
  revision.listRevisions,
);
router.get(
  '/:id/revisions/:revision',
  requirePermission('channel:write'),
  validateId,
  revisionId,
  revision.revisionDetail,
);
router.patch(
  '/:id/revisions/:revision',
  requirePermission('channel:write'),
  validateId,
  revisionId,
  validate(draftPatchSchema),
  revision.editDraft,
);
router.post(
  '/:id/revisions/:revision/dry-run',
  requirePermission('channel:write'),
  validateId,
  revisionId,
  validate(
    z
      .object({ payload: z.unknown().refine((v) => v !== undefined, 'Provide synthetic payload') })
      .strict(),
  ),
  revision.dryRunRevision,
);
router.post(
  '/:id/revisions/:revision/destinations/:index/test-connection',
  requirePermission('channel:write'),
  validateId,
  revisionId,
  (req, _res, next) => {
    if (!/^(?:[0-9]|[1-4][0-9])$/.test(req.params.index))
      return next(new AppError(400, 'INVALID_DESTINATION_INDEX', 'Invalid destination index'));
    next();
  },
  revision.testRevisionDestination,
);
for (const action of ['publish', 'rollback'])
  router.post(
    '/:id/revisions/:revision/' + action,
    requirePermission('channel:write'),
    validateId,
    revisionId,
    validate(publishSchema),
    revision.publishRevision,
  );
router.post(
  '/:id/revisions/:revision/archive',
  requirePermission('channel:write'),
  validateId,
  revisionId,
  revision.archiveRevision,
);
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
