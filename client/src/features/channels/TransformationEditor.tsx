import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Code2, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { ScriptEditorModal } from '../../components/status/ScriptEditorModal';
import { DataType, type Destination } from '../../types';
import { DryRunPreview, previewStageLabels, type DryRunResult } from './DryRunPreview';
import {
  compileFieldMapping,
  readFieldMapping,
  type FieldMappingConfig,
  type FieldMappingRow,
} from '../../../../server/src/utils/fieldMapping';

interface Props {
  inboundFormat: DataType;
  destinations: Destination[];
  processingScript: string;
  onScriptChange: (value: string) => void;
  onOutputFormatChange: (value: DataType) => void;
  onPreview: () => void;
  sample: string;
  onSampleChange: (value: string) => void;
  result: DryRunResult | null;
  testing: boolean;
  rawPreview: boolean;
  onRawPreviewChange: (value: boolean) => void;
  canViewRaw: boolean;
  onValidityChange?: (valid: boolean) => void;
}

const emptyMapping = (): FieldMappingConfig => ({ version: 1, rows: [] });
const patientRows: FieldMappingRow[] = [
  { source: 'patient_id', target: 'PatientID', required: true },
  { source: 'name', target: 'PatientName', required: true },
  { source: 'gender', target: 'Gender', required: false },
  { source: 'date_of_birth', target: 'BirthDate', required: false },
];
function textPayload(payload: unknown) {
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

export function TransformationEditor({
  inboundFormat,
  destinations,
  processingScript,
  onScriptChange,
  onOutputFormatChange,
  onPreview,
  sample,
  onSampleChange,
  result: suppliedResult,
  testing,
  rawPreview,
  onRawPreviewChange,
  canViewRaw,
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

  const formats = [...new Set(destinations.map((destination) => destination.outboundDataType))];
  const outputFormat = formats.length === 1 ? formats[0] || inboundFormat : '';
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
  const result = mappingError || (rawPreview && !canViewRaw) ? null : suppliedResult;
  const previewOutputs = result?.results.filter((destination) => destination.routed !== false);

  return (
    <div className="form-section transformation-editor">
      <div className="section-intro">
        <h3>How should the message change?</h3>
        <p>Choose the output format and match the fields your receiving system needs.</p>
      </div>
      <div className="form-grid transformation-formats">
        <label className="field">
          <span>Input format</span>
          <input readOnly value={inboundFormat} />
        </label>
        <label className="field">
          <span>Output format</span>
          <select
            value={outputFormat}
            disabled={!destinations.length}
            onChange={(event) => onOutputFormatChange(event.target.value as DataType)}
          >
            {!outputFormat && <option value="">Multiple formats</option>}
            {Object.values(DataType).map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
          {destinations.length > 1 && (
            <small>Applies to all destinations. Customize each in Destinations if needed.</small>
          )}
          {!destinations.length && <small>Add a destination to choose an output format.</small>}
        </label>
      </div>

      <section className="mapping-section" aria-label="Field mapping">
        <div className="section-header">
          <h3>Field mapping</h3>
          {!scriptMode &&
            supportsMapping &&
            !mapping.rows.length &&
            inboundFormat === DataType.JSON && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  updateMapping({
                    version: 1,
                    rows: patientRows,
                    ...(outputFormat === DataType.XML ? { rootElement: 'Patient' } : {}),
                  });
                  onSampleChange(
                    JSON.stringify(
                      {
                        patient_id: 'SYNTHETIC-001',
                        name: 'Example Patient',
                        gender: 'U',
                        date_of_birth: '2000-01-01',
                      },
                      null,
                      2,
                    ),
                  );
                }}
              >
                Use patient example
              </Button>
            )}
        </div>
        {scriptMode ? (
          <div className="alert">
            <p>An advanced transformation is configured. Its script is kept unchanged.</p>
            <div className="heading-actions">
              <Button type="button" variant="secondary" onClick={() => setEditingScript(true)}>
                Edit transformation script
              </Button>
              {supportsMapping && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmReplacement(true)}
                >
                  Switch to field mapping
                </Button>
              )}
            </div>
          </div>
        ) : !supportsMapping ? (
          <p className="muted">
            Text messages use format conversion. Open Advanced transformation script for custom
            parsing.
          </p>
        ) : (
          <>
            {inboundFormat === DataType.TEXT && (
              <p className="muted">
                This mapping needs structured input. Use an advanced script to parse plain text.
              </p>
            )}
            {!mapping.rows.length && (
              <p className="muted">
                Keep the original fields, or add mappings to rename and select them.
              </p>
            )}
            <div className="mapping-rows">
              {mapping.rows.map((row, index) => (
                <div className="mapping-row" key={index}>
                  <label className="field">
                    <span>Input field {index + 1}</span>
                    <input
                      value={row.source}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={inboundFormat === DataType.HL7V2 ? 'PID.3' : 'patient_id'}
                      onChange={(event) => updateRow(index, { source: event.target.value })}
                      aria-invalid={!!mappingError}
                    />
                  </label>
                  <ArrowRight className="mapping-arrow" aria-hidden="true" size={18} />
                  <label className="field">
                    <span>Output field {index + 1}</span>
                    <input
                      value={row.target}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="PatientID"
                      onChange={(event) => updateRow(index, { target: event.target.value })}
                      aria-invalid={!!mappingError}
                    />
                  </label>
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
              <Plus size={16} /> Add mapping
            </Button>
            {!!mapping.rows.length && (outputFormat === DataType.XML || !!mapping.rootElement) && (
              <label className="field mapping-root">
                <span>
                  {outputFormat === DataType.XML ? 'XML root element' : 'Output root element'}
                </span>
                <input
                  value={mapping.rootElement ?? ''}
                  placeholder="e.g. Patient"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    updateMapping({ ...mapping, rootElement: event.target.value || undefined })
                  }
                />
              </label>
            )}
          </>
        )}
      </section>

      <div className="transformation-previews">
        <label className="field preview-stage">
          <span>Preview input · {inboundFormat}</span>
          <textarea
            className="code-input"
            rows={7}
            spellCheck={false}
            value={sample}
            onChange={(event) => onSampleChange(event.target.value)}
          />
          <small>Use synthetic data for testing.</small>
        </label>
        <section className="preview-stage" aria-label="Preview output">
          <div className="section-header">
            <h3>Preview output</h3>
            <Button
              type="button"
              variant="secondary"
              disabled={testing || !!mappingError}
              onClick={onPreview}
            >
              {testing ? 'Testing…' : 'Test transformation'}
            </Button>
          </div>
          {canViewRaw && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={rawPreview}
                onChange={(event) => onRawPreviewChange(event.target.checked)}
              />
              Show unmasked preview (access is audited)
            </label>
          )}
          {!rawPreview && <small>Preview values are hidden by privacy settings.</small>}
          {!result && (
            <p className="muted">Test to see the message your destination will receive.</p>
          )}
          {result && (
            <div role="status">
              <p>
                {result.success ? 'Preview completed' : 'Preview failed'} · {result.elapsedMs} ms.
                No message was sent.
              </p>
              {result.source && (
                <dl className="definition-list" aria-label="Transformation test stages">
                  <div>
                    <dt>Validation</dt>
                    <dd>
                      {previewStageLabels[result.source.validation] || result.source.validation}
                    </dd>
                  </div>
                  <div>
                    <dt>Source filter</dt>
                    <dd>{previewStageLabels[result.source.filter] || result.source.filter}</dd>
                  </div>
                  <div>
                    <dt>Source transformation</dt>
                    <dd>
                      {previewStageLabels[result.source.transformation] ||
                        result.source.transformation}
                    </dd>
                  </div>
                  <div>
                    <dt>Network delivery</dt>
                    <dd>{result.networkDelivery === 'NOT_SENT' ? 'NOT SENT' : 'Not recorded'}</dd>
                  </div>
                </dl>
              )}
              {!result.accepted && (
                <p className={result.success ? 'muted' : 'alert error'}>
                  {result.success
                    ? 'This input was filtered. No outbound message was created.'
                    : 'The input could not be processed. Check the fields and processing details.'}
                </p>
              )}
              {result.accepted && !previewOutputs?.length && (
                <p className="muted">No destination accepted this message.</p>
              )}
              {previewOutputs?.map((destination, index) => (
                <div className="transformation-output" key={destination.destinationId ?? index}>
                  <strong>{destination.name || `Destination ${index + 1}`}</strong>
                  <span className="muted"> · {destination.outputFormat}</span>
                  {destination.status === 'ERROR' ? (
                    <p className="alert error">
                      Output could not be generated: {destination.code || 'DESTINATION_INVALID'}
                    </p>
                  ) : (
                    <pre className="code-box">{textPayload(destination.finalPayload)}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <details className="advanced-section">
        <summary>
          Advanced transformation script
          {scriptMode && <small> · Configured</small>}
        </summary>
        <p className="muted">Use a script for complex transformations and custom parsing.</p>
        {!!mapping.rows.length && !scriptMode && (
          <p className="muted">
            Editing the generated script can switch this transformation to script mode.
          </p>
        )}
        <Button type="button" variant="secondary" onClick={() => setEditingScript(true)}>
          <Code2 size={15} /> Open script editor
        </Button>
        {result && (
          <details className="advanced-section">
            <summary>Processing details</summary>
            <DryRunPreview result={result} />
          </details>
        )}
      </details>
      <ScriptEditorModal
        isOpen={editingScript}
        onClose={() => setEditingScript(false)}
        onSave={saveScript}
        initialScript={processingScript}
        title="Advanced transformation script"
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
