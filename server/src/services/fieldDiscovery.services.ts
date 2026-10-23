import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { convertPayload } from './engine/conversion.js';
import { executeScript } from './script.services.js';
import { audit } from './audit.services.js';
import { validatePayload } from './profileValidation.services.js';
import { describeHl7Field } from '../utils/hl7Configuration.js';
export interface DiscoveredField {
  path: string;
  label: string;
  type: string;
  description?: string;
  selectable: boolean;
  children?: DiscoveredField[];
}
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const input = z
  .object({
    format: z.enum(['JSON', 'XML', 'HL7V2', 'TEXT']),
    payload: z.unknown().refine((value) => value !== undefined),
    processingScript: z.string().max(65536).default(''),
  })
  .strict();
export function collectFields(value: unknown) {
  let count = 0;
  let truncated = false;
  function walk(
    value: unknown,
    prefix = '',
    depth = 0,
    parentSelectable = true,
  ): DiscoveredField[] {
    if (!value || typeof value !== 'object') return [];
    if (depth >= 12) {
      truncated = true;
      return [];
    }
    const fields: DiscoveredField[] = [];
    for (const key of Object.keys(value)) {
      if (count >= 512) {
        truncated = true;
        break;
      }
      if (forbidden.has(key)) continue;
      count++;
      const path = prefix ? `${prefix}.${key}` : key;
      const item = (value as Record<string, unknown>)[key];
      const selectable =
        parentSelectable &&
        /^(?:[A-Za-z_$][A-Za-z0-9_$-]{0,63}|0|[1-9][0-9]{0,5})$/.test(key) &&
        path.length <= 256;
      const type = item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item;
      const description = describeHl7Field(path);
      fields.push({
        path,
        label: description
          ? `${path} · ${description}`
          : key === '$'
            ? 'Attributes'
            : key === '_'
              ? 'Text'
              : key,
        type,
        selectable,
        description: selectable ? description : 'Use an advanced script for this property name.',
        ...(item && typeof item === 'object'
          ? { children: walk(item, path, depth + 1, selectable) }
          : {}),
      });
    }
    return fields;
  }
  return { fields: walk(value), truncated };
}
export async function discoverMessageFields(
  format: string,
  payload: unknown,
  processingScript = '',
) {
  if (Buffer.byteLength(JSON.stringify(payload) || '') > config.server.payloadLimit)
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'The sample exceeds the configured size limit.');
  let parsed: unknown;
  if (format === 'JSON') {
    try {
      parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch {
      throw new AppError(422, 'JSON_INVALID', 'The sample is not valid JSON.');
    }
  } else if (format === 'TEXT') parsed = payload;
  else {
    if (typeof payload !== 'string' || !payload.trim())
      throw new AppError(
        422,
        'SAMPLE_INVALID',
        'Enter a synthetic message in the selected format.',
      );
    await validatePayload(payload, format, {});
    // Use the runtime converter and its bounded XML / HL7 parser. No browser-only parser.
    parsed = await convertPayload(payload, 'JSON');
  }
  const source = collectFields(parsed);
  const processed = processingScript.trim()
    ? await executeScript(processingScript, { msg: format === 'JSON' ? parsed : payload })
    : parsed;
  const structured =
    typeof processed === 'string' && format !== 'TEXT'
      ? await convertPayload(processed, 'JSON')
      : processed;
  const processedTree = collectFields(structured);
  const truncated = source.truncated || processedTree.truncated;
  return {
    success: true,
    format,
    ...source,
    truncated,
    processedFields: processedTree.fields,
    warnings: truncated ? ['Field explorer is limited to 512 nodes and 12 path levels.'] : [],
    networkDelivery: 'NOT_SENT' as const,
  };
}
export async function discoverFields(req: Request, res: Response, next: NextFunction) {
  try {
    const data = input.safeParse(req.body);
    if (!data.success)
      throw new AppError(
        400,
        'FIELD_DISCOVERY_INVALID',
        'Select a format and provide a synthetic sample.',
      );
    const result = await discoverMessageFields(
      data.data.format,
      data.data.payload,
      data.data.processingScript,
    );
    await audit('DISCOVER_MESSAGE_FIELDS', req, 'channel');
    res.json(result);
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(
            422,
            'FIELD_DISCOVERY_FAILED',
            'Unable to read the sample fields. Check its format and source transformation.',
          ),
    );
  }
}
