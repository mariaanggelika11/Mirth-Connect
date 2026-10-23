import { fieldMappingRuntimeV2 } from './fieldMappingRuntimeV2.js';
import {
  hl7Templates,
  hl7TargetFields,
  normalizeHl7Path,
  validateHl7Configuration,
  type Hl7Configuration,
} from './hl7Configuration.js';
import type { FieldMappingRow } from './fieldMapping.js';
export interface FieldMappingV2 {
  version: 2;
  rows: FieldMappingRow[];
  rootElement?: string;
  hl7?: Hl7Configuration;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const conversions = new Set(['NONE', 'TEXT', 'NUMBER', 'BOOLEAN', 'DATE_TO_HL7', 'DATE_FROM_HL7']);
function checkedPath(value: unknown, index: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`Mapping ${index}: choose a ${label} field.`);
  const clean = value.trim().replace(/\[(0|[1-9][0-9]*)\]/g, '.$1'),
    parts = clean.split('.');
  if (
    clean.length > 256 ||
    parts.length > 12 ||
    parts.some(
      (part) =>
        !/^(?:[A-Za-z_$][A-Za-z0-9_$-]{0,63}|0|[1-9][0-9]{0,5})$/.test(part) ||
        ['__proto__', 'prototype', 'constructor'].includes(part),
    )
  )
    throw new Error(
      `Mapping ${index}: use a valid ${label} path, such as patient.id, patients.0.id or PID.5.1.`,
    );
  return clean;
}
export function validateV2Mapping(input: unknown): FieldMappingV2 {
  if (
    !record(input) ||
    input.version !== 2 ||
    !Array.isArray(input.rows) ||
    input.rows.length < 1 ||
    input.rows.length > 100 ||
    Object.keys(input).some((key) => !['version', 'rows', 'rootElement', 'hl7'].includes(key))
  )
    throw new Error('Add between 1 and 100 complete field mappings.');
  const hl7 = input.hl7 === undefined ? undefined : validateHl7Configuration(input.hl7);
  if (hl7 && input.rootElement)
    throw new Error('HL7 messages use their configured segments rather than an XML root.');
  const template = hl7Templates.find((item) => item.messageType === hl7?.messageType);
  const targets: string[] = [];
  const rows = input.rows.map((entry: unknown, index): FieldMappingRow => {
    if (
      !record(entry) ||
      typeof entry.required !== 'boolean' ||
      Object.keys(entry).some(
        (key) => !['source', 'target', 'required', 'defaultValue', 'conversion'].includes(key),
      )
    )
      throw new Error(`Mapping ${index + 1}: invalid field settings.`);
    const source = checkedPath(entry.source, index + 1, 'source');
    let target = checkedPath(
      hl7 && typeof entry.target === 'string' ? normalizeHl7Path(entry.target) : entry.target,
      index + 1,
      'target',
    );
    if (hl7) {
      const repeated =
        typeof entry.target === 'string'
          ? /^([A-Z0-9]{3})\[(0|[1-9][0-9]?)\][.-](.*)$/.exec(entry.target.trim())
          : null;
      if (repeated) {
        if (repeated[1] !== 'OBX')
          throw new Error(
            `Mapping ${index + 1}: this profile supports repeating OBX segments only.`,
          );
        target = `${repeated[1]}[${repeated[2]}].${repeated[3]}`;
      }
      const base = target.replace(/\[[0-9]+\]/, '');
      const [segment, field, ...components] = base.split('.');
      const metadata = hl7TargetFields(hl7.messageType);
      if (
        !template!.segments.includes(segment) ||
        !/^[1-9][0-9]{0,2}$/.test(field || '') ||
        components.length > 2 ||
        components.some((part) => !/^[1-9][0-9]?$/.test(part)) ||
        !metadata.some(
          (item) =>
            item.path === `${segment}.${field}` || item.path.startsWith(`${segment}.${field}.`),
        )
      )
        throw new Error(
          `Mapping ${index + 1}: choose a field supported by the selected HL7 template.`,
        );
      if (segment === 'MSH' && ['1', '2', '9', '11', '12'].includes(field))
        throw new Error(
          `Mapping ${index + 1}: configure reserved MSH fields through the HL7 header.`,
        );
    } else if (target.split('.').some((part) => /^\d+$/.test(part) && Number(part) > 999))
      throw new Error(`Mapping ${index + 1}: use array indexes between 0 and 999.`);
    if (
      targets.some(
        (prior) =>
          prior === target || prior.startsWith(target + '.') || target.startsWith(prior + '.'),
      )
    )
      throw new Error(`Mapping ${index + 1}: target fields must not overlap.`);
    targets.push(target);
    const row: FieldMappingRow = { source, target, required: entry.required };
    if (entry.defaultValue !== undefined) {
      if (typeof entry.defaultValue !== 'string' || entry.defaultValue.length > 1024)
        throw new Error(`Mapping ${index + 1}: default value must be at most 1024 characters.`);
      row.defaultValue = entry.defaultValue;
    }
    if (entry.conversion !== undefined) {
      if (!conversions.has(String(entry.conversion)))
        throw new Error(`Mapping ${index + 1}: choose a supported type conversion.`);
      row.conversion = entry.conversion as FieldMappingRow['conversion'];
    }
    return row;
  });
  if (hl7)
    for (const segment of template!.segments) {
      const segmentTargets = targets.filter(
        (target) => target.startsWith(segment + '.') || target.startsWith(segment + '['),
      );
      if (
        segmentTargets.some((target) => target.startsWith(segment + '[')) &&
        segmentTargets.some((target) => target.startsWith(segment + '.'))
      )
        throw new Error('Use explicit indexes for every mapping to a repeating HL7 segment.');
      const indexes = [
        ...new Set(
          segmentTargets.flatMap((target) => {
            const match = /\[([0-9]+)\]/.exec(target);
            return match ? [Number(match[1])] : [];
          }),
        ),
      ].sort((left, right) => left - right);
      if (indexes.some((value, index) => value !== index))
        throw new Error('Use consecutive repeating HL7 segment indexes starting at 0.');
    }
  if (
    !hl7 &&
    targets.some((target) => /^\d+(?:\.|$)/.test(target)) &&
    targets.some((target) => !/^\d+(?:\.|$)/.test(target))
  )
    throw new Error('Choose either an object or an array as the mapped output root.');
  const result: FieldMappingV2 = { version: 2, rows };
  if (hl7) result.hl7 = hl7;
  if (input.rootElement !== undefined && input.rootElement !== '') {
    if (
      typeof input.rootElement !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(input.rootElement) ||
      ['__proto__', 'constructor', 'prototype'].includes(input.rootElement)
    )
      throw new Error('Enter a valid XML root element.');
    result.rootElement = input.rootElement;
  }
  return result;
}

export function compileV2Mapping(config: FieldMappingV2): string {
  const body = `${fieldMappingRuntimeV2}\ntry { return { kind:'MIRTH_MAPPING_V2_RESULT',success:true,value:runV2Mapping(mappingConfig,msg,mappingRuntime) }; } catch (error) { if(error instanceof MappingFailure) return {kind:'MIRTH_MAPPING_V2_RESULT',success:false,code:error.code,index:error.index,field:error.field}; throw error; }`;
  const script = `/* MIRTH_FIELD_MAPPING_V2:${encodeURIComponent(JSON.stringify(config))} */\nvar mappingConfig = ${JSON.stringify(config)};${body}`;
  if (script.length > 65536)
    throw new Error('Field mappings exceed the transformation size limit.');
  return script;
}
