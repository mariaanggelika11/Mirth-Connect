import { DestinationEditor } from './DestinationEditor';
import type { ChannelScriptEditor, MessageValidation } from './channelDraft';
import {
  newDestination,
  initialDraft,
  validationChoice,
  selectedValidationProfile,
} from './channelDraft';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Code2, Plus, KeyRound } from 'lucide-react';
import { api } from '../../services/api';
import { rotateSourceCredential } from '../../services/channel.api';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { ScriptEditorModal } from '../../components/status/ScriptEditorModal';
import type { Channel, ChannelFormData, Destination } from '../../types';
import { DataType } from '../../types';
import { FlowLabel } from '../../components/ui/OperationalUI';
import { SourceEndpoint } from './SourceEndpoint';
import { DryRunPreview, type DryRunResult } from './DryRunPreview';
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
      setSample(syntheticSample(value.source.inboundDataType));
    } else {
      setKey('');
      setTestResult(null);
    }
  }, [isOpen, initialData, seedData]);
  useEffect(() => setTestResult(null), [draft, profileText, sample, rawPreview]);
  const dirty = JSON.stringify(draft) !== baseline || profileText !== profileBaseline;
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
    if (initialData && !draft.changeSummary?.trim()) {
      setError('Describe the configuration change before saving.');
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
        changeSummary: draft.changeSummary?.trim() || 'Initial channel configuration',
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
      const { data } = await api.post<DryRunResult>('/channel/dry-run', {
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
  const steps = ['Source', 'Processing', 'Destinations', 'Review'];
  return (
    <>
      <Modal isOpen={isOpen} onClose={close} title={initialData ? 'Edit channel' : 'New channel'}>
        <form onSubmit={save} className="channel-editor">
          <div className="editor-steps" aria-label="Channel setup steps">
            {steps.map((label, i) => (
              <button
                key={label}
                type="button"
                className={step === i ? 'active' : step > i ? 'complete' : ''}
                onClick={() => {
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
                  <h3>Where do messages come from?</h3>
                  <p>Name your connection and choose how it receives messages.</p>
                </div>
                <label className="field">
                  <span>
                    Channel name <span className="required">*</span>
                  </span>
                  <input
                    autoComplete="off"
                    value={draft.name}
                    maxLength={150}
                    placeholder="e.g. HIS → Laboratory results"
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span>Source connector</span>
                    <select
                      value={draft.source.type}
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
                      {dataOptions.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {draft.source.type === 'HTTP' && (
                  <div className="credential-panel">
                    <KeyRound size={19} />
                    <div>
                      <strong>Source API key</strong>
                      <p>
                        {initialData
                          ? 'API key digunakan oleh sistem sumber saat mengirim data ke channel.'
                          : 'Save this channel to create the API key used by the source system when sending messages.'}
                      </p>
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
                          <p>
                            Closing the editor hides this key. Store it securely in the source
                            system.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {initialData?.source.endpoint && <SourceEndpoint channel={initialData} />}
                <details className="advanced-section">
                  <summary>Advanced source settings</summary>
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
                    <small>
                      Basic JSON validation requires a JSON object. Built-in format checks still
                      apply without an additional profile.
                    </small>
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
                        <small>
                          Gunakan hanya jika sistem sumber memiliki schema khusus. Supported keys:
                          jsonSchema, xml, hl7, script.
                        </small>
                        <textarea
                          rows={6}
                          className="code-input"
                          spellCheck={false}
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
                              /* Validate before save or preview. */
                            }
                          }}
                        />
                      </label>
                    )}
                  </fieldset>
                  <label className="field">
                    <span>Duplicate message protection</span>
                    <select
                      value={draft.idempotencyMode || 'OPTIONAL'}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          idempotencyMode: e.target.value as ChannelFormData['idempotencyMode'],
                        }))
                      }
                    >
                      <option value="DISABLED">Disabled</option>
                      <option value="OPTIONAL">Optional</option>
                      <option value="REQUIRED">Required</option>
                    </select>
                    <small>
                      Membantu mencegah request yang sama diproses lebih dari satu kali. Technical
                      name: Inbound idempotency.
                    </small>
                  </label>
                </details>
              </div>
            )}
            {step === 1 && (
              <div className="form-section">
                <div className="section-intro">
                  <h3>Prepare messages for delivery</h3>
                  <p>
                    Keep the original message, or configure processing before it reaches
                    destinations.
                  </p>
                </div>
                <div className="script-setting">
                  <div>
                    <strong>Message transformation</strong>
                    <p>
                      {draft.processingScript
                        ? 'Custom transformation enabled'
                        : 'No source transformation · Pass-through'}
                    </p>
                    <small>
                      Gunakan hanya jika pesan perlu diubah sebelum masuk ke destination.
                    </small>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setEditor({ field: 'processingScript', title: 'Source transformation' })
                    }
                  >
                    <Code2 size={15} />
                    {draft.processingScript
                      ? 'Edit source transformation'
                      : 'Add source transformer'}
                  </Button>
                </div>
                {draft.processingScript && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setDraft((d) => ({ ...d, processingScript: '' }))}
                  >
                    Use pass-through
                  </Button>
                )}
                <details className="advanced-section">
                  <summary>Advanced processing</summary>
                  <section className="destination-settings-group" aria-label="Message filtering">
                    <h4>Message filtering</h4>
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
                    <p className="muted">
                      {filterEnabled
                        ? 'Gunakan filter jika hanya pesan tertentu yang boleh dilanjutkan.'
                        : 'All messages are accepted.'}
                    </p>
                    {filterEnabled && (
                      <details className="advanced-section" open>
                        <summary>Edit filter script</summary>
                        <label className="field">
                          <span>Source filter script</span>
                          <small>
                            Return true = pesan diterima. Return false = pesan difilter. An empty
                            filter accepts all messages.
                          </small>
                          <textarea
                            rows={5}
                            className="code-input"
                            spellCheck={false}
                            placeholder="return Boolean(msg && msg.patient_id && msg.name);"
                            value={draft.filterScript || ''}
                            onChange={(e) => {
                              setDraft((d) => ({ ...d, filterScript: e.target.value }));
                              setRetainedFilter(e.target.value);
                            }}
                          />
                        </label>
                      </details>
                    )}
                  </section>
                  <div className="script-setting">
                    <div>
                      <strong>Response to the source</strong>
                      <p>
                        {draft.responseScript
                          ? 'Custom source response enabled.'
                          : 'Use default response.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setEditor({ field: 'responseScript', title: 'Source response' })
                      }
                    >
                      {draft.responseScript ? 'Edit custom response' : 'Configure custom response'}
                    </Button>
                  </div>
                  {draft.responseScript && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setDraft((d) => ({ ...d, responseScript: '' }))}
                    >
                      Use default response
                    </Button>
                  )}
                </details>
              </div>
            )}
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
                    setDraft((d) => ({ ...d, destinations: [...d.destinations, newDestination()] }))
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
                  <p>Confirm the configuration before saving.</p>
                </div>
                <div className="review-connection">
                  <h3>{draft.name || 'Unnamed channel'}</h3>
                  <FlowLabel
                    source={`${draft.source.type} ${draft.source.inboundDataType}`}
                    destinations={draft.destinations.map(
                      (d) => `${d.type} ${d.outboundDataType} → ${d.name || 'Unnamed destination'}`,
                    )}
                  />
                </div>
                <dl className="definition-list">
                  <div>
                    <dt>Receives</dt>
                    <dd>
                      {draft.source.inboundDataType} over {draft.source.type}
                    </dd>
                  </div>
                  <div>
                    <dt>Message validation</dt>
                    <dd>
                      {validation === 'NONE'
                        ? 'None'
                        : validation === 'BASIC_JSON'
                          ? 'Basic JSON object validation'
                          : 'Custom validation schema'}
                    </dd>
                  </div>
                  <div>
                    <dt>Duplicate protection</dt>
                    <dd>{(draft.idempotencyMode || 'OPTIONAL').toLowerCase()}</dd>
                  </div>
                  <div>
                    <dt>Source transformation</dt>
                    <dd>
                      {draft.processingScript
                        ? 'Custom transformation enabled'
                        : 'None · Pass-through'}
                    </dd>
                  </div>
                  <div>
                    <dt>Source filter</dt>
                    <dd>{draft.filterScript ? 'Enabled' : 'None · All messages accepted'}</dd>
                  </div>
                </dl>
                {draft.destinations.map((d, i) => (
                  <div key={i} className="review-destination">
                    <span className="step-number">{i + 1}</span>
                    <div>
                      <strong>{d.name || 'Unnamed destination'}</strong>
                      <small className="break-anywhere">{d.endpoint || 'Endpoint required'}</small>
                      <small>
                        Sends: {d.outboundDataType} over {d.type} ·{' '}
                        {d.isEnabled === false ? 'Disabled' : 'Enabled'}
                      </small>
                      <small>
                        Retry:{' '}
                        {d.retryEnabled
                          ? `${d.maxRetries ?? 3} attempts, initial delay ${d.retryIntervalSeconds ?? 30} seconds`
                          : 'Off'}{' '}
                        · Timeout: {(d.timeoutMs ?? 10000) / 1000} seconds
                      </small>
                    </div>
                  </div>
                ))}
                <section className="preview-panel" aria-label="Validate channel">
                  <h4>Validate channel and preview output</h4>
                  <p className="muted">
                    Use synthetic data to follow the message from input to the generated outbound
                    payload. Nothing is sent to the destination.
                  </p>
                  <label className="field">
                    <span>Input message (synthetic only)</span>
                    <textarea rows={4} value={sample} onChange={(e) => setSample(e.target.value)} />
                  </label>
                  {canViewRaw && (
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={rawPreview}
                        onChange={(e) => setRawPreview(e.target.checked)}
                      />
                      View raw synthetic preview (audited)
                    </label>
                  )}
                  <p className="muted">
                    {rawPreview && canViewRaw
                      ? 'Melihat raw payload akan dicatat pada audit log. Use synthetic data only.'
                      : 'Sensitive values are redacted. XML and text previews may be fully masked; raw preview requires explicit permission.'}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={testing}
                    onClick={() => void previewOutput()}
                  >
                    {testing ? 'Generating preview…' : 'Preview output'}
                  </Button>
                  {testResult && <DryRunPreview result={testResult} />}
                </section>
                {initialData ? (
                  <label className="field">
                    <span>Change summary *</span>
                    <input
                      required
                      maxLength={500}
                      value={draft.changeSummary || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, changeSummary: e.target.value }))}
                    />
                    <small>
                      Briefly describe what changed for reviewers and the revision history.
                    </small>
                  </label>
                ) : (
                  <p className="muted">
                    Revision note: Initial channel configuration (added automatically).
                  </p>
                )}
                <p className="muted">
                  {initialData
                    ? 'Changes are saved as a draft. Open Revisions to review and publish them.'
                    : 'New channels are saved as Stopped. Start the channel when its destination is ready.'}
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
                <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>
                  <ArrowLeft size={14} />
                  Back
                </Button>
              )}
              {step < 3 ? (
                <Button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    next();
                  }}
                >
                  Continue
                  <ArrowRight size={14} />
                </Button>
              ) : (
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Channel'}
                </Button>
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
