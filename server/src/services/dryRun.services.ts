import { validatePayload } from './profileValidation.services.js';
import { performance } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';
import { channelSchema } from '../utils/validator.js';
import { validateEndpoint } from '../utils/transport.js';
import { hl7ToJson } from '../utils/hl7Converer.js';
import { executeScript } from './script.services.js';
import { convertPayload } from './engine/conversion.js';
import { safeError, AppError } from '../utils/errors.js';
export async function dryRun(req: Request, res: Response, next: NextFunction) {
  const started = performance.now();
  try {
    const data = channelSchema.parse(req.body.configuration);
    let payload: unknown = req.body.payload;
    if (payload === undefined)
      throw new AppError(400, 'SYNTHETIC_PAYLOAD_REQUIRED', 'Provide a synthetic payload');
    await validatePayload(payload, data.source.inboundDataType, data.validationProfile);
    if (data.source.inboundDataType === 'XML' && /<!DOCTYPE|<!ENTITY/i.test(String(payload)))
      throw new AppError(400, 'XML_ENTITIES_DENIED', 'XML entity declarations are not supported');
    const accepted =
      !data.filterScript.trim() ||
      (await executeScript(
        data.filterScript,
        { msg: data.source.inboundDataType === 'HL7V2' ? hl7ToJson(String(payload)) : payload },
        'true',
      ));
    if (accepted && data.processingScript.trim())
      payload = await executeScript(data.processingScript, { msg: payload });
    const results = [];
    for (const destination of data.destinations) {
      try {
        validateEndpoint(destination.endpoint, destination.type);
        let outbound = structuredClone(payload);
        const routed =
          accepted &&
          destination.isEnabled &&
          (!destination.filterScript.trim() ||
            (await executeScript(destination.filterScript, { msg: outbound }, 'true')));
        if (routed) {
          if (destination.processingScript.trim())
            outbound = await executeScript(destination.processingScript, { msg: outbound });
          if (destination.templateScript.trim())
            outbound = await executeScript(destination.templateScript, { msg: outbound });
          outbound = await convertPayload(outbound, destination.outboundDataType);
        }
        results.push({
          destinationId: destination.id,
          name: destination.name,
          routed,
          finalPayload: routed ? outbound : undefined,
          status: 'VALID',
        });
      } catch (error) {
        results.push({
          destinationId: destination.id,
          name: destination.name,
          status: 'ERROR',
          code: safeError(error),
        });
      }
    }
    res.json({
      success: true,
      accepted,
      elapsedMs: Math.round(performance.now() - started),
      results,
      warnings: [
        'Synthetic payload only. No DNS lookup, network delivery or downstream response is performed.',
      ],
    });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(400, 'DRY_RUN_INVALID', 'Invalid configuration or synthetic payload'),
    );
  }
}
