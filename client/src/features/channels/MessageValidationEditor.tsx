import { useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { DataType } from '../../types';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import {
  messageValidationSummary,
  messageValidationConfigured,
  newValidationField,
  validationDraftErrors,
  type MessageValidationDraft,
  type ValidationFieldDraft,
} from './channelDraft';

interface Props {
  value: MessageValidationDraft;
  format?: DataType;
  onChange: (value: MessageValidationDraft) => void;
  showErrors: boolean;
}
function example(format?: DataType) {
  if (format === DataType.XML)
    return {
      root: 'Order',
      requiredPaths: ['Order.ID'],
      values: [{ path: 'Order.Status', allowed: ['NEW', 'UPDATED'] }],
    };
  if (format === DataType.HL7V2)
    return { messageTypes: ['ADT^A01'], versions: ['2.5'], requiredFields: ['PID.3'] };
  if (format === DataType.TEXT)
    return { script: 'return typeof msg === "string" && msg.trim().length > 0;' };
  return {
    type: 'object',
    properties: {
      patient_id: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1 },
    },
    required: ['patient_id', 'name'],
    additionalProperties: true,
  };
}
function customExample(value: MessageValidationDraft, format?: DataType) {
  const data = example(format);
  if (value.customKind !== 'PROFILE') return JSON.stringify(data, null, 2);
  return JSON.stringify(
    format === DataType.JSON
      ? { jsonSchema: data }
      : format === DataType.XML
        ? { xml: data }
        : format === DataType.HL7V2
          ? { hl7: data }
          : data,
    null,
    2,
  );
}
export function MessageValidationEditor({ value, format, onChange, showErrors }: Props) {
  const groupName = useId();
  const [touched, setTouched] = useState(false);
  const [replaceExample, setReplaceExample] = useState(false);
  const errors = validationDraftErrors(value, format);
  const configured = messageValidationConfigured(value, format);
  const displayErrors = (showErrors || touched) && errors.length > 0;
  function update(changes: Partial<MessageValidationDraft>) {
    onChange({ ...value, ...changes, changed: true });
  }
  function changeRule(index: number, changes: Partial<ValidationFieldDraft>) {
    update({
      fields: value.fields.map((rule, position) =>
        position === index ? { ...rule, ...changes } : rule,
      ),
    });
  }
  function choose(mode: MessageValidationDraft['mode']) {
    setTouched(false);
    update({
      mode,
      ...(mode === 'FIELDS' && !value.fields.length ? { fields: [newValidationField()] } : {}),
    });
  }
  function applyExample() {
    update({ customText: customExample(value, format) });
    setReplaceExample(false);
  }
  return (
    <details className="advanced-section" aria-label="Source validation settings">
      <summary>Validation{configured && <small> · Configured</small>}</summary>
      <fieldset className="validation-options message-validation">
        <legend>Message validation</legend>
        <label className="check-field">
          <input
            type="radio"
            name={groupName}
            checked={value.mode === 'NONE'}
            onChange={() => choose('NONE')}
          />
          No additional validation
        </label>
        <label className="check-field">
          <input
            type="radio"
            name={groupName}
            checked={value.mode === 'FIELDS'}
            disabled={format !== DataType.JSON}
            onChange={() => choose('FIELDS')}
          />
          Field validation
        </label>
        <label className="check-field">
          <input
            type="radio"
            name={groupName}
            checked={value.mode === 'CUSTOM'}
            onChange={() => choose('CUSTOM')}
          />
          Custom validation schema
        </label>
        {value.legacy && (
          <label className="check-field">
            <input
              type="radio"
              name={groupName}
              checked={value.mode === 'LEGACY'}
              onChange={() => choose('LEGACY')}
            />
            Keep legacy validation
          </label>
        )}
        {format !== DataType.JSON && (
          <p className="muted">
            Field validation currently supports JSON input. Use supported custom rules for this
            format.
          </p>
        )}
        {value.mode === 'NONE' && (
          <p className="muted">
            Only message parsing is applied. No additional field rules are configured.
          </p>
        )}
        {value.mode === 'LEGACY' && (
          <p className="muted">
            {value.legacy?.jsonSchema
              ? 'The existing rule requires a JSON object. It does not require individual fields.'
              : 'The existing rule checks message syntax and size. It does not require individual fields; XML and HL7 parsing already checks syntax.'}{' '}
            This configuration is retained until you explicitly choose another mode.
          </p>
        )}
        {value.mode === 'FIELDS' && (
          <div className="validation-fields">
            <p className="muted">
              Check incoming JSON fields before filtering or transformation. All configured rules
              must pass.
            </p>
            {value.fields.map((rule, index) => (
              <fieldset
                key={index}
                className="validation-rule"
                aria-label={`Validation rule ${index + 1}`}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setTouched(true);
                }}
              >
                <label className="field">
                  <span>Field</span>
                  <input
                    value={rule.field}
                    maxLength={256}
                    placeholder="e.g. patient_id"
                    aria-invalid={
                      displayErrors
                        ? errors.some((error) => error.startsWith(`Rule ${index + 1}:`))
                        : undefined
                    }
                    onChange={(event) => changeRule(index, { field: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Type</span>
                  <select
                    value={rule.type}
                    onChange={(event) =>
                      changeRule(index, {
                        type: event.target.value as ValidationFieldDraft['type'],
                      })
                    }
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="date">Date (YYYY-MM-DD)</option>
                  </select>
                </label>
                <label className="check-field validation-required">
                  <input
                    type="checkbox"
                    checked={rule.required}
                    onChange={(event) => changeRule(index, { required: event.target.checked })}
                  />
                  Required
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove validation rule ${index + 1}`}
                  onClick={() => {
                    setTouched(false);
                    update({ fields: value.fields.filter((_, position) => position !== index) });
                  }}
                >
                  <Trash2 size={15} />
                </button>
                {['text', 'number'].includes(rule.type) && (
                  <details className="validation-more">
                    <summary>More rules</summary>
                    {rule.type === 'text' ? (
                      <>
                        <label className="field">
                          <span>Allowed values (one per line)</span>
                          <textarea
                            rows={3}
                            value={rule.allowedValuesText}
                            maxLength={15049}
                            onChange={(event) =>
                              changeRule(index, { allowedValuesText: event.target.value })
                            }
                          />
                          <small>Values match exactly, including case and whitespace.</small>
                        </label>
                        <div className="form-grid">
                          <label className="field">
                            <span>Minimum length</span>
                            <input
                              type="number"
                              min={0}
                              max={1048576}
                              step={1}
                              value={rule.minLength}
                              onChange={(event) =>
                                changeRule(index, { minLength: event.target.value })
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Maximum length</span>
                            <input
                              type="number"
                              min={0}
                              max={1048576}
                              step={1}
                              value={rule.maxLength}
                              onChange={(event) =>
                                changeRule(index, { maxLength: event.target.value })
                              }
                            />
                          </label>
                        </div>
                      </>
                    ) : (
                      <div className="form-grid">
                        <label className="field">
                          <span>Minimum value</span>
                          <input
                            type="number"
                            step="any"
                            value={rule.minimum}
                            onChange={(event) => changeRule(index, { minimum: event.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span>Maximum value</span>
                          <input
                            type="number"
                            step="any"
                            value={rule.maximum}
                            onChange={(event) => changeRule(index, { maximum: event.target.value })}
                          />
                        </label>
                      </div>
                    )}
                  </details>
                )}
              </fieldset>
            ))}
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={value.fields.length >= 50}
                onClick={() => {
                  setTouched(false);
                  update({ fields: [...value.fields, newValidationField()] });
                }}
              >
                <Plus size={14} />
                Add validation rule
              </Button>
            </div>
            <details className="validation-help">
              <summary>Field paths and rule behavior</summary>
              <p>
                Use a direct key such as patient_id, a nested path such as patient.id, or an array
                index such as patients.0.id. Brackets and wildcard paths are not supported.
              </p>
              <p>
                Required means a value must be present and filled in: missing, null, empty and
                whitespace-only text fail. The number 0 and boolean false are valid values.
              </p>
              <p>
                Optional missing fields are skipped. Present values, including null, must match the
                configured type. Validation never converts types or changes values. Additional
                fields are allowed.
              </p>
              <p>
                Example rules: patient_id as required Text, name as required Text, gender as
                optional Text with allowed values M, F, U, and date_of_birth as optional Date. These
                are examples, not rules applied automatically.
              </p>
            </details>
          </div>
        )}
        {value.mode === 'CUSTOM' && (
          <div className="validation-custom">
            <p className="muted">
              {value.customKind === 'JSON_SCHEMA'
                ? 'Enter a JSON Schema object. Supported rules include type, properties, required, enum and bounded lengths or numbers. Remote references, patterns and format keywords are not supported; use Field validation for calendar dates.'
                : value.customKind === 'XML'
                  ? 'Enter XML rules with root, requiredPaths and values. Paths are literal dotted element names, including namespace prefixes. Repeated values must all match. Attributes, XPath and XSD are not supported.'
                  : value.customKind === 'HL7'
                    ? 'Enter HL7 rules with messageTypes, versions and requiredFields. Required paths use segment.field, such as PID.3; component and repetition rules are not supported here.'
                    : 'This retained profile may combine JSON Schema, XML rules, HL7 rules and a sandboxed script. Edit the complete validation profile object; it is preserved without converting it to field rules.'}
            </p>
            <label className="field">
              <span>
                {value.customKind === 'JSON_SCHEMA'
                  ? 'JSON Schema'
                  : value.customKind === 'XML'
                    ? 'XML validation rules'
                    : value.customKind === 'HL7'
                      ? 'HL7 validation rules'
                      : 'Validation profile'}
              </span>
              <textarea
                aria-label="Custom validation schema editor"
                spellCheck={false}
                rows={8}
                className="code-input"
                value={value.customText}
                onBlur={() => setTouched(true)}
                onChange={(event) => update({ customText: event.target.value })}
              />
            </label>
            {messageValidationSummary(value, format).includes('no field restrictions') && (
              <p className="muted">An empty configuration adds no field restrictions.</p>
            )}
            {value.changed && (
              <p className="muted">
                Save or use Review &amp; Test to check this custom configuration on the server.
              </p>
            )}
            <details className="validation-help">
              <summary>Example configuration</summary>
              <p>
                Adjust this synthetic example to your channel. No example rule is applied
                automatically.
              </p>
              <pre className="code-box">{customExample(value, format)}</pre>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (value.customText.trim() && value.customText.trim() !== '{}')
                    setReplaceExample(true);
                  else applyExample();
                }}
              >
                Use example
              </Button>
            </details>
          </div>
        )}
        {configured && (
          <p className="configuration-notice" role="status">
            {messageValidationSummary(value, format)}
          </p>
        )}
        {displayErrors && (
          <ul className="alert error validation-errors" role="alert">
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        )}
      </fieldset>
      <ConfirmationModal
        isOpen={replaceExample}
        onClose={() => setReplaceExample(false)}
        onConfirm={applyExample}
        title="Replace validation with example?"
        confirmLabel="Use example"
        message="This replaces the custom configuration currently shown in the editor. Your saved channel is unchanged until you save and publish."
      />
    </details>
  );
}
