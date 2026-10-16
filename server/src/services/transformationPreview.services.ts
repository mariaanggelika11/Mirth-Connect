import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { channelSchema, destinationSchema } from '../utils/validator.js';
import { AppError } from '../utils/errors.js';
import { audit } from './audit.services.js';
import {
  invalidPreviewConfiguration,
  presentDryRun,
  rawDryRunRequested,
  runConfiguration,
} from './dryRun.services.js';

// Keep partial destination settings compatible for API callers. The wizard only
// invokes this network-free preview after completing all configuration in Review.
const previewConfiguration = channelSchema.extend({
  destinations: z
    .array(
      destinationSchema.extend({
        name: z.string().trim().max(150).default(''),
        endpoint: z.string().trim().max(2048).default(''),
      }),
    )
    .max(50),
});
const previewRequest = z
  .object({
    configuration: previewConfiguration,
    payload: z.unknown().refine((value) => value !== undefined, 'Provide a synthetic payload'),
    raw: z.boolean().optional(),
  })
  .strict();

export async function previewTransformation(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = rawDryRunRequested(req);
    const { configuration, payload } = previewRequest.parse(req.body);
    const result = await runConfiguration(
      {
        ...configuration,
        destinations: configuration.destinations.map((destination, index) => ({
          ...destination,
          name: destination.name || `Destination ${index + 1}`,
        })),
      },
      payload,
      { validateConnections: false },
    );
    await audit(raw ? 'TRANSFORMATION_PREVIEW_RAW' : 'TRANSFORMATION_PREVIEW', req, 'channel');
    res.json({
      ...presentDryRun(result, raw),
      warnings: [
        ...result.warnings,
        'Connection settings are not validated by transformation preview.',
      ],
    });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : error instanceof z.ZodError
          ? invalidPreviewConfiguration(error, 'TRANSFORMATION_PREVIEW_INVALID')
          : new AppError(
              400,
              'TRANSFORMATION_PREVIEW_INVALID',
              'Unable to test this configuration. Review the sample and channel settings.',
            ),
    );
  }
}
