import { useEffect, useRef, useState } from 'react';
import { Code2, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { ScriptEditorModal } from '../../components/status/ScriptEditorModal';
import { DataType } from '../../types';
import {
  compileFieldMapping,
  readFieldMapping,
  type FieldMappingConfig,
  type FieldMappingRow,
} from '../../../../server/src/utils/fieldMapping';

interface Props {
  inboundFormat: DataType;
  processingScript: string;
  onScriptChange: (value: string) => void;
  onValidityChange?: (valid: boolean) => void;
}

const emptyMapping = (): FieldMappingConfig => ({ version: 1, rows: [] });

export function TransformationEditor({
  inboundFormat,
  processingScript,
  onScriptChange,
  onValidityChange,
}: Props) {
  const parsed = readFieldMapping(processingScript);
  const [mapping, setMapping] = useState<FieldMappingConfig>(() => parsed || emptyMapping());
  const [scriptMode, setScriptMode] = useState(() => !!processingScript.trim() && !parsed);
  const [mappingError, setMappingError] = useState('');
  const [editingScript, setEditingScript] = useState(false);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const lastScript = useRef(processingScript);
  const validityCallback = useRef(onValidityChange);
  validityCallback.current = onValidityChange;
  useEffect(() => {
    if (lastScript.current === processingScript) return;
    lastScript.current = processingScript;
    const value = readFieldMapping(processingScript);
    setMapping(value || emptyMapping());
    setScriptMode(!!processingScript.trim() && !value);
    setMappingError('');
    validityCallback.current?.(true);
  }, [processingScript]);
  useEffect(() => () => validityCallback.current?.(true), []);

  const supportsMapping = inboundFormat !== DataType.TEXT || mapping.rows.length > 0;

  function updateMapping(value: FieldMappingConfig) {
    setMapping(value);
    try {
      const script = value.rows.length ? compileFieldMapping(value) : '';
      lastScript.current = script;
      onScriptChange(script);
      setMappingError('');
      validityCallback.current?.(true);
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : 'Check the mapping fields.');
      validityCallback.current?.(false);
    }
  }
  function updateRow(index: number, change: Partial<FieldMappingRow>) {
    updateMapping({
      ...mapping,
      rows: mapping.rows.map((row, position) => (position === index ? { ...row, ...change } : row)),
    });
  }
  function saveScript(script: string) {
    lastScript.current = script;
    const value = readFieldMapping(script);
    setMapping(value || emptyMapping());
    setScriptMode(!!script.trim() && !value);
    setMappingError('');
    validityCallback.current?.(true);
    onScriptChange(script);
    setEditingScript(false);
  }

  return (
    <div className="form-section transformation-editor">
      <div className="section-intro">
        <h3>Transformation</h3>
        <p>Map incoming fields to the fields required by the destination.</p>
      </div>
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
            {inboundFormat === DataType.TEXT && (
              <p className="muted">
                This mapping needs structured input. Use an advanced script to parse plain text.
              </p>
            )}
            {!mapping.rows.length && (
              <p className="muted">Add a mapping to select or rename incoming fields.</p>
            )}
            <div className="mapping-rows">
              {mapping.rows.map((row, index) => (
                <div className="mapping-row" key={index}>
                  <label className="field">
                    <span>Source Field</span>
                    <input
                      aria-label={`Source Field ${index + 1}`}
                      value={row.source}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={inboundFormat === DataType.HL7V2 ? 'PID.3' : 'patient_id'}
                      onChange={(event) => updateRow(index, { source: event.target.value })}
                      aria-invalid={!!mappingError}
                    />
                  </label>
                  <label className="field">
                    <span>Target Field</span>
                    <input
                      aria-label={`Target Field ${index + 1}`}
                      value={row.target}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="PatientID"
                      onChange={(event) => updateRow(index, { target: event.target.value })}
                      aria-invalid={!!mappingError}
                    />
                  </label>
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
                  <details className="mapping-options" aria-label={`Mapping options ${index + 1}`}>
                    <summary>
                      Mapping options
                      {(row.required || row.defaultValue !== undefined) && (
                        <small> · Configured</small>
                      )}
                    </summary>
                    <div className="mapping-option-fields">
                      <label className="check-field mapping-required">
                        <input
                          type="checkbox"
                          checked={row.required}
                          onChange={(event) => updateRow(index, { required: event.target.checked })}
                        />
                        Required field {index + 1}
                      </label>
                      <label className="field">
                        <span>Default value {index + 1}</span>
                        <input
                          value={row.defaultValue ?? ''}
                          placeholder="Optional"
                          onChange={(event) =>
                            updateRow(index, { defaultValue: event.target.value || undefined })
                          }
                        />
                      </label>
                    </div>
                  </details>
                </div>
              ))}
            </div>
            {mappingError && (
              <p className="alert error" role="alert">
                {mappingError}
              </p>
            )}
            <Button
              type="button"
              variant="secondary"
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
      <details className="advanced-section">
        <summary>
          Advanced Custom Transformation Script
          {scriptMode && <small> · Configured</small>}
        </summary>
        {!!mapping.rows.length && !scriptMode && (
          <p className="muted">
            Editing the generated script can switch this transformation to script mode.
          </p>
        )}
        <div className="heading-actions">
          <Button type="button" variant="secondary" onClick={() => setEditingScript(true)}>
            <Code2 size={15} /> Edit Script
          </Button>
          {scriptMode && supportsMapping && (
            <Button type="button" variant="secondary" onClick={() => setConfirmReplacement(true)}>
              Switch to field mapping
            </Button>
          )}
        </div>
      </details>
      <ScriptEditorModal
        isOpen={editingScript}
        onClose={() => setEditingScript(false)}
        onSave={saveScript}
        initialScript={processingScript}
        title="Custom Transformation Script"
        scriptType="transformer"
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
}
