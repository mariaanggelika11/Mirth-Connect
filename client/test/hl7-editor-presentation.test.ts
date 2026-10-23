import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  TransformationEditor,
  transformationScriptEditingPlan,
} from '../src/features/channels/TransformationEditor';
import { DestinationEditor } from '../src/features/channels/DestinationEditor';
import { FilterEditor } from '../src/features/channels/FilterEditor';
import {
  HL7Configuration,
  HL7AdvancedSettings,
  hl7TargetOptions,
  hl7TargetSelection,
  hl7FieldDescription,
} from '../src/features/channels/HL7Configuration';
import type { FieldOption } from '../src/components/ui/FieldPicker';
import { DataType, DestinationType, type Destination } from '../src/types';
import { defaultHl7Configuration } from '../../server/src/utils/hl7Configuration';
import { compileFieldMapping } from '../../server/src/utils/fieldMapping';

function paths(options: FieldOption[]): FieldOption[] {
  return options.flatMap((option) => [option, ...paths(option.children || [])]);
}
const destination = (changes: Partial<Destination> = {}): Destination => ({
  id: 17,
  name: 'Synthetic receiver',
  type: DestinationType.REST,
  endpoint: 'https://receiver.example.test/messages',
  outboundDataType: DataType.JSON,
  ...changes,
});
const destinationHtml = (changes: Partial<Destination>) =>
  renderToStaticMarkup(
    createElement(DestinationEditor, {
      dest: destination(changes),
      index: 0,
      onChange: () => {},
      onRemove: () => {},
      onEditScript: () => {},
    }),
  );

describe('HL7 configuration remains contextual and template-specific', () => {
  it('starts a replacement script blank for V2 managed code while preserving V1 and custom scripts', () => {
    const mapping = {
      version: 2 as const,
      rows: [{ source: 'patient_id', target: 'patientId', required: true }],
    };
    const generated = compileFieldMapping(mapping);
    for (const script of [generated, ` \n${generated}`, `${generated}\nreturn {};`]) {
      expect(transformationScriptEditingPlan(script)).toEqual({
        requiresReplacement: true,
        initialScript: '',
      });
    }
    expect(compileFieldMapping(mapping)).toBe(generated);
    const legacy = compileFieldMapping({ ...mapping, version: 1 });
    for (const script of [legacy, 'return msg;', '']) {
      expect(transformationScriptEditingPlan(script)).toEqual({
        requiresReplacement: false,
        initialScript: script,
      });
    }
  });

  it('does not introduce global HL7 format configuration in the Source Transformation step', () => {
    const html = renderToStaticMarkup(
      createElement(TransformationEditor, {
        inboundFormat: DataType.HL7V2,
        outboundFormat: DataType.HL7V2,
        processingScript: '',
        onScriptChange: () => {},
        context: 'source',
      }),
    );
    expect(html).toContain('No transformation');
    expect(html).toContain('style="display:none" hidden=""');
    expect(html).not.toContain('HL7 message configuration');
    expect(html).not.toContain('Message type');
    expect(html).not.toContain('Configure HL7 message');
  });

  it('reopens generated destination HL7 mapping with configured header and date conversion', () => {
    const script = compileFieldMapping({
      version: 2,
      hl7: defaultHl7Configuration('ADT^A04'),
      rows: [
        { source: 'patient_id', target: 'PID.3', required: true },
        { source: 'family_name', target: 'PID.5.1', required: true },
        { source: 'dob', target: 'PID.7', required: false, conversion: 'DATE_TO_HL7' },
      ],
    });
    const html = renderToStaticMarkup(
      createElement(TransformationEditor, {
        inboundFormat: DataType.JSON,
        outboundFormat: DataType.HL7V2,
        processingScript: script,
        onScriptChange: () => {},
        context: 'destination',
      }),
    );
    expect(html).toContain('HL7 message configuration');
    expect(html).toContain('Sending application');
    expect(html).toContain('value="MINI_MIRTH"');
    expect(html).toContain('HL7 field mappings');
    expect(html).toContain('HL7 settings');
    expect(html).not.toContain('Template structure and fields');
    expect(html).toContain('value="DATE_TO_HL7" selected=""');
    expect(html).not.toContain('A custom transformation is configured.');
  });

  it('keeps only type and version visible and offers template-specific fields on demand', () => {
    const html = renderToStaticMarkup(
      createElement(HL7Configuration, {
        value: defaultHl7Configuration('ADT^A04'),
        onChange: () => {},
      }),
    );
    expect(html).toContain('<output aria-label="HL7 version">2.5</output>');
    expect(html).not.toContain('value="2.3"');
    expect(html).not.toContain('MSH → EVN → PID → PV1');
    expect(html).not.toContain('Sending application');
    expect(html).not.toContain('Message control ID');
    const advanced = renderToStaticMarkup(
      createElement(HL7AdvancedSettings, { value: defaultHl7Configuration(), onChange: () => {} }),
    );
    expect(advanced).toContain('Message time and control ID are generated automatically');
    expect(advanced).not.toContain('Generated when processed');
    expect(advanced).toContain('Sending application');
    const adt = paths(hl7TargetOptions('ADT^A04'));
    const oru = paths(hl7TargetOptions('ORU^R01'));
    expect(adt.some((field) => field.path === 'OBX.5')).toBe(false);
    expect(oru.some((field) => field.path === 'OBX.5' && field.selectable)).toBe(true);
    expect(
      adt.some((field) => field.path === 'PID.5.1' && field.label.includes('Family name')),
    ).toBe(true);
    expect(
      adt.some(
        (field) =>
          field.selectable && ['MSH.1', 'MSH.2', 'MSH.9', 'MSH.11', 'MSH.12'].includes(field.path),
      ),
    ).toBe(false);
  });

  it('keeps HL7 mapping inside one closed destination disclosure without an extra setup dialog', () => {
    const html = destinationHtml({ outboundDataType: DataType.HL7V2 });
    expect(html).toContain('HL7 destination mapping');
    expect(html).toContain('Destination 1');
    expect(html).toMatch(
      /<details class="advanced-section" aria-label="Advanced destination settings"><summary>/,
    );
    expect(html.indexOf('Advanced destination settings')).toBeLessThan(
      html.indexOf('HL7 message configuration'),
    );
    expect(html).toContain('role="table"');
    expect(html).toContain('JSON field');
    expect(html).not.toContain('role="columnheader">Description');
    expect(html).not.toContain('Configure HL7 transformation');
    expect(html).not.toContain('Configure HL7 message');
    expect(html).not.toContain('Template structure and fields');
    expect(html).not.toContain('Complete or remove');
    expect(html).not.toContain('role="dialog"');
    expect(html).toMatch(
      /<details class="advanced-section" aria-label="HL7 destination settings"><summary>HL7 settings/,
    );
  });

  it('uses shared descriptions and explicit date conversion without guessing name components', () => {
    expect(hl7FieldDescription('PID-3.1')).toContain('Identifier value');
    expect(hl7FieldDescription('PID-5')).toContain('Full text; no name splitting');
    expect(hl7TargetSelection('PID-5')).toEqual({ target: 'PID.5' });
    expect(hl7TargetSelection('PID-7')).toEqual({ target: 'PID.7', conversion: 'DATE_TO_HL7' });
    expect(hl7TargetSelection('PID-7', 'NONE', 'PID.7')).toEqual({ target: 'PID.7' });
    expect(hl7TargetSelection('PID-7', 'TEXT')).toEqual({ target: 'PID.7' });
    expect(hl7TargetSelection('OBX[1].5')).toEqual({ target: 'OBX[1].5' });
    expect(hl7TargetSelection('OBX[1]-5')).toEqual({ target: 'OBX[1].5' });
  });

  it('keeps a retained HL7 template visible after the destination format changes', () => {
    const script = compileFieldMapping({
      version: 2,
      hl7: defaultHl7Configuration(),
      rows: [{ source: 'patient_id', target: 'PID.3', required: true }],
    });
    const html = renderToStaticMarkup(
      createElement(TransformationEditor, {
        inboundFormat: DataType.JSON,
        outboundFormat: DataType.XML,
        processingScript: script,
        onScriptChange: () => {},
        context: 'destination',
      }),
    );
    expect(html).toContain('saved HL7 template remains active before XML format conversion');
    expect(html).toContain('Remove HL7 template');
    expect(html).toContain('HL7 message configuration');
    expect(html).not.toContain('XML root element (optional)');
  });
});

describe('Connector settings describe supported transport without exposing credentials', () => {
  it('presents MLLP host and port, supported TLS scheme and acknowledgment semantics', () => {
    const html = destinationHtml({
      type: DestinationType.MLLP,
      endpoint: 'mllps://receiver.example.test:2575',
      outboundDataType: DataType.HL7V2,
    });
    expect(html).toContain('value="receiver.example.test"');
    expect(html).toContain('value="2575"');
    expect(html).toContain('Use TLS');
    expect(html).toMatch(/checked=""[^>]*\/>Use TLS/);
    expect(html).toContain('matching AA acknowledgment');
    expect(html).not.toContain('Endpoint *</label>');
    expect(html).not.toContain('HTTP method');
  });

  it('places saved endpoint credential guidance inside Advanced', () => {
    const html = destinationHtml({ credentialConfigured: true });
    expect(html).toContain(
      'Saved endpoint credentials are retained only while this endpoint is unchanged.',
    );
    expect(html.indexOf('Advanced destination settings')).toBeLessThan(
      html.indexOf('Saved endpoint credentials'),
    );
  });

  it('does not offer unsupported native TLS on raw TCP connectors', () => {
    const html = destinationHtml({
      type: DestinationType.TCP,
      endpoint: 'tcp://receiver.example.test:2575',
    });
    expect(html).not.toContain('Use TLS</label>');
    expect(html).toContain('MLLP framing and HL7 acknowledgment are not applied');
  });

  it('keeps delivery options while removing authentication, headers and environment references', () => {
    const html = destinationHtml({
      outboundDataType: DataType.HL7V2,
      deliveryPolicy: {
        http: {
          method: 'PATCH',
          contentType: 'text/plain',
          authentication: 'BEARER',
          headers: [{ name: 'X-Integration-Key', slot: 'INTEGRATION_KEY' }],
        },
      },
    });
    expect(html).toContain('<option selected="">PATCH</option>');
    expect(html).toContain('value="text/plain" selected=""');
    expect(html).not.toContain('MIRTH_DESTINATION_');
    expect(html).not.toContain('Custom headers');
    expect(html).not.toContain('Add Header');
    expect(html).not.toContain('<span>Authentication</span>');
    expect(html).toContain('Saved destination security settings are retained.');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('value="application/xml"');
  });

  it('keeps advanced destination conditions explicit while Source filtering remains simple', () => {
    const dest = renderToStaticMarkup(
      createElement(FilterEditor, {
        kind: 'destination',
        value: 'return false;',
        onChange: () => {},
        allowAdvanced: true,
      }),
    );
    const source = renderToStaticMarkup(
      createElement(FilterEditor, {
        kind: 'source',
        value: '',
        onChange: () => {},
        allowAdvanced: true,
      }),
    );
    expect(dest).toContain('Advanced custom condition');
    expect(dest).toContain('Source Processed Message');
    expect(dest).toContain('false to skip only this destination');
    expect(source).not.toContain('Advanced custom condition');
    expect(source).not.toContain('Edit custom condition');
  });
});
