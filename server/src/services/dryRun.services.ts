import { safeValidationResults } from '../utils/validationDiagnostics.js';
import type { ValidationRuleResult } from '../utils/validationRules.js';
import { validatePayload, FieldValidationError } from './profileValidation.services.js';
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
import { z } from 'zod';
import { compileFieldMapping, readFieldMapping } from '../utils/fieldMapping.js';

/** Describe only allowlisted configuration fields, never Zod input values or exception text. */
export function invalidPreviewConfiguration(error: z.ZodError, code: string): AppError {
  const suppliedPath = error.issues[0]?.path || [];
  const path =
    suppliedPath[0] === 'payload' || suppliedPath[0] === 'configuration'
      ? suppliedPath
      : ['configuration', ...suppliedPath];
  let message = 'Check Source, Transformation and Destination settings before testing.';
  if (path[0] === 'payload') message = 'Enter a synthetic sample message in Review before testing.';
  else if (path[0] === 'configuration') {
    if (path[1] === 'name') message = 'Enter a channel name in Source before testing.';
    else if (path[1] === 'source')
      message =
        path[2] === 'inboundDataType'
          ? 'Select a supported input format in Source.'
          : 'Select a supported source connector in Source.';
    else if (path[1] === 'filterScript')
      message = 'Complete the source filter condition or review the retained legacy configuration.';
    else if (path[1] === 'validationProfile')
      message =
        'The custom validation schema must be a JSON object. Check its settings in Advanced source settings.';
    else if (path[1] === 'destinations') {
      const index = path[2];
      const destination =
        typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < 50
          ? `Destination ${index + 1}`
          : 'Destination';
      const fields: Record<string, string> = {
        name: 'enter a valid destination name.',
        type: 'choose a supported connector.',
        endpoint: 'enter a valid endpoint within the 2048-character limit.',
        outboundDataType: 'choose a valid outbound format.',
        timeoutMs: 'set the timeout between 0.1 and 120 seconds.',
        maxRetries: 'set maximum retries between 0 and 10.',
        retryIntervalSeconds: 'set the retry interval between 1 and 86400 seconds.',
        deliveryPolicy: 'check the delivery limits in Advanced destination settings.',
        processingScript: 'keep the advanced transformation script within 65536 characters.',
        filterScript: 'keep the advanced filter script within 65536 characters.',
        templateScript: 'keep the advanced template script within 65536 characters.',
      };
      const field = String(path[3]);
      message =
        typeof index !== 'number'
          ? 'Use at most 50 destinations and check their configuration.'
          : `${destination}: ${Object.prototype.hasOwnProperty.call(fields, field) ? fields[field] : 'check its configuration before testing.'}`;
    }
  }
  return new AppError(400, code, message);
}

function previewFailureMessage(stage: string, code: string): string {
  const known: Record<string, string> = {
    JSON_INVALID: 'The sample is not valid JSON. Check its syntax and data types.',
    XML_INVALID: 'The sample is not valid XML. Check its tags, structure and size.',
    XML_ENTITIES_DENIED: 'Remove DTD and entity declarations from the XML sample.',
    XML_PROFILE_REJECTED:
      'The sample does not match the XML validation rules. Check its root and required fields.',
    PAYLOAD_SCHEMA_REJECTED:
      'The sample does not match the validation schema. Check required fields and field types.',
    HL7_PROFILE_REJECTED:
      'The sample does not match the HL7 validation rules. Check message type, version and required fields.',
    PAYLOAD_VALIDATION_REJECTED:
      'The custom validation rule rejected this sample. Review the rule and sample fields.',
    INVALID_JSON_SCHEMA:
      'The custom JSON Schema is invalid. Review its structure and required fields.',
    UNSUPPORTED_JSON_SCHEMA:
      'The custom JSON Schema contains unsupported rules or exceeds its size limit.',
    FIELD_MAPPING_INPUT_INVALID:
      'Field mapping could not read the sample. Check its input format, structure and size.',
    FILTER_INPUT_INVALID:
      'The filter could not read the sample. Check its input format and field paths.',
    FIELD_VALIDATION_FAILED:
      'Input fields do not meet the configured validation rules. Review the field results below.',
    INVALID_FIELD_RULES: 'Complete the field validation rules in Source before testing.',
    INVALID_VALIDATION_PROFILE:
      'Check the validation schema configuration and its selected format.',
    VALIDATION_FORMAT_UNSUPPORTED:
      'The selected validation rules do not support this source input format.',
    FILTER_CONFIG_INVALID:
      'The saved filter configuration is invalid. Replace or restore its condition before testing.',
    FILTER_RESULT_INVALID:
      'The filter must return true or false. Review its condition or advanced script.',
    INVALID_ENDPOINT: 'Check the destination endpoint and connector settings.',
    DESTINATION_HOST_DENIED:
      'The destination host is not allowed. Review its endpoint and outbound allowlist.',
    DESTINATION_ADDRESS_DENIED:
      'The destination address is not allowed. Review its endpoint and outbound allowlist.',
    SCRIPT_TIMEOUT:
      'The test exceeded the script time limit. Simplify the transformation or filter.',
    SCRIPT_MEMORY_LIMIT:
      'The test exceeded the script memory limit. Use a smaller sample or simplify the script.',
    SCRIPT_INPUT_LIMIT:
      'The sample or script exceeds its size limit. Use a smaller synthetic sample.',
    SCRIPT_CAPACITY: 'Too many script tests are running. Wait for them to finish and try again.',
  };
  if (known[code]) return known[code];
  if (code.startsWith('INVALID_HL7'))
    return stage === 'conversion'
      ? 'Cannot generate HL7 output. Map the required MSH header fields and check the output structure.'
      : 'The sample is not valid HL7. Check MSH, separators and required header fields.';
  if (stage === 'validation')
    return 'Message validation failed. Check the sample and validation settings.';
  if (stage === 'filter') return 'The filter failed. Review its condition or advanced script.';
  if (stage === 'template')
    return 'The output template failed. Review the template and sample fields.';
  if (stage === 'conversion')
    return 'Cannot generate the selected output format. Check the mapping and output structure.';
  return 'Transformation failed. Check the field mapping or advanced transformation script.';
}

async function requiredMappingMessage(
  script: string,
  payload: unknown,
): Promise<string | undefined> {
  const mapping = readFieldMapping(script);
  if (!mapping || !mapping.rows.some((row) => row.required)) return undefined;
  try {
    // Replay only a canonical visual mapping with its required checks disabled.
    // This reuses the same bounded XML parser and QuickJS limits without rerunning
    // custom scripts/filters or adding another parser with different semantics.
    const optional = compileFieldMapping({
      ...mapping,
      rows: mapping.rows.map((row) => ({ ...row, required: false })),
    });
    const mapped = await executeScript(optional, { msg: payload });
    const own = (value: unknown, key: string): unknown =>
      value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
        ? (value as Record<string, unknown>)[key]
        : undefined;
    const root = mapping.rootElement ? own(mapped, mapping.rootElement) : mapped;
    for (const row of mapping.rows) {
      if (!row.required) continue;
      let value = root;
      for (const key of row.target.split('.')) value = own(value, key);
      if (value === undefined || value === null || value === '')
        return `Target field ${row.target} is required.`;
    }
  } catch {
    // Diagnostic replay has the same resource limits; no exception text is exposed.
  }
  return undefined;
}

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
export async function runConfiguration(
  data: RevisionConfig,
  syntheticPayload: unknown,
  options: { validateConnections?: boolean } = {},
) {
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
    validationResults: [] as ValidationRuleResult[],
    code: undefined as string | undefined,
    message: undefined as string | undefined,
  };
  let sourceStage: 'validation' | 'filter' | 'transformation' = 'validation';
  let accepted = false;
  try {
    source.validationResults = safeValidationResults(
      await validatePayload(payload, data.source.inboundDataType, data.validationProfile),
    );
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
    if (error instanceof FieldValidationError)
      source.validationResults = safeValidationResults(error.results);
    source[sourceStage] = 'ERROR';
    source.code = safeError(error);
    source.message =
      (sourceStage === 'transformation' && source.code === 'SCRIPT_EXECUTION_FAILED'
        ? await requiredMappingMessage(data.processingScript, payload)
        : undefined) || previewFailureMessage(sourceStage, source.code);
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
      if (options.validateConnections !== false)
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
        message:
          (stage === 'transformation' && safeError(error) === 'SCRIPT_EXECUTION_FAILED'
            ? await requiredMappingMessage(destination.processingScript, payload)
            : undefined) || previewFailureMessage(stage, safeError(error)),
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
        : error instanceof z.ZodError
          ? invalidPreviewConfiguration(error, 'DRY_RUN_INVALID')
          : new AppError(400, 'DRY_RUN_INVALID', 'Invalid configuration or synthetic payload'),
    );
  }
}
