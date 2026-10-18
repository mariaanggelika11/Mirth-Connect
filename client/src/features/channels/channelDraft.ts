import { DataType, DestinationType } from '../../types';
import type { Channel, ChannelFormData, Destination } from '../../types';
import {
  fieldRuleErrors,
  readValidationSettings,
  type FieldRule,
  type ValidationSettings,
} from '../../../../server/src/utils/validationRules';
export const newDestination = (): Destination => ({
  name: '',
  type: DestinationType.REST,
  endpoint: '',
  outboundDataType: DataType.JSON,
  isEnabled: true,
  retryEnabled: false,
  maxRetries: 3,
  retryIntervalSeconds: 30,
  timeoutMs: 10000,
  processingScript: '',
  responseScript: '',
  templateScript: '',
  filterScript: '',
});
export function initialDraft(channel?: Channel | null): ChannelFormData {
  return {
    name: channel?.name || '',
    validationProfile: channel?.validationProfile || {},
    idempotencyMode: channel?.idempotencyMode || 'OPTIONAL',
    changeSummary: '',
    source: {
      type: channel?.source.type === 'HL7' ? 'HL7' : 'HTTP',
      inboundDataType:
        channel?.source.inboundDataType || (channel ? DataType.HL7V2 : DataType.JSON),
    },
    processingScript: channel?.processingScript || '',
    filterScript: channel?.filterScript || '',
    responseScript: channel?.responseScript || '',
    destinations: channel
      ? channel.destinations.map((d) => ({
          ...newDestination(),
          ...d,
          outboundDataType: d.outboundDataType || DataType.HL7V2,
        }))
      : [newDestination()],
  };
}

export interface ChannelScriptEditor {
  destination?: number;
  field: 'processingScript' | 'responseScript' | 'templateScript';
  title: string;
}

export type MessageValidation = 'NONE' | 'BASIC' | 'BASIC_JSON' | 'CUSTOM';
export const basicJsonProfile = { jsonSchema: { type: 'object' } };
export function validationChoice(profile: Record<string, unknown> = {}): MessageValidation {
  if (!Object.keys(profile).length) return 'NONE';
  if (Object.keys(profile).length === 1 && profile.basicSyntax === true) return 'BASIC';
  const schema = profile.jsonSchema;
  return Object.keys(profile).length === 1 &&
    schema !== null &&
    typeof schema === 'object' &&
    Object.keys(schema).length === 1 &&
    (schema as Record<string, unknown>).type === 'object'
    ? 'BASIC_JSON'
    : 'CUSTOM';
}
export function selectedValidationProfile(
  choice: MessageValidation,
  customText: string,
): Record<string, unknown> {
  if (choice === 'NONE') return {};
  if (choice === 'BASIC') return { basicSyntax: true };
  if (choice === 'BASIC_JSON') return structuredClone(basicJsonProfile);
  const profile: unknown = JSON.parse(customText);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile))
    throw new Error('Custom validation must be a JSON object.');
  return profile as Record<string, unknown>;
}

export type CustomValidationKind = 'JSON_SCHEMA' | 'XML' | 'HL7' | 'PROFILE';
export interface ValidationFieldDraft {
  field: string;
  type: FieldRule['type'];
  required: boolean;
  allowedValuesText: string;
  minLength: string;
  maxLength: string;
  minimum: string;
  maximum: string;
}
export interface MessageValidationDraft {
  mode: ValidationSettings['mode'];
  fields: ValidationFieldDraft[];
  customText: string;
  customKind: CustomValidationKind;
  retainedCustom: Record<string, unknown>;
  legacy?: Record<string, unknown>;
  original: Record<string, unknown>;
  changed: boolean;
}
export const newValidationField = (): ValidationFieldDraft => ({
  field: '',
  type: 'text',
  required: true,
  allowedValuesText: '',
  minLength: '',
  maxLength: '',
  minimum: '',
  maximum: '',
});
function customEditor(profile: Record<string, unknown>, format?: DataType) {
  const keys = Object.keys(profile);
  if (keys.length === 1 && profile.jsonSchema && typeof profile.jsonSchema === 'object')
    return {
      customKind: 'JSON_SCHEMA' as const,
      customText: JSON.stringify(profile.jsonSchema, null, 2),
    };
  if (keys.length === 1 && profile.xml && typeof profile.xml === 'object')
    return { customKind: 'XML' as const, customText: JSON.stringify(profile.xml, null, 2) };
  if (keys.length === 1 && profile.hl7 && typeof profile.hl7 === 'object')
    return { customKind: 'HL7' as const, customText: JSON.stringify(profile.hl7, null, 2) };
  if (keys.length)
    return { customKind: 'PROFILE' as const, customText: JSON.stringify(profile, null, 2) };
  return {
    customKind:
      format === DataType.XML
        ? ('XML' as const)
        : format === DataType.HL7V2
          ? ('HL7' as const)
          : format === DataType.TEXT
            ? ('PROFILE' as const)
            : ('JSON_SCHEMA' as const),
    customText: '{}',
  };
}
export function createMessageValidationDraft(
  profile: Record<string, unknown> = {},
  format?: DataType,
): MessageValidationDraft {
  const settings = readValidationSettings(profile);
  const legacyBasic = validationChoice(profile);
  const versioned = profile.version === 1;
  const custom = versioned ? settings.custom : legacyBasic === 'CUSTOM' ? profile : {};
  return {
    mode: versioned
      ? settings.mode
      : legacyBasic === 'NONE'
        ? 'NONE'
        : legacyBasic === 'CUSTOM'
          ? 'CUSTOM'
          : 'LEGACY',
    fields: settings.fieldRules.map((rule) => ({
      ...newValidationField(),
      field: rule.field,
      type: rule.type,
      required: rule.required,
      allowedValuesText: rule.allowedValues?.join('\n') || '',
      minLength: rule.minLength === undefined ? '' : String(rule.minLength),
      maxLength: rule.maxLength === undefined ? '' : String(rule.maxLength),
      minimum: rule.minimum === undefined ? '' : String(rule.minimum),
      maximum: rule.maximum === undefined ? '' : String(rule.maximum),
    })),
    ...customEditor(custom, format),
    retainedCustom: custom,
    legacy:
      settings.legacy ||
      (!versioned && ['BASIC', 'BASIC_JSON'].includes(legacyBasic) ? profile : undefined),
    original: profile,
    changed: false,
  };
}
export function validationFieldRules(fields: ValidationFieldDraft[]): FieldRule[] {
  return fields.map((field) => {
    const rule: FieldRule = { field: field.field, type: field.type, required: field.required };
    if (field.type === 'text') {
      if (field.allowedValuesText !== '')
        rule.allowedValues = field.allowedValuesText.split('\n').filter((value) => value !== '');
      if (field.minLength !== '') rule.minLength = Number(field.minLength);
      if (field.maxLength !== '') rule.maxLength = Number(field.maxLength);
    }
    if (field.type === 'number') {
      if (field.minimum !== '') rule.minimum = Number(field.minimum);
      if (field.maximum !== '') rule.maximum = Number(field.maximum);
    }
    return rule;
  });
}
export function validationDraftErrors(value: MessageValidationDraft, format?: DataType) {
  if (value.mode === 'FIELDS') {
    if (format !== DataType.JSON)
      return [
        'Field validation supports JSON input only. Choose another validation mode or JSON input.',
      ];
    return fieldRuleErrors(validationFieldRules(value.fields)).map((error) =>
      error.index < 0
        ? error.message
        : `Rule ${error.index + 1}: ${!value.fields[error.index]?.field ? 'Enter an input field path.' : error.message}`,
    );
  }
  if (value.mode === 'CUSTOM') {
    try {
      const parsed: unknown = JSON.parse(value.customText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return ['Enter a JSON object for the custom validation configuration.'];
      if (
        (value.customKind === 'JSON_SCHEMA' && format !== DataType.JSON) ||
        (value.customKind === 'XML' && format !== DataType.XML) ||
        (value.customKind === 'HL7' && format !== DataType.HL7V2)
      )
        return [
          'The custom validation language does not match the inbound format. Review the retained configuration before saving.',
        ];
    } catch {
      return ['The custom validation configuration is not valid JSON.'];
    }
  }
  return [];
}
export function messageValidationProfile(
  value: MessageValidationDraft,
  format?: DataType,
): Record<string, unknown> {
  const errors = validationDraftErrors(value, format);
  if (errors.length) throw new Error(errors[0]);
  if (!value.changed) return value.original;
  let custom = value.retainedCustom;
  try {
    const parsed: unknown = JSON.parse(value.customText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      custom =
        value.customKind === 'JSON_SCHEMA'
          ? { jsonSchema: parsed }
          : value.customKind === 'XML'
            ? { xml: parsed }
            : value.customKind === 'HL7'
              ? { hl7: parsed }
              : (parsed as Record<string, unknown>);
    }
  } catch {
    // Invalid inactive custom text is never activated or sent as executable configuration.
  }
  return {
    version: 1,
    mode: value.mode,
    fieldRules: validationFieldRules(value.fields),
    custom,
    ...(value.legacy ? { legacy: value.legacy } : {}),
  };
}
export function messageValidationSummary(value: MessageValidationDraft, format?: DataType) {
  if (value.mode === 'NONE') return 'Parsing only';
  if (validationDraftErrors(value, format).length) return 'Incomplete validation configuration';
  if (value.mode === 'FIELDS')
    return `${value.fields.filter((rule) => rule.required).length} required fields · ${value.fields.length} rules`;
  if (value.mode === 'LEGACY')
    return value.legacy?.jsonSchema ? 'Legacy JSON object check' : 'Legacy syntax check';
  return customValidationHasRules(value)
    ? 'Custom validation schema'
    : 'Custom schema · no field restrictions';
}
function customValidationHasRules(value: MessageValidationDraft) {
  try {
    const parsed: unknown = JSON.parse(value.customText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const profile = parsed as Record<string, unknown>;
    if (value.customKind !== 'PROFILE') return Object.keys(profile).length > 0;
    return Object.entries(profile).some(([key, item]) =>
      key === 'script'
        ? typeof item === 'string' && !!item.trim()
        : item && typeof item === 'object' && Object.keys(item).length > 0,
    );
  } catch {
    return false;
  }
}
export function messageValidationConfigured(value: MessageValidationDraft, format?: DataType) {
  if (value.mode === 'NONE' || validationDraftErrors(value, format).length) return false;
  // Custom JSON syntax alone cannot prove a schema is executable. Retained saved
  // profiles are marked configured; edited profiles are checked by Save or Test.
  return value.mode !== 'CUSTOM' || (!value.changed && customValidationHasRules(value));
}
