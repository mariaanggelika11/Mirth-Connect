import { describe, expect, it } from 'vitest';
import {
  initialDraft,
  newDestination,
  selectedValidationProfile,
  validationChoice,
  createMessageValidationDraft,
  messageValidationProfile,
  messageValidationSummary,
  messageValidationConfigured,
  newValidationField,
  validationDraftErrors,
  validationFieldRules,
} from '../src/features/channels/channelDraft';
import { ChannelStatus, DataType, DestinationType, type Channel } from '../src/types';

describe('Progressive channel configuration', () => {
  it('starts a simple HTTP JSON channel without scripts or required custom validation', () => {
    const draft = initialDraft();
    expect(draft.source).toEqual({ type: 'HTTP', inboundDataType: DataType.JSON });
    expect(draft.idempotencyMode).toBe('OPTIONAL');
    expect(draft.validationProfile).toEqual({});
    expect(draft.processingScript).toBe('');
    expect(draft.filterScript).toBe('');
    expect(newDestination()).toMatchObject({
      type: DestinationType.REST,
      outboundDataType: DataType.JSON,
      retryEnabled: false,
      timeoutMs: 10000,
    });
  });

  it('preserves an existing channel profile, scripts, formats and delivery settings', () => {
    const profile = { hl7: { versions: ['2.5'], requiredFields: ['PID.3'] } };
    const channel: Channel = {
      id: 1,
      name: 'Existing HL7 integration',
      status: ChannelStatus.RUNNING,
      source: { type: 'HL7', inboundDataType: DataType.HL7V2 },
      idempotencyMode: 'REQUIRED',
      validationProfile: profile,
      processingScript: 'return hl7ToJson(msg);',
      filterScript: 'return Boolean(msg.PID);',
      responseScript: 'return response;',
      destinations: [
        {
          id: 9,
          name: 'Existing receiver',
          type: DestinationType.MLLP,
          endpoint: 'tls://integration.example.test:2575',
          outboundDataType: DataType.HL7V2,
          retryEnabled: true,
          maxRetries: 5,
          retryIntervalSeconds: 45,
          timeoutMs: 120000,
          processingScript: 'return msg;',
          templateScript: 'return msg;',
          responseScript: 'return response;',
          deliveryPolicy: { failureThreshold: 8, maxConcurrency: 2 },
        },
      ],
    };
    const draft = initialDraft(channel);
    expect(draft).toMatchObject({
      source: channel.source,
      validationProfile: profile,
      idempotencyMode: 'REQUIRED',
      processingScript: channel.processingScript,
      filterScript: channel.filterScript,
      responseScript: channel.responseScript,
      destinations: channel.destinations,
    });
    expect(validationChoice(profile)).toBe('CUSTOM');
    expect(draft.changeSummary).toBe('');
  });

  it('never treats an extended JSON validation profile as the basic preset', () => {
    expect(validationChoice({ basicSyntax: true })).toBe('BASIC');
    expect(validationChoice({ basicSyntax: false })).toBe('CUSTOM');
    expect(validationChoice({ basicSyntax: true, xml: { root: 'Patient' } })).toBe('CUSTOM');
    expect(validationChoice({ jsonSchema: { type: 'object' } })).toBe('BASIC_JSON');
    expect(validationChoice({ jsonSchema: { type: 'object', required: ['message'] } })).toBe(
      'CUSTOM',
    );
    expect(validationChoice({ jsonSchema: { type: 'object' }, script: 'return true;' })).toBe(
      'CUSTOM',
    );
    expect(validationChoice({ jsonSchema: null })).toBe('CUSTOM');
    expect(validationChoice()).toBe('NONE');
  });

  it('keeps legacy missing formats on their original HL7 defaults', () => {
    const draft = initialDraft({
      id: 2,
      name: 'Legacy defaults',
      status: ChannelStatus.STOPPED,
      source: { type: 'HTTP' },
      destinations: [
        {
          name: 'Legacy destination',
          type: DestinationType.REST,
          endpoint: 'http://receiver.example.test',
        },
      ],
    });
    expect(draft.source.inboundDataType).toBe(DataType.HL7V2);
    expect(draft.destinations[0].outboundDataType).toBe(DataType.HL7V2);
  });

  it('keeps custom profile text intact while users choose no additional or basic validation', () => {
    const customText = '{"jsonSchema":{"type":"object","required":["message"]}}';
    expect(selectedValidationProfile('NONE', customText)).toEqual({});
    expect(selectedValidationProfile('BASIC', customText)).toEqual({ basicSyntax: true });
    expect(selectedValidationProfile('BASIC_JSON', customText)).toEqual({
      jsonSchema: { type: 'object' },
    });
    const basicSyntax = selectedValidationProfile('BASIC', customText);
    basicSyntax.basicSyntax = false;
    expect(selectedValidationProfile('BASIC', customText)).toEqual({ basicSyntax: true });
    expect(selectedValidationProfile('CUSTOM', customText)).toEqual(JSON.parse(customText));
    const basic = selectedValidationProfile('BASIC_JSON', customText);
    (basic.jsonSchema as Record<string, unknown>).type = 'string';
    expect(selectedValidationProfile('BASIC_JSON', customText)).toEqual({
      jsonSchema: { type: 'object' },
    });
  });

  it('rejects malformed and non-object custom profiles before save or preview', () => {
    for (const text of ['{', 'null', '[]', '"schema"', '42']) {
      expect(() => selectedValidationProfile('CUSTOM', text)).toThrow();
    }
  });
});

describe('Message validation editor compatibility and persistence', () => {
  it('keeps every untouched legacy profile identical, without converting its semantics', () => {
    for (const profile of [
      {},
      { basicSyntax: true },
      { jsonSchema: { type: 'object' } },
      {
        jsonSchema: {
          type: 'object',
          properties: { patient_id: { type: 'string' } },
          required: ['patient_id'],
        },
      },
      { basicSyntax: true, script: 'return Boolean(msg);' },
      { xml: { root: 'Order', requiredPaths: ['Order.ID'] } },
      { hl7: { requiredFields: ['PID.3'] } },
    ]) {
      const format =
        'xml' in profile ? DataType.XML : 'hl7' in profile ? DataType.HL7V2 : DataType.JSON;
      const editor = createMessageValidationDraft(profile, format);
      expect(messageValidationProfile(editor, format)).toBe(profile);
    }
    expect(createMessageValidationDraft({ basicSyntax: true }, DataType.JSON).mode).toBe('LEGACY');
    expect(
      messageValidationSummary(
        createMessageValidationDraft({ jsonSchema: { type: 'object' } }, DataType.JSON),
        DataType.JSON,
      ),
    ).toBe('Legacy JSON object check');
  });

  it('only unwraps a custom schema when no other profile settings would be lost', () => {
    const simple = createMessageValidationDraft(
      { jsonSchema: { type: 'object', properties: { id: { type: 'string' } } } },
      DataType.JSON,
    );
    expect(simple.customKind).toBe('JSON_SCHEMA');
    expect(JSON.parse(simple.customText)).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    const mixedProfile = {
      basicSyntax: true,
      jsonSchema: { type: 'object' },
      script: 'return true;',
    };
    const mixed = createMessageValidationDraft(mixedProfile, DataType.JSON);
    expect(mixed.customKind).toBe('PROFILE');
    expect(JSON.parse(mixed.customText)).toEqual(mixedProfile);
    expect(messageValidationProfile({ ...mixed, changed: true }, DataType.JSON)).toMatchObject({
      mode: 'CUSTOM',
      custom: mixedProfile,
    });
  });

  it('retains inactive field rules, custom schema and legacy profile after mode switches and reopening', () => {
    const original = { basicSyntax: true };
    const legacy = createMessageValidationDraft(original, DataType.JSON);
    const fields = [
      { ...newValidationField(), field: 'patient_id' },
      {
        ...newValidationField(),
        field: 'age',
        type: 'number' as const,
        required: false,
        minimum: '0',
        maximum: '150',
      },
    ];
    const custom = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
    const editor = {
      ...legacy,
      mode: 'NONE' as const,
      changed: true,
      fields,
      customText: JSON.stringify(custom),
    };
    const stored = messageValidationProfile(editor, DataType.JSON);
    expect(stored).toEqual({
      version: 1,
      mode: 'NONE',
      fieldRules: [
        { field: 'patient_id', type: 'text', required: true },
        { field: 'age', type: 'number', required: false, minimum: 0, maximum: 150 },
      ],
      custom: { jsonSchema: custom },
      legacy: original,
    });
    const reopened = createMessageValidationDraft(stored, DataType.JSON);
    expect(reopened.mode).toBe('NONE');
    expect(reopened.fields).toEqual(fields);
    expect(JSON.parse(reopened.customText)).toEqual(custom);
    expect(reopened.legacy).toEqual(original);
    expect(
      messageValidationProfile({ ...reopened, changed: true, mode: 'FIELDS' }, DataType.JSON),
    ).toMatchObject({ mode: 'FIELDS', custom: { jsonSchema: custom } });
    expect(
      messageValidationProfile({ ...reopened, changed: true, mode: 'CUSTOM' }, DataType.JSON),
    ).toMatchObject({ mode: 'CUSTOM', fieldRules: stored.fieldRules });
  });

  it('does not count placeholders or empty rule lists as a configured field validator', () => {
    const initial = createMessageValidationDraft({}, DataType.JSON);
    const empty = { ...initial, mode: 'FIELDS' as const, changed: true, fields: [] };
    expect(validationDraftErrors(empty, DataType.JSON)).toEqual(['Add at least one field rule.']);
    expect(messageValidationConfigured(empty, DataType.JSON)).toBe(false);
    const blank = { ...empty, fields: [newValidationField()] };
    expect(validationDraftErrors(blank, DataType.JSON)).toContain(
      'Rule 1: Enter an input field path.',
    );
    expect(() => messageValidationProfile(blank, DataType.JSON)).toThrow('input field path');
    expect(messageValidationConfigured(blank, DataType.JSON)).toBe(false);
    const ready = { ...empty, fields: [{ ...newValidationField(), field: 'patient.id' }] };
    expect(messageValidationConfigured(ready, DataType.JSON)).toBe(true);
    expect(messageValidationSummary(ready, DataType.JSON)).toBe('1 required fields · 1 rules');
  });

  it('supports only JSON field rules and valid supported paths without silently fixing them', () => {
    const initial = createMessageValidationDraft({}, DataType.JSON);
    const editor = {
      ...initial,
      mode: 'FIELDS' as const,
      changed: true,
      fields: [{ ...newValidationField(), field: 'patients.0.id' }],
    };
    expect(validationDraftErrors(editor, DataType.JSON)).toEqual([]);
    for (const format of [DataType.XML, DataType.HL7V2, DataType.TEXT])
      expect(validationDraftErrors(editor, format)[0]).toContain('JSON input only');
    for (const field of [
      'patient..id',
      'patient[id]',
      '__proto__.x',
      'patient.constructor.x',
      ' patient_id ',
    ]) {
      expect(
        validationDraftErrors(
          { ...editor, fields: [{ ...editor.fields[0], field }] },
          DataType.JSON,
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps exact text values and excludes irrelevant options when a rule type changes', () => {
    const field = {
      ...newValidationField(),
      field: 'gender',
      allowedValuesText: 'M\nF\n U ',
      minLength: '1',
      maxLength: '5',
      minimum: '0',
      maximum: '3',
    };
    expect(validationFieldRules([field])).toEqual([
      {
        field: 'gender',
        type: 'text',
        required: true,
        allowedValues: ['M', 'F', ' U '],
        minLength: 1,
        maxLength: 5,
      },
    ]);
    expect(validationFieldRules([{ ...field, allowedValuesText: ' ' }])[0].allowedValues).toEqual([
      ' ',
    ]);
    expect(validationFieldRules([{ ...field, type: 'date' }])).toEqual([
      { field: 'gender', type: 'date', required: true },
    ]);
    expect(validationFieldRules([{ ...field, type: 'boolean' }])).toEqual([
      { field: 'gender', type: 'boolean', required: true },
    ]);
    expect(validationFieldRules([{ ...field, type: 'number' }])).toEqual([
      { field: 'gender', type: 'number', required: true, minimum: 0, maximum: 3 },
    ]);
    const editor = {
      ...createMessageValidationDraft({}, DataType.JSON),
      mode: 'FIELDS' as const,
      fields: [{ ...field, type: 'number' as const, minimum: '5', maximum: '3' }],
    };
    expect(validationDraftErrors(editor, DataType.JSON)[0]).toContain(
      'Minimum value cannot exceed maximum value',
    );
  });

  it('treats empty custom schema as valid with no field restrictions, without a configured badge', () => {
    const initial = createMessageValidationDraft({}, DataType.JSON);
    const empty = { ...initial, changed: true, mode: 'CUSTOM' as const };
    expect(validationDraftErrors(empty, DataType.JSON)).toEqual([]);
    expect(messageValidationSummary(empty, DataType.JSON)).toContain('no field restrictions');
    expect(messageValidationConfigured(empty, DataType.JSON)).toBe(false);
    expect(
      messageValidationConfigured(
        createMessageValidationDraft({ jsonSchema: {} }, DataType.JSON),
        DataType.JSON,
      ),
    ).toBe(false);
    expect(
      messageValidationConfigured({ ...empty, customText: '{"foo":"bar"}' }, DataType.JSON),
    ).toBe(false);
    for (const customText of ['{', '[]', 'null', '"value"'])
      expect(validationDraftErrors({ ...empty, customText }, DataType.JSON).length).toBeGreaterThan(
        0,
      );
  });

  it('presents format-specific custom rules with no claim of XSD or general HL7 component support', () => {
    expect(createMessageValidationDraft({}, DataType.XML).customKind).toBe('XML');
    expect(createMessageValidationDraft({}, DataType.HL7V2).customKind).toBe('HL7');
    expect(createMessageValidationDraft({}, DataType.TEXT).customKind).toBe('PROFILE');
    const xml = createMessageValidationDraft(
      { xml: { root: 'Order', requiredPaths: ['Order.ID'] } },
      DataType.XML,
    );
    expect(messageValidationProfile({ ...xml, changed: true }, DataType.XML)).toMatchObject({
      mode: 'CUSTOM',
      custom: { xml: { root: 'Order', requiredPaths: ['Order.ID'] } },
    });
    expect(validationDraftErrors(xml, DataType.JSON)[0]).toContain('does not match');
  });
});
