import { validatePayload } from './profileValidation.services.js';
import { performance } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';
import { channelSchema } from '../utils/validator.js';
import type { RevisionConfig } from './revision.services.js';
import { validateEndpoint } from '../utils/transport.js';
import { hl7ToJson } from '../utils/hl7Converer.js';
import { executeScript } from './script.services.js';
import { convertPayload } from './engine/conversion.js';
import { safeError, AppError } from '../utils/errors.js';
import { hasPermission } from '../middleware/auth.js';
import { maskPayload } from '../utils/masking.js';
import { audit } from './audit.services.js';

function outputFormat(payload: unknown) {
  if (typeof payload !== 'string') return 'JSON';
  if (payload.startsWith('MSH')) return 'HL7V2';
  if (payload.trim().startsWith('<')) return 'XML';
  try {
    JSON.parse(payload);
    return 'JSON';
  } catch {
    return 'TEXT';
  }
}
export async function runConfiguration(data: RevisionConfig, syntheticPayload: unknown) {
  const started = performance.now();
  let payload: unknown = structuredClone(syntheticPayload);
  const input = { format: data.source.inboundDataType, payload: structuredClone(payload) };
  if (payload === undefined)
    throw new AppError(400, 'SYNTHETIC_PAYLOAD_REQUIRED', 'Provide a synthetic payload');
  const source = {
    format: input.format as string,
    payload: undefined as unknown,
    validation: 'SKIPPED',
    filter: 'SKIPPED',
    transformation: 'SKIPPED',
    code: undefined as string | undefined,
  };
  let sourceStage: 'validation' | 'filter' | 'transformation' = 'validation';
  let accepted = false;
  try {
    await validatePayload(payload, data.source.inboundDataType, data.validationProfile);
    source.validation = 'PASSED';
    sourceStage = 'filter';
    accepted = Boolean(
      !data.filterScript.trim() ||
      (await executeScript(
        data.filterScript,
        { msg: data.source.inboundDataType === 'HL7V2' ? hl7ToJson(String(payload)) : payload },
        'true',
      )),
    );
    source.filter = accepted ? 'ACCEPTED' : 'FILTERED';
    sourceStage = 'transformation';
    if (accepted && data.processingScript.trim())
      payload = await executeScript(data.processingScript, { msg: payload });
    source.transformation = !accepted
      ? 'SKIPPED'
      : data.processingScript.trim()
        ? 'TRANSFORMED'
        : 'PASS_THROUGH';
    source.format = data.processingScript.trim() && accepted ? outputFormat(payload) : input.format;
    source.payload = payload;
  } catch (error) {
    source[sourceStage] = 'ERROR';
    source.code = safeError(error);
    return {
      success: false,
      accepted: false,
      input,
      source,
      networkDelivery: 'NOT_SENT',
      elapsedMs: Math.round(performance.now() - started),
      results: [],
      warnings: ['Source processing failed. No DNS lookup or network delivery was performed.'],
    };
  }
  const results = [];
  for (const destination of data.destinations) {
    const destinationStarted = performance.now();
    const stages = {
      filter: 'SKIPPED',
      transformation: 'SKIPPED',
      template: 'SKIPPED',
      conversion: 'SKIPPED',
    };
    let stage: keyof typeof stages = 'filter';
    try {
      validateEndpoint(destination.endpoint, destination.type);
      let outbound = structuredClone(payload);
      const routed = Boolean(
        accepted &&
        destination.isEnabled &&
        (!destination.filterScript.trim() ||
          (await executeScript(destination.filterScript, { msg: outbound }, 'true'))),
      );
      if (routed) {
        stages.filter = 'ACCEPTED';
        stage = 'transformation';
        if (destination.processingScript.trim())
          outbound = await executeScript(destination.processingScript, { msg: outbound });
        stages.transformation = destination.processingScript.trim()
          ? 'TRANSFORMED'
          : 'PASS_THROUGH';
        stage = 'template';
        if (destination.templateScript.trim())
          outbound = await executeScript(destination.templateScript, { msg: outbound });
        stages.template = destination.templateScript.trim() ? 'APPLIED' : 'NOT_CONFIGURED';
        stage = 'conversion';
        outbound = await convertPayload(outbound, destination.outboundDataType);
        stages.conversion = 'CONVERTED';
      } else if (accepted && destination.isEnabled) {
        stages.filter = 'FILTERED';
      }
      results.push({
        destinationId: destination.id,
        name: destination.name,
        outputFormat: destination.outboundDataType,
        connectorType: destination.type,
        routed,
        finalPayload: routed ? outbound : undefined,
        status: 'VALID',
        stages,
        elapsedMs: Math.round(performance.now() - destinationStarted),
      });
    } catch (error) {
      stages[stage] = 'ERROR';
      results.push({
        destinationId: destination.id,
        name: destination.name,
        outputFormat: destination.outboundDataType,
        connectorType: destination.type,
        status: 'ERROR',
        code: safeError(error),
        stages,
        elapsedMs: Math.round(performance.now() - destinationStarted),
      });
    }
  }
  return {
    success: results.every((result) => result.status !== 'ERROR'),
    accepted,
    input,
    source,
    networkDelivery: 'NOT_SENT',
    elapsedMs: Math.round(performance.now() - started),
    results,
    warnings: [
      'Synthetic payload only. No DNS lookup, network delivery or downstream response is performed.',
    ],
  };
}
export function rawDryRunRequested(req: Request) {
  const raw = req.query.raw === 'true' || req.body?.raw === true;
  if (raw && (!req.user || !hasPermission(req.user.role, 'message:raw')))
    throw new AppError(403, 'RAW_PAYLOAD_DENIED', 'Raw payload requires administrator permission');
  return raw;
}
export function presentDryRun(result: Awaited<ReturnType<typeof runConfiguration>>, raw: boolean) {
  const visible = (payload: unknown) => (raw ? payload : maskPayload(payload));
  return {
    ...result,
    rawPayload: raw,
    input: { ...result.input, payload: visible(result.input.payload) },
    source: { ...result.source, payload: visible(result.source.payload) },
    results: result.results.map((r) => ({ ...r, finalPayload: visible(r.finalPayload) })),
  };
}
export async function dryRun(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = rawDryRunRequested(req);
    const result = await runConfiguration(
      channelSchema.parse(req.body.configuration),
      req.body.payload,
    );
    await audit(raw ? 'DRY_RUN_CONFIGURATION_RAW' : 'DRY_RUN_CONFIGURATION', req, 'channel');
    res.json(presentDryRun(result, raw));
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(400, 'DRY_RUN_INVALID', 'Invalid configuration or synthetic payload'),
    );
  }
}
