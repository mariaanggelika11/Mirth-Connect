import { compileV2Mapping, validateV2Mapping, type FieldMappingV2 } from './fieldMappingV2.js';
/** Visual mappings are compiled into the existing sandboxed source transformer. */
export interface FieldMappingRow {
  source: string;
  target: string;
  required: boolean;
  defaultValue?: string;
  conversion?: 'NONE' | 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE_TO_HL7' | 'DATE_FROM_HL7';
}

export interface FieldMappingV1 {
  version: 1;
  rows: FieldMappingRow[];
  rootElement?: string;
}
export type FieldMappingConfig = FieldMappingV1 | FieldMappingV2;
export type { FieldMappingV2 } from './fieldMappingV2.js';

/** V2 is an engine protocol, not an editable custom-script header. V1 custom edits stay compatible. */
export function validFieldMappingScript(script: string): boolean {
  return (
    !script.trimStart().startsWith('/* MIRTH_FIELD_MAPPING_V2:') ||
    readFieldMapping(script)?.version === 2
  );
}

const marker = '/* MIRTH_FIELD_MAPPING_V1:';
const forbiddenParts = new Set(['__proto__', 'prototype', 'constructor']);
const maxScriptLength = 65536;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function path(value: unknown, row: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`Mapping ${row}: enter a ${label} field.`);
  const clean = value.trim();
  const parts = clean.split('.');
  if (
    clean.length > 256 ||
    parts.length > 12 ||
    parts.some(
      (part) =>
        !/^(?:[A-Za-z_$][A-Za-z0-9_$-]{0,63}|0|[1-9][0-9]{0,5})$/.test(part) ||
        forbiddenParts.has(part),
    )
  )
    throw new Error(`Mapping ${row}: use a valid ${label} field path.`);
  return clean;
}

export function validateFieldMapping(input: unknown): FieldMappingConfig {
  if (record(input) && input.version === 2) return validateV2Mapping(input);
  if (!record(input) || input.version !== 1 || !Array.isArray(input.rows))
    throw new Error('Invalid field mapping configuration.');
  if (input.rows.length < 1 || input.rows.length > 100)
    throw new Error('Add between 1 and 100 field mappings.');
  if (Object.keys(input).some((key) => !['version', 'rows', 'rootElement'].includes(key)))
    throw new Error('Invalid field mapping configuration.');
  const targets: string[] = [];
  const rows = input.rows.map((entry: unknown, index: number): FieldMappingRow => {
    if (
      !record(entry) ||
      typeof entry.required !== 'boolean' ||
      Object.keys(entry).some(
        (key) => !['source', 'target', 'required', 'defaultValue'].includes(key),
      )
    )
      throw new Error(`Mapping ${index + 1}: invalid field settings.`);
    const source = path(entry.source, index + 1, 'input');
    const target = path(entry.target, index + 1, 'output');
    if (
      targets.some(
        (previous) =>
          previous === target ||
          previous.startsWith(target + '.') ||
          target.startsWith(previous + '.'),
      )
    )
      throw new Error(`Mapping ${index + 1}: output fields must not overlap.`);
    targets.push(target);
    const row: FieldMappingRow = { source, target, required: entry.required };
    if (entry.defaultValue !== undefined) {
      if (typeof entry.defaultValue !== 'string' || entry.defaultValue.length > 1024)
        throw new Error(`Mapping ${index + 1}: default value must be at most 1024 characters.`);
      row.defaultValue = entry.defaultValue;
    }
    return row;
  });
  const result: FieldMappingV1 = { version: 1, rows };
  if (input.rootElement !== undefined && input.rootElement !== '') {
    if (
      typeof input.rootElement !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(input.rootElement) ||
      forbiddenParts.has(input.rootElement)
    )
      throw new Error('Enter a valid XML root element.');
    result.rootElement = input.rootElement;
  }
  return result;
}

// This body executes inside QuickJS. It has no filesystem, network, or host callbacks.
const mappingBody = `
var mappingInput = msg;
if (typeof mappingInput === 'string') {
  var mappingText = mappingInput.trim();
  if (mappingText.startsWith('MSH')) mappingInput = hl7ToJson(mappingText);
  else {
    try { mappingInput = JSON.parse(mappingText); }
    catch (_) { throw new Error('FIELD_MAPPING_INPUT_INVALID'); }
  }
}
if (!mappingInput || typeof mappingInput !== 'object' || Array.isArray(mappingInput))
  throw new Error('FIELD_MAPPING_INPUT_INVALID');
var mappingOutput = Object.create(null);
for (var mappingIndex = 0; mappingIndex < mappingConfig.rows.length; mappingIndex++) {
  var mappingRow = mappingConfig.rows[mappingIndex];
  var mappingValue = mappingInput;
  var mappingSourceParts = mappingRow.source.split('.');
  for (var mappingPart = 0; mappingPart < mappingSourceParts.length; mappingPart++) {
    if (mappingValue === null || typeof mappingValue !== 'object' ||
        !Object.prototype.hasOwnProperty.call(mappingValue, mappingSourceParts[mappingPart])) {
      mappingValue = undefined;
      break;
    }
    mappingValue = mappingValue[mappingSourceParts[mappingPart]];
  }
  if ((mappingValue === undefined || mappingValue === null || mappingValue === '') &&
      Object.prototype.hasOwnProperty.call(mappingRow, 'defaultValue'))
    mappingValue = mappingRow.defaultValue;
  if (mappingValue === undefined || mappingValue === null || mappingValue === '') {
    if (mappingRow.required) throw new Error('FIELD_MAPPING_REQUIRED');
    if (mappingValue === undefined) continue;
  }
  var mappingTargetParts = mappingRow.target.split('.');
  var mappingTarget = mappingOutput;
  for (var mappingTargetPart = 0; mappingTargetPart < mappingTargetParts.length - 1; mappingTargetPart++) {
    var mappingKey = mappingTargetParts[mappingTargetPart];
    if (!Object.prototype.hasOwnProperty.call(mappingTarget, mappingKey))
      mappingTarget[mappingKey] = Object.create(null);
    mappingTarget = mappingTarget[mappingKey];
  }
  mappingTarget[mappingTargetParts[mappingTargetParts.length - 1]] = mappingValue;
}
if (mappingConfig.rootElement) {
  var mappingRoot = Object.create(null);
  mappingRoot[mappingConfig.rootElement] = mappingOutput;
  msg = mappingRoot;
} else msg = mappingOutput;
return msg;`;

export function compileFieldMapping(input: FieldMappingConfig): string {
  const configuration = validateFieldMapping(input);
  if (configuration.version === 2) return compileV2Mapping(configuration);
  const encoded = encodeURIComponent(JSON.stringify(configuration));
  const script = `${marker}${encoded} */\nvar mappingConfig = ${JSON.stringify(configuration)};${mappingBody}`;
  if (script.length > maxScriptLength)
    throw new Error('Field mappings exceed the transformation size limit.');
  return script;
}

/** Recognize only intact generated scripts; custom or edited scripts remain advanced scripts. */
export function readFieldMapping(script: string): FieldMappingConfig | null {
  const prefix = script.startsWith('/* MIRTH_FIELD_MAPPING_V2:')
    ? '/* MIRTH_FIELD_MAPPING_V2:'
    : marker;
  if (script.length > maxScriptLength || !script.startsWith(prefix)) return null;
  const end = script.indexOf(' */\n', prefix.length);
  if (end < 0) return null;
  try {
    const configuration = validateFieldMapping(
      JSON.parse(decodeURIComponent(script.slice(prefix.length, end))),
    );
    return compileFieldMapping(configuration) === script ? configuration : null;
  } catch {
    return null;
  }
}
