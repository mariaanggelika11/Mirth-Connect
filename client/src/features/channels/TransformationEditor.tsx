import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Code2, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { ScriptEditorModal } from '../../components/status/ScriptEditorModal';
import { DataType } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { FieldPicker, type FieldOption } from '../../components/ui/FieldPicker';
import {
  HL7Configuration,
  HL7AdvancedSettings,
  hl7TargetOptions,
  hl7FieldDescription,
  hl7TargetSelection,
} from './HL7Configuration';
import {
  defaultHl7Configuration,
  type Hl7Configuration,
} from '../../../../server/src/utils/hl7Configuration';
import {
  compileFieldMapping,
  readFieldMapping,
  validateFieldMapping,
  type FieldMappingConfig,
  type FieldMappingRow,
} from '../../../../server/src/utils/fieldMapping';

interface Props {
  inboundFormat: DataType;
  processingScript: string;
  onScriptChange: (value: string) => void;
  onValidityChange?: (valid: boolean) => void;
  context?: 'source' | 'destination';
  dialog?: { isOpen: boolean; onClose: () => void; title: string };
  children?: ReactNode;
  sourceFields?: FieldOption[];
  targetFields?: FieldOption[];
  outboundFormat?: DataType;
  renderLayout?: (main: ReactNode, advanced: ReactNode, hl7Settings: ReactNode) => ReactNode;
}
type Conversion = NonNullable<FieldMappingRow['conversion']>;
type MappingRow = FieldMappingRow;
type MappingDraft = Omit<FieldMappingConfig, 'version' | 'rows'> & {
  version: 1 | 2;
  rows: MappingRow[];
  hl7?: Hl7Configuration;
};
const emptyMapping = (): MappingDraft => ({ version: 1, rows: [] });
function MappingOptions({
  row,
  index,
  onChange,
}: {
  row: MappingRow;
  index: number;
  onChange: (change: Partial<MappingRow>) => void;
}) {
  return (
    <details className="mapping-options" aria-label={`Mapping options ${index + 1}`}>
      <summary>
        Options
        {(row.required ||
          row.defaultValue !== undefined ||
          (row.conversion && row.conversion !== 'NONE')) && <small> · Configured</small>}
      </summary>
      <div className="mapping-option-fields">
        <label className="check-field mapping-required">
          <input
            type="checkbox"
            aria-label={`Required field ${index + 1}`}
            checked={row.required}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          <span aria-hidden="true">Required field</span>
        </label>
        <label className="field">
          <span>Default value</span>
          <input
            aria-label={`Default value ${index + 1}`}
            value={row.defaultValue ?? ''}
            placeholder="Optional"
            onChange={(event) => onChange({ defaultValue: event.target.value || undefined })}
          />
        </label>
        <label className="field">
          <span>Type conversion</span>
          <select
            aria-label={`Type conversion ${index + 1}`}
            value={row.conversion || 'NONE'}
            onChange={(event) => onChange({ conversion: event.target.value as Conversion })}
          >
            <option value="NONE">Keep original type</option>
            <option value="TEXT">Convert to text</option>
            <option value="NUMBER">Convert to number</option>
            <option value="BOOLEAN">Convert to boolean</option>
            <option value="DATE_TO_HL7">YYYY-MM-DD → YYYYMMDD</option>
            <option value="DATE_FROM_HL7">YYYYMMDD → YYYY-MM-DD</option>
          </select>
        </label>
      </div>
      <small>
        Defaults replace missing, null or empty input before Required is checked. 0 and false are
        kept.
      </small>
    </details>
  );
}
function configuredRow(row: MappingRow) {
  return !!(
    row.source.trim() ||
    row.target.trim() ||
    row.required ||
    row.defaultValue !== undefined ||
    (row.conversion && row.conversion !== 'NONE')
  );
}

export function transformationScriptEditingPlan(script: string) {
  const requiresReplacement = script.trimStart().startsWith('/* MIRTH_FIELD_MAPPING_V2:');
  return { requiresReplacement, initialScript: requiresReplacement ? '' : script };
}

export function TransformationEditor({
  inboundFormat,
  processingScript,
  onScriptChange,
  onValidityChange,
  context = 'source',
  dialog,
  children,
  sourceFields = [],
  targetFields = [],
  outboundFormat,
  renderLayout,
}: Props) {
  const hl7Destination = context === 'destination' && outboundFormat === DataType.HL7V2;
  const freshMapping = (): MappingDraft =>
    hl7Destination ? { version: 2, rows: [], hl7: defaultHl7Configuration() } : emptyMapping();
  const parsed = readFieldMapping(processingScript);
  const [mapping, setMapping] = useState<MappingDraft>(() => parsed || freshMapping());
  const [modifyFields, setModifyFields] = useState(() => !!processingScript.trim());
  const [scriptMode, setScriptMode] = useState(() => !!processingScript.trim() && !parsed);
  const [mappingError, setMappingError] = useState('');
  const [editingScript, setEditingScript] = useState(false);
  const [scriptInitial, setScriptInitial] = useState('');
  const [confirmCustomReplacement, setConfirmCustomReplacement] = useState(false);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [confirmPassThrough, setConfirmPassThrough] = useState(false);
  const [confirmHl7Setup, setConfirmHl7Setup] = useState(false);
  const [confirmRemoveHl7, setConfirmRemoveHl7] = useState(false);
  const lastScript = useRef(processingScript);
  const validityCallback = useRef(onValidityChange);
  validityCallback.current = onValidityChange;
  useEffect(() => {
    if (lastScript.current === processingScript) return;
    lastScript.current = processingScript;
    const value = readFieldMapping(processingScript);
    setMapping(value || freshMapping());
    setScriptMode(!!processingScript.trim() && !value);
    setModifyFields(!!processingScript.trim());
    setMappingError('');
    validityCallback.current?.(true);
  }, [processingScript]);
  useEffect(() => {
    if (!processingScript.trim()) {
      setMapping((current) => {
        if (hl7Destination)
          return current.hl7 ? current : { ...current, version: 2, hl7: defaultHl7Configuration() };
        return current.hl7 && !current.rows.some(configuredRow) ? emptyMapping() : current;
      });
    }
  }, [hl7Destination, processingScript]);
  useEffect(
    () => () => {
      if (context === 'source') validityCallback.current?.(true);
    },
    [context],
  );

  const supportsMapping =
    context === 'destination' || inboundFormat !== DataType.TEXT || mapping.rows.length > 0;

  function updateMapping(value: MappingDraft) {
    const requiresV2 = value.rows.some(
      (row) =>
        /^\d+(?:\.|$)/.test(row.source) ||
        /\[[0-9]+\]/.test(row.source) ||
        (inboundFormat === DataType.HL7V2 && /^[A-Z0-9]{3}-[0-9]+/.test(row.source)),
    );
    const next = requiresV2 ? { ...value, version: 2 as const } : value;
    setMapping(next);
    try {
      const rows = next.rows.filter(configuredRow);
      const script = rows.length
        ? compileFieldMapping({ ...next, rows } as FieldMappingConfig)
        : '';
      lastScript.current = script;
      onScriptChange(script);
      setMappingError('');
      validityCallback.current?.(true);
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : 'Check the mapping fields.');
      validityCallback.current?.(false);
    }
  }
  function configureHl7() {
    updateMapping({
      ...mapping,
      version: 2,
      rootElement: undefined,
      hl7: defaultHl7Configuration(),
    });
    setConfirmHl7Setup(false);
  }
  function updateRow(index: number, change: Partial<MappingRow>) {
    updateMapping({
      ...mapping,
      ...(change.conversion ? { version: 2 as const } : {}),
      rows: mapping.rows.map((row, position) => (position === index ? { ...row, ...change } : row)),
    });
  }
  function rowError(row: MappingRow, index: number) {
    if (!configuredRow(row)) return '';
    if (!row.source.trim())
      return `Mapping ${index + 1}: select or enter a Source Field, such as patient.id.`;
    if (!row.target.trim())
      return `Mapping ${index + 1}: select or enter a Target Field${mapping.hl7 ? ', such as PID.3.' : ', such as patientId.'}`;
    const globalRow = /^Mapping (\d+):/.exec(mappingError);
    if (globalRow && Number(globalRow[1]) === mapping.rows.filter(configuredRow).indexOf(row) + 1)
      return mappingError.replace(/^Mapping \d+:/, `Mapping ${index + 1}:`);
    try {
      validateFieldMapping({ ...mapping, rows: [row] });
      return '';
    } catch (error) {
      if (!(error instanceof Error) || !/^Mapping \d+:/.test(error.message)) return '';
      return (
        error.message.replace(/^Mapping 1:/, `Mapping ${index + 1}:`) +
        (error.message.includes('field path')
          ? ' Use dotted paths such as patient.id or PID.3.'
          : '')
      );
    }
  }
  const compactMapping = hl7Destination && !!mapping.hl7;
  const targetOptions = mapping.hl7 ? hl7TargetOptions(mapping.hl7.messageType) : targetFields;
  function saveScript(script: string) {
    lastScript.current = script;
    const value = readFieldMapping(script);
    setMapping(value || emptyMapping());
    setScriptMode(!!script.trim() && !value);
    setModifyFields(!!script.trim());
    setMappingError('');
    validityCallback.current?.(true);
    onScriptChange(script);
    setEditingScript(false);
  }
  function editScript() {
    const plan = transformationScriptEditingPlan(processingScript);
    setScriptInitial(plan.initialScript);
    if (plan.requiresReplacement) setConfirmCustomReplacement(true);
    else setEditingScript(true);
  }

  const main = (
    <>
      {!hl7Destination && context === 'destination' && (
        <div className="section-intro">
          <h4>Destination transformation</h4>
          <p>Map fields for this destination only.</p>
        </div>
      )}
      {context === 'source' && (
        <p className="muted">
          Map fields shared by all destinations. Unmapped fields are excluded.
        </p>
      )}
      {!scriptMode && context === 'destination' && mapping.hl7 && (
        <>
          {!hl7Destination && (
            <div className="form-section">
              <p className="muted">
                The saved HL7 template remains active before {outboundFormat || 'destination'}{' '}
                format conversion. Keep it to convert the HL7 structure, or explicitly remove the
                template.
              </p>
              <div>
                <Button type="button" variant="secondary" onClick={() => setConfirmRemoveHl7(true)}>
                  Remove HL7 template
                </Button>
              </div>
            </div>
          )}
          <HL7Configuration
            value={mapping.hl7}
            onChange={(hl7) => updateMapping({ ...mapping, version: 2, hl7 })}
          />
        </>
      )}
      {!scriptMode && hl7Destination && !mapping.hl7 && (
        <section className="hl7-setup form-section" aria-label="HL7 transformation setup">
          <h3>Build an HL7 message</h3>
          <p className="muted">
            Choose a v2.5 message template to generate the header and map source fields. Existing
            HL7 structures can continue through format conversion without a new template.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => (mapping.rootElement ? setConfirmHl7Setup(true) : configureHl7())}
          >
            Configure HL7 message
          </Button>
        </section>
      )}
      <section className="mapping-section" aria-label="Field mapping">
        <h3>Field Mapping</h3>
        {scriptMode ? (
          <p className="muted">
            A custom transformation is configured. Its script is kept unchanged.
          </p>
        ) : !supportsMapping ? (
          <p className="muted">Use an advanced script to map plain-text messages.</p>
        ) : (
          <>
            {inboundFormat === DataType.TEXT && context !== 'destination' && (
              <p className="muted">
                This mapping needs structured input. Use an advanced script to parse plain text.
              </p>
            )}
            {!mapping.rows.length && (
              <p className="muted">
                {compactMapping
                  ? 'Add fields to build this message. Structured HL7 JSON or raw HL7 can pass through without mappings.'
                  : 'Add a mapping to select or rename incoming fields.'}
              </p>
            )}
            <div
              className={compactMapping ? 'hl7-mapping-table' : 'mapping-rows'}
              role={compactMapping ? 'table' : undefined}
              aria-label={compactMapping ? 'HL7 field mappings' : undefined}
            >
              {compactMapping && (
                <div className="hl7-mapping-head" role="row">
                  <span role="columnheader">
                    {inboundFormat === DataType.JSON ? 'JSON field' : `${inboundFormat} field`}
                  </span>
                  <span role="columnheader">HL7 field</span>
                  <span role="columnheader" className="sr-only">
                    Actions
                  </span>
                </div>
              )}
              {!compactMapping && mapping.rows.length > 0 && (
                <div className="mapping-grid-head" aria-hidden="true">
                  <span>Source Field</span>
                  <span>Target Field</span>
                  <span />
                </div>
              )}
              {mapping.rows.map((row, index) => {
                const error = rowError(row, index);
                const sourceError = /source|input/i.test(error);
                const fields = (
                  <>
                    <div className="mapping-source-cell" role={compactMapping ? 'cell' : undefined}>
                      <FieldPicker
                        label={`Source Field ${index + 1}`}
                        value={row.source}
                        options={sourceFields}
                        placeholder={
                          inboundFormat === DataType.HL7V2 ? 'e.g. PID.3' : 'e.g. patient_id'
                        }
                        onChange={(source) => updateRow(index, { source })}
                        error={sourceError ? error : undefined}
                        hideLabel
                      />
                    </div>
                    <div className="mapping-target-cell" role={compactMapping ? 'cell' : undefined}>
                      <FieldPicker
                        label={`Target Field ${index + 1}`}
                        value={row.target}
                        options={targetOptions}
                        placeholder={mapping.hl7 ? 'Select HL7 field' : 'e.g. PatientID'}
                        onChange={(target) =>
                          updateRow(
                            index,
                            mapping.hl7 && hl7Destination && inboundFormat !== DataType.HL7V2
                              ? hl7TargetSelection(target, row.conversion, row.target)
                              : { target },
                          )
                        }
                        error={error && !sourceError ? error : undefined}
                        presentation={compactMapping ? 'dropdown' : 'input'}
                        displayValue={(path) =>
                          `${path.replace('.', '-')} — ${hl7FieldDescription(path)}`
                        }
                        hideLabel
                      />
                      {compactMapping && row.conversion === 'DATE_TO_HL7' && (
                        <small className="muted">YYYY-MM-DD → YYYYMMDD</small>
                      )}
                    </div>
                    <div className="mapping-action-cell" role={compactMapping ? 'cell' : undefined}>
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label={`Remove mapping ${index + 1}`}
                        onClick={() =>
                          updateMapping({
                            ...mapping,
                            rows: mapping.rows.filter((_, position) => position !== index),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </>
                );
                const options = (
                  <MappingOptions
                    row={row}
                    index={index}
                    onChange={(change) => updateRow(index, change)}
                  />
                );
                return compactMapping ? (
                  <div key={index} role="rowgroup" className="hl7-mapping-entry">
                    <div className="hl7-mapping-row" role="row">
                      {fields}
                    </div>
                    <div role="row" className="hl7-mapping-options">
                      <div role="cell" aria-colspan={3}>
                        {options}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mapping-row" key={index}>
                    {fields}
                    {options}
                  </div>
                );
              })}
            </div>
            {mappingError && !/^Mapping \d+:/.test(mappingError) && (
              <p className="alert error" role="alert">
                {mappingError}
              </p>
            )}
            {context === 'destination' &&
              outboundFormat === DataType.XML &&
              !mapping.hl7 &&
              mapping.rows.some(configuredRow) && (
                <details className="advanced-section">
                  <summary>XML output options</summary>
                  <label className="field">
                    <span>XML root element (optional)</span>
                    <input
                      value={mapping.rootElement || ''}
                      maxLength={80}
                      placeholder="Patient"
                      onChange={(event) =>
                        updateMapping({ ...mapping, rootElement: event.target.value || undefined })
                      }
                    />
                  </label>
                </details>
              )}
            <Button
              type="button"
              variant="secondary"
              className="mapping-add-button"
              disabled={mapping.rows.length >= 100}
              onClick={() =>
                updateMapping({
                  ...mapping,
                  rows: [...mapping.rows, { source: '', target: '', required: false }],
                })
              }
            >
              <Plus size={16} /> Add Mapping
            </Button>
          </>
        )}
      </section>
    </>
  );
  const hl7Settings =
    mapping.hl7 && context === 'destination' ? (
      <details className="advanced-section" aria-label="HL7 destination settings">
        <summary>HL7 settings</summary>
        <HL7AdvancedSettings
          value={mapping.hl7}
          onChange={(hl7) => updateMapping({ ...mapping, version: 2, hl7 })}
        />
      </details>
    ) : null;
  const advanced = (
    <details className="advanced-section">
      <summary>
        Advanced Custom Transformation Script{scriptMode && <small> · Configured</small>}
      </summary>
      {!!mapping.rows.length && !scriptMode && (
        <p className="muted">
          {transformationScriptEditingPlan(processingScript).requiresReplacement
            ? 'Field mappings generate managed transformation code. Replace them with your own custom script only when needed, then test it in Review & Test.'
            : 'Editing the generated script can switch this transformation to script mode.'}
        </p>
      )}
      <div className="heading-actions">
        <Button type="button" variant="secondary" onClick={editScript}>
          <Code2 size={15} /> Edit Script
        </Button>
        {scriptMode && supportsMapping && (
          <Button type="button" variant="secondary" onClick={() => setConfirmReplacement(true)}>
            Switch to field mapping
          </Button>
        )}
      </div>
    </details>
  );
  const content = (
    <div
      role={hl7Destination || context === 'source' ? 'region' : undefined}
      aria-label={
        context === 'source'
          ? 'Shared transformation'
          : hl7Destination
            ? 'HL7 destination mapping'
            : undefined
      }
      className={`form-section transformation-editor ${hl7Destination ? 'compact-hl7-editor' : ''}`}
    >
      {context === 'source' && (
        <div className="section-intro">
          <h3>Transformation</h3>
        </div>
      )}
      {context === 'source' && (
        <fieldset className="transformation-choice">
          <legend className="sr-only">Do you want to modify incoming data?</legend>
          <label className="check-field">
            <input
              type="radio"
              name="shared-transformation"
              checked={!modifyFields}
              onChange={() => {
                if (processingScript.trim() || mapping.rows.some(configuredRow))
                  setConfirmPassThrough(true);
                else {
                  setModifyFields(false);
                  updateMapping(emptyMapping());
                }
              }}
            />
            No transformation
          </label>
          <label className="check-field">
            <input
              type="radio"
              name="shared-transformation"
              checked={modifyFields}
              onChange={() => setModifyFields(true)}
            />
            Modify fields
          </label>
          {!modifyFields && <p className="muted">The message will continue to destinations.</p>}
        </fieldset>
      )}
      {renderLayout ? (
        renderLayout(main, advanced, hl7Settings)
      ) : (
        <div
          className="form-section"
          style={{ display: context === 'source' && !modifyFields ? 'none' : undefined }}
          hidden={context === 'source' && !modifyFields}
        >
          {main}
          {advanced}
          {hl7Settings}
        </div>
      )}
      {children}
      {dialog && (
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={dialog.onClose}>
            Done
          </Button>
        </div>
      )}
      <ScriptEditorModal
        isOpen={editingScript}
        onClose={() => setEditingScript(false)}
        onSave={saveScript}
        initialScript={scriptInitial}
        title={
          context === 'destination'
            ? 'Destination Transformation Script'
            : 'Custom Transformation Script'
        }
        scriptType="transformer"
      />
      <ConfirmationModal
        isOpen={confirmCustomReplacement}
        onClose={() => setConfirmCustomReplacement(false)}
        onConfirm={() => {
          setConfirmCustomReplacement(false);
          setEditingScript(true);
        }}
        title="Replace field mappings with a custom script?"
        message="A blank script editor will open. Your field mappings and HL7 configuration stay unchanged until you save the custom script. Cancel to keep them."
        confirmLabel="Replace with custom script"
      />
      <ConfirmationModal
        isOpen={confirmHl7Setup}
        onClose={() => setConfirmHl7Setup(false)}
        onConfirm={configureHl7}
        title="Replace XML wrapping with an HL7 template?"
        message="HL7 uses configured segments instead of an XML root. Your mapping rows are retained; review their target fields for the selected HL7 template."
        confirmLabel="Configure HL7 message"
      />
      <ConfirmationModal
        isOpen={confirmRemoveHl7}
        onClose={() => setConfirmRemoveHl7(false)}
        onConfirm={() => {
          updateMapping({ ...mapping, hl7: undefined });
          setConfirmRemoveHl7(false);
        }}
        title="Remove the HL7 template?"
        message="Keep the field mappings and remove generated HL7 headers and segments. Review the output before saving."
        confirmLabel="Remove template"
      />
      <ConfirmationModal
        isOpen={confirmPassThrough}
        onClose={() => setConfirmPassThrough(false)}
        onConfirm={() => {
          updateMapping(emptyMapping());
          setScriptMode(false);
          setModifyFields(false);
          setConfirmPassThrough(false);
        }}
        title="Use pass-through?"
        message="This removes this transformation's field mappings. The destination format converter still runs."
        confirmLabel="Use pass-through"
      />
      <ConfirmationModal
        isOpen={confirmReplacement}
        onClose={() => setConfirmReplacement(false)}
        onConfirm={() => {
          setScriptMode(false);
          updateMapping(emptyMapping());
          setConfirmReplacement(false);
        }}
        title="Switch to field mapping?"
        message="This replaces the existing transformation script. Cancel to keep the script."
        confirmLabel="Use field mapping"
      />
    </div>
  );
  return dialog ? (
    <Modal isOpen={dialog.isOpen} onClose={dialog.onClose} title={dialog.title}>
      <div className="form-body">{content}</div>
    </Modal>
  ) : (
    content
  );
}
