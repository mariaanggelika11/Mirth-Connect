import { DestinationEditor } from './DestinationEditor';
import type { ChannelScriptEditor, MessageValidation } from './channelDraft';
import {
  newDestination,
  initialDraft,
  validationChoice,
  selectedValidationProfile,
} from './channelDraft';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Code2, Plus } from 'lucide-react';
import { api } from '../../services/api';
import { rotateSourceCredential } from '../../services/channel.api';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { ScriptEditorModal } from '../../components/status/ScriptEditorModal';
import type { Channel, ChannelFormData, Destination } from '../../types';
import { DataType } from '../../types';
import { TransformationEditor } from './TransformationEditor';
import { FilterEditor } from './FilterEditor';
import { readFieldMapping } from '../../../../server/src/utils/fieldMapping';
import { SourceEndpoint } from './SourceEndpoint';
import type { DryRunResult } from './DryRunPreview';
import { useAuth } from '../../contexts/AuthContext';
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ChannelFormData) => Promise<void> | void;
  initialData?: Channel | null;
  seedData?: ChannelFormData | null;
}
const dataOptions = Object.values(DataType);
function syntheticSample(format?: DataType) {
  if (format === DataType.XML) return '<Message><text>Synthetic preview</text></Message>';
  if (format === DataType.HL7V2)
    return 'MSH|^~\\&|SYNTHETIC|TEST|RECEIVER|TEST|20261016090000||ADT^A01|SYNTHETIC-001|P|2.5\rPID|1||SYNTHETIC-001^^^TEST^MR||EXAMPLE^SYNTHETIC';
  if (format === DataType.TEXT) return 'Synthetic preview message';
  return '{"message":"Synthetic preview"}';
}
function CopySourceKey({ value }: { value: string }) {
  const [feedback, setFeedback] = useState('');
  useEffect(() => setFeedback(''), [value]);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setFeedback('API key copied.');
          } catch {
            setFeedback('Copy failed. Select the key above and copy it manually.');
          }
        }}
      >
        Copy API key
      </Button>
      {feedback && <p role="status">{feedback}</p>}
    </>
  );
}
export default function ChannelForm({ isOpen, onClose, onSubmit, initialData, seedData }: Props) {
  const { can } = useAuth();
  const canViewRaw = can('message:raw');
  const [transformationValid, setTransformationValid] = useState(true);
  const [sourceConfiguration, setSourceConfiguration] = useState<{
    baseUrl: string;
    path: string;
  } | null>(null);
  const [draft, setDraft] = useState<ChannelFormData>(() => initialDraft(initialData));
  const [baseline, setBaseline] = useState(''),
    [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [discard, setDiscard] = useState(false),
    [key, setKey] = useState(''),
    [rotating, setRotating] = useState(false),
    [confirmKey, setConfirmKey] = useState(false),
    [sample, setSample] = useState('{"message":"Synthetic preview"}'),
    [testResult, setTestResult] = useState<DryRunResult | null>(null),
    [testing, setTesting] = useState(false),
    [profileText, setProfileText] = useState('{}'),
    [profileBaseline, setProfileBaseline] = useState('{}'),
    [validation, setValidation] = useState<MessageValidation>('NONE'),
    [filterEnabled, setFilterEnabled] = useState(false),
    [retainedFilter, setRetainedFilter] = useState(''),
    [rawPreview, setRawPreview] = useState(false);
  const [editor, setEditor] = useState<ChannelScriptEditor | null>(null);
  const previewContext = JSON.stringify({
    isOpen,
    draft,
    profileText,
    sample,
    rawPreview,
    canViewRaw,
  });
  const currentPreviewContext = useRef(previewContext);
  currentPreviewContext.current = previewContext;
  useEffect(() => {
    if (isOpen) {
      const value = seedData || initialDraft(initialData);
      setDraft(value);
      setProfileText(JSON.stringify(value.validationProfile || {}, null, 2));
      setProfileBaseline(JSON.stringify(value.validationProfile || {}, null, 2));
      setValidation(validationChoice(value.validationProfile));
      setFilterEnabled(!!value.filterScript?.trim());
      setRetainedFilter(value.filterScript || '');
      setBaseline(JSON.stringify(value));
      setStep(0);
      setError('');
      setKey('');
      setDiscard(false);
      setEditor(null);
      setTestResult(null);
      setRawPreview(false);
      setTransformationValid(true);
      setSample(syntheticSample(value.source.inboundDataType));
    } else {
      setKey('');
      setTestResult(null);
    }
  }, [isOpen, initialData, seedData]);
  useEffect(() => {
    if (!isOpen || initialData) return;
    let active = true;
    setSourceConfiguration(null);
    void api
      .get('/channel/source-configuration')
      .then(({ data }) => {
        if (active && typeof data.baseUrl === 'string' && typeof data.path === 'string')
          setSourceConfiguration(data);
      })
      .catch(() => {
        /* The assigned endpoint remains available after Save. */
      });
    return () => {
      active = false;
    };
  }, [isOpen, initialData]);
  useEffect(() => setTestResult(null), [draft, profileText, sample, rawPreview]);
  useEffect(() => {
    if (!canViewRaw) {
      setRawPreview(false);
      setTestResult(null);
    }
  }, [canViewRaw]);
  useEffect(() => setKey(''), [step, draft.source.type]);
  const dirty =
    JSON.stringify(draft) !== baseline || profileText !== profileBaseline || !transformationValid;
  const closeAndClear = () => {
    setKey('');
    setTestResult(null);
    onClose();
  };
  const close = () => {
    if (saving || rotating) return;
    setKey('');
    if (dirty) setDiscard(true);
    else closeAndClear();
  };
  useEffect(() => {
    if (!isOpen || !dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [isOpen, dirty]);
  function changeDestination(index: number, values: Partial<Destination>) {
    setDraft((d) => ({
      ...d,
      destinations: d.destinations.map((v, i) => (i === index ? { ...v, ...values } : v)),
    }));
  }
  function next() {
    setError('');
    if (!draft.name.trim()) {
      setStep(0);
      setError('Give this channel a name before continuing.');
      return;
    }
    if (step === 1 && !transformationValid) {
      setError('Complete or remove the unfinished field mapping.');
      return;
    }
    if (step === 2 && draft.destinations.some((d) => !d.name.trim() || !d.endpoint.trim())) {
      setError('Each destination needs a name and endpoint.');
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (step < 3) {
      next();
      return;
    }
    if (!draft.name.trim()) {
      setStep(0);
      setError('Channel name is required.');
      return;
    }
    if (draft.destinations.some((d) => !d.name.trim() || !d.endpoint.trim())) {
      setStep(2);
      setError('Each destination needs a name and endpoint.');
      return;
    }
    if (!transformationValid) {
      setStep(1);
      setError('Complete or remove the unfinished field mapping.');
      return;
    }
    let validationProfile: Record<string, unknown>;
    try {
      validationProfile = selectedValidationProfile(validation, profileText);
    } catch {
      setError(
        'Enter a valid JSON object for the custom validation profile in Advanced source settings.',
      );
      setStep(0);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        ...draft,
        validationProfile,
        changeSummary:
          draft.changeSummary?.trim() ||
          (initialData ? 'Channel configuration updated' : 'Initial channel configuration'),
      });
      closeAndClear();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save channel');
    } finally {
      setSaving(false);
    }
  }
  function chooseValidation(choice: MessageValidation) {
    setValidation(choice);
    try {
      setDraft((d) => ({
        ...d,
        validationProfile: selectedValidationProfile(choice, profileText),
      }));
    } catch {
      // Keep invalid custom text visible until the user corrects it.
    }
  }
  async function previewOutput() {
    const context = previewContext;
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const payload = draft.source.inboundDataType === 'JSON' ? JSON.parse(sample) : sample;
      const validationProfile = selectedValidationProfile(validation, profileText);
      const { data } = await api.post<DryRunResult>('/channel/preview-transformation', {
        configuration: { ...draft, validationProfile },
        payload,
        raw: rawPreview && canViewRaw,
      });
      if (currentPreviewContext.current === context) setTestResult(data);
    } catch (error) {
      if (currentPreviewContext.current === context)
        setError(error instanceof Error ? error.message : 'Unable to preview this message.');
    } finally {
      setTesting(false);
    }
  }
  async function rotate() {
    if (!initialData) return;
    setRotating(true);
    setKey('');
    try {
      setKey(await rotateSourceCredential(initialData.id));
      setConfirmKey(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to rotate key');
      throw e;
    } finally {
      setRotating(false);
    }
  }
  const steps = ['Source', 'Transformation', 'Destinations', 'Review'];
  const fieldMapping = readFieldMapping(draft.processingScript || '');
  const customSource = Boolean(
    (!fieldMapping && draft.processingScript?.trim()) ||
    draft.filterScript?.trim() ||
    draft.responseScript?.trim() ||
    validation !== 'NONE' ||
    (draft.idempotencyMode && draft.idempotencyMode !== 'OPTIONAL'),
  );
  return (
    <>
      <Modal isOpen={isOpen} onClose={close} title={initialData ? 'Edit channel' : 'New channel'}>
        <form onSubmit={save} className="channel-editor">
          <div className="editor-steps" aria-label="Channel setup steps">
            {steps.map((label, i) => (
              <button
                key={label}
                type="button"
                disabled={saving || rotating}
                className={step === i ? 'active' : step > i ? 'complete' : ''}
                onClick={() => {
                  if (i > 1 && !transformationValid) {
                    setStep(1);
                    setError('Complete or remove the unfinished field mapping.');
                    return;
                  }
                  setStep(i);
                  setError('');
                }}
                aria-current={step === i ? 'step' : undefined}
              >
                <span>{step > i ? <Check size={13} /> : i + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <div className="editor-body">
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {seedData && (
              <p className="alert">
                Copy created from an existing channel. Review endpoints and re-enter any destination
                credentials before saving.
              </p>
            )}
            {step === 0 && (
              <div className="form-section">
                <div className="section-intro">
                  <h3>Connect the sending system</h3>
                </div>
                <label className="field">
                  <span>
                    Channel name <span className="required">*</span>
                  </span>
                  <input
                    autoComplete="off"
                    value={draft.name}
                    maxLength={150}
                    placeholder="e.g. JSON_TO_XML_PATIENT"
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span>Source connector</span>
                    <select
                      value={draft.source.type}
                      disabled={saving || rotating}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, source: { ...d.source, type: e.target.value } }))
                      }
                    >
                      <option value="HTTP">HTTP receiver</option>
                      <option value="HL7">HL7 / MLLP listener</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Inbound format</span>
                    <select
                      value={draft.source.inboundDataType}
                      onChange={(e) => {
                        setDraft((d) => ({
                          ...d,
                          source: { ...d.source, inboundDataType: e.target.value as DataType },
                        }));
                        setSample(syntheticSample(e.target.value as DataType));
                        if (validation === 'BASIC_JSON' && e.target.value !== DataType.JSON)
                          chooseValidation('NONE');
                      }}
                    >
                      {dataOptions.map((format) => (
                        <option key={format}>{format}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {draft.source.type === 'HTTP' && (
                  <>
                    {initialData?.source.type === 'HTTP' ? (
                      <SourceEndpoint channel={initialData} />
                    ) : (
                      <div className="field">
                        <span>Source endpoint</span>
                        <code className="code-box break-anywhere">
                          {sourceConfiguration
                            ? `${sourceConfiguration.baseUrl}${sourceConfiguration.path}/{channelId}`
                            : 'Assigned after Save'}
                        </code>
                        <small>A channel ID is assigned when you save.</small>
                      </div>
                    )}
                    <section className="source-authentication" aria-label="Source authentication">
                      <div>
                        <strong>Source API key</strong>
                        <p className="muted">
                          {!initialData
                            ? 'Create the source access key after saving.'
                            : initialData.apiKeyConfigured === true
                              ? 'API key configured'
                              : initialData.apiKeyConfigured === false
                                ? 'No API key configured'
                                : 'Create or rotate the key used by the sending system.'}
                        </p>
                      </div>
                      {initialData && (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={rotating}
                          onClick={() => setConfirmKey(true)}
                        >
                          Create / rotate source API key
                        </Button>
                      )}
                      {key && (
                        <div className="alert success break-anywhere">
                          <strong>Copy this key now. It is shown only once.</strong>
                          <code>{key}</code>
                          <CopySourceKey value={key} />
                        </div>
                      )}
                    </section>
                  </>
                )}
                {draft.source.type === 'HL7' && (
                  <div className="field">
                    <span>Source endpoint</span>
                    <code>
                      {initialData?.source.type === 'HL7'
                        ? initialData.source.endpoint
                        : 'Uses the configured MLLP listener'}
                    </code>
                    <small>Access is controlled by the listener network and TLS settings.</small>
                  </div>
                )}
                <details className="advanced-section">
                  <summary>
                    <span>Advanced source settings</span>
                    {customSource && <span className="configured-hint">Configured</span>}
                  </summary>
                  <section className="form-section">
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={filterEnabled}
                        onChange={(e) => {
                          setFilterEnabled(e.target.checked);
                          if (!e.target.checked) setRetainedFilter(draft.filterScript || '');
                          setDraft((d) => ({
                            ...d,
                            filterScript: e.target.checked ? retainedFilter : '',
                          }));
                        }}
                      />
                      Enable source filter
                    </label>
                    {filterEnabled ? (
                      <FilterEditor
                        kind="source"
                        value={draft.filterScript || ''}
                        onChange={(script) => {
                          setRetainedFilter(script);
                          setDraft((d) => ({ ...d, filterScript: script }));
                        }}
                      />
                    ) : (
                      <p className="muted">All messages are accepted.</p>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setEditor({
                          field: 'processingScript',
                          title: 'Advanced source transformer',
                        })
                      }
                    >
                      <Code2 size={14} />
                      Advanced source transformer
                    </Button>
                    {draft.responseScript?.trim() && (
                      <small>Existing source response script is retained.</small>
                    )}
                    <details className="advanced-section">
                      <summary>
                        Advanced validation
                        {validation !== 'NONE' && (
                          <span className="configured-hint">Configured</span>
                        )}
                      </summary>
                      <fieldset className="validation-options">
                        <legend>Message validation</legend>
                        <label className="check-field">
                          <input
                            type="radio"
                            name="message-validation"
                            checked={validation === 'NONE'}
                            onChange={() => chooseValidation('NONE')}
                          />
                          No additional validation
                        </label>
                        <label className="check-field">
                          <input
                            type="radio"
                            name="message-validation"
                            checked={validation === 'BASIC_JSON'}
                            disabled={draft.source.inboundDataType !== DataType.JSON}
                            onChange={() => chooseValidation('BASIC_JSON')}
                          />
                          Basic JSON validation
                        </label>
                        <label className="check-field">
                          <input
                            type="radio"
                            name="message-validation"
                            checked={validation === 'CUSTOM'}
                            onChange={() => chooseValidation('CUSTOM')}
                          />
                          Custom validation schema
                        </label>
                        {validation === 'CUSTOM' && (
                          <label className="field">
                            <span>Custom validation profile (JSON)</span>
                            <textarea
                              rows={5}
                              className="code-input"
                              value={profileText}
                              onChange={(e) => {
                                setProfileText(e.target.value);
                                try {
                                  setDraft((d) => ({
                                    ...d,
                                    validationProfile: selectedValidationProfile(
                                      'CUSTOM',
                                      e.target.value,
                                    ),
                                  }));
                                } catch {
                                  /* Validate on Test or Save. */
                                }
                              }}
                            />
                          </label>
                        )}
                      </fieldset>
                    </details>
                  </section>
                </details>
              </div>
            )}
            <div style={{ display: step === 1 ? 'block' : 'none' }} aria-hidden={step !== 1}>
              <TransformationEditor
                inboundFormat={draft.source.inboundDataType || DataType.JSON}
                destinations={draft.destinations}
                processingScript={draft.processingScript || ''}
                onScriptChange={(script) => setDraft((d) => ({ ...d, processingScript: script }))}
                onOutputFormatChange={(format) =>
                  setDraft((d) => ({
                    ...d,
                    destinations: d.destinations.map((destination) => ({
                      ...destination,
                      outboundDataType: format,
                    })),
                  }))
                }
                onPreview={() => void previewOutput()}
                sample={sample}
                onSampleChange={setSample}
                result={testResult}
                testing={testing}
                rawPreview={rawPreview}
                onRawPreviewChange={setRawPreview}
                canViewRaw={canViewRaw}
                onValidityChange={(valid) => {
                  setTransformationValid(valid);
                  if (!valid) setTestResult(null);
                }}
              />
            </div>
            {step === 2 && (
              <div className="form-section">
                <div className="section-intro">
                  <h3>Where should messages go?</h3>
                  <p>Destinations run in the order shown below.</p>
                </div>
                {draft.destinations.map((dest, index) => (
                  <DestinationEditor
                    key={dest.id ?? index}
                    dest={dest}
                    index={index}
                    inboundFormat={draft.source.inboundDataType}
                    onChange={(values) => changeDestination(index, values)}
                    onRemove={() =>
                      setDraft((d) => ({
                        ...d,
                        destinations: d.destinations.filter((_, i) => i !== index),
                      }))
                    }
                    onEditScript={setEditor}
                  />
                ))}
                {!draft.destinations.length && (
                  <p className="muted">
                    This channel will receive messages without outbound delivery. Add a destination
                    when ready.
                  </p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      destinations: [
                        ...d.destinations,
                        {
                          ...newDestination(),
                          outboundDataType:
                            d.destinations[0]?.outboundDataType ||
                            d.source.inboundDataType ||
                            DataType.JSON,
                        },
                      ],
                    }))
                  }
                >
                  <Plus size={16} />
                  Add Destination
                </Button>
              </div>
            )}
            {step === 3 && (
              <div className="form-section">
                <div className="section-intro">
                  <h3>Review your connection</h3>
                </div>
                <div className="integration-flow" aria-label="Integration flow">
                  <div>
                    <strong>
                      {draft.source.type} / {draft.source.inboundDataType}
                    </strong>
                  </div>
                  <span aria-hidden="true">↓</span>
                  <div>
                    <strong>{draft.name || 'Unnamed channel'}</strong>
                  </div>
                  <span aria-hidden="true">↓</span>
                  <div>
                    <strong>
                      {draft.source.inboundDataType} →{' '}
                      {draft.destinations
                        .map((d) => d.outboundDataType)
                        .filter((format, index, values) => values.indexOf(format) === index)
                        .join(' / ') || 'No outbound delivery'}
                    </strong>
                    <small>
                      {fieldMapping
                        ? `${fieldMapping.rows.length} mapped fields`
                        : draft.processingScript?.trim()
                          ? 'Advanced transformation'
                          : 'Format conversion'}
                    </small>
                  </div>
                  {draft.destinations.map((destination, index) => (
                    <div className="integration-flow-destination" key={destination.id ?? index}>
                      <span aria-hidden="true">↓</span>
                      <strong>
                        {destination.type} / {destination.outboundDataType}
                      </strong>
                      <span aria-hidden="true">↓</span>
                      <strong>{destination.name || 'Unnamed destination'}</strong>
                    </div>
                  ))}
                </div>
                <dl className="definition-list">
                  <div>
                    <dt>Source</dt>
                    <dd>
                      {draft.source.type} / {draft.source.inboundDataType}
                    </dd>
                  </div>
                  <div>
                    <dt>Transformation</dt>
                    <dd>
                      {fieldMapping
                        ? `${fieldMapping.rows.length} field mappings`
                        : draft.processingScript?.trim()
                          ? 'Advanced script'
                          : 'Original fields with output format conversion'}
                    </dd>
                  </div>
                </dl>
                {draft.destinations.map((destination, index) => (
                  <section className="review-destination" key={destination.id ?? index}>
                    <div>
                      <strong>Destination: {destination.name || 'Unnamed destination'}</strong>
                      <small className="break-anywhere">{destination.endpoint}</small>
                      <dl className="definition-list">
                        <div>
                          <dt>Retry</dt>
                          <dd>
                            {destination.retryEnabled
                              ? `${destination.maxRetries ?? 3} retries`
                              : 'Off'}
                          </dd>
                        </div>
                        <div>
                          <dt>Timeout</dt>
                          <dd>{(destination.timeoutMs ?? 10000) / 1000} seconds</dd>
                        </div>
                      </dl>
                      {destination.isEnabled === false && <small>Destination disabled</small>}
                    </div>
                  </section>
                ))}
                <p className="muted">
                  {initialData
                    ? 'Changes are saved as a draft. Review and publish the draft to activate it.'
                    : 'Save creates a stopped channel. Start it when ready.'}
                </p>
              </div>
            )}
          </div>
          <div className="editor-footer">
            <span className={dirty ? 'unsaved-indicator' : 'muted'}>
              {dirty ? '● Unsaved changes' : 'No unsaved changes'}
            </span>
            <div className="heading-actions">
              <Button type="button" variant="secondary" onClick={close} disabled={saving}>
                Cancel
              </Button>
              {step > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving || rotating}
                  onClick={() => setStep((s) => s - 1)}
                >
                  <ArrowLeft size={14} />
                  Back
                </Button>
              )}
              {step < 3 ? (
                <Button
                  type="button"
                  disabled={saving || rotating}
                  onClick={(event) => {
                    event.preventDefault();
                    next();
                  }}
                >
                  Continue
                  <ArrowRight size={14} />
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving || testing || !transformationValid}
                    onClick={() => {
                      setStep(1);
                      void previewOutput();
                    }}
                  >
                    Test
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save Channel'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </form>
      </Modal>
      <ConfirmationModal
        isOpen={discard}
        onClose={() => setDiscard(false)}
        onConfirm={() => {
          setDiscard(false);
          closeAndClear();
        }}
        confirmLabel="Discard changes"
        title="Discard unsaved changes?"
        message="Your channel changes have not been saved. Leave the editor and discard them?"
      />
      <ConfirmationModal
        isOpen={confirmKey}
        onClose={() => setConfirmKey(false)}
        onConfirm={rotate}
        confirmLabel={rotating ? 'Updating…' : 'Confirm key rotation'}
        title="Create or rotate source key?"
        message="The old key stops working immediately. Update every source system using it. The new key appears only once; copy and store it securely before closing this editor."
      />
      {editor && (
        <ScriptEditorModal
          isOpen
          onClose={() => setEditor(null)}
          title={editor.title}
          scriptType={
            editor.field === 'processingScript'
              ? 'transformer'
              : editor.field === 'responseScript'
                ? 'response'
                : 'template'
          }
          initialScript={
            editor.destination === undefined
              ? String(draft[editor.field as 'processingScript' | 'responseScript'] || '')
              : draft.destinations[editor.destination][editor.field] || ''
          }
          onSave={(script) => {
            if (editor.destination === undefined)
              setDraft((d) => ({ ...d, [editor.field]: script }));
            else changeDestination(editor.destination, { [editor.field]: script });
            setEditor(null);
          }}
        />
      )}
    </>
  );
}
