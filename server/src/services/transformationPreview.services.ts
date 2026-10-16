import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { channelSchema, destinationSchema } from '../utils/validator.js';
import { AppError } from '../utils/errors.js';
import { audit } from './audit.services.js';
import { presentDryRun, rawDryRunRequested, runConfiguration } from './dryRun.services.js';

// Mapping is configured before destination connectivity. Keep every runtime field/schema
// while allowing connection details to remain empty during this transformation-only test.
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
        : new AppError(
            400,
            'TRANSFORMATION_PREVIEW_INVALID',
            'Invalid transformation configuration or synthetic payload',
          ),
    );
  }
}
