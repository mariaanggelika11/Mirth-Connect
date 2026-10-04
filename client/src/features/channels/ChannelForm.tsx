import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Code2, Plus, Trash2, KeyRound } from 'lucide-react';
import { api } from '../../services/api';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { ScriptEditorModal } from '../../components/status/ScriptEditorModal';
import { Channel, ChannelFormData, Destination, DestinationType, DataType } from '../../types';
import { FlowLabel } from '../../components/ui/OperationalUI';
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ChannelFormData) => Promise<void> | void;
  initialData?: Channel | null;
  seedData?: ChannelFormData | null;
}
const newDestination = (): Destination => ({
  name: '',
  type: DestinationType.REST,
  endpoint: '',
  outboundDataType: DataType.HL7V2,
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
function initialDraft(channel?: Channel | null): ChannelFormData {
  return {
    name: channel?.name || '',
    source: {
      type: channel?.source.type === 'HL7' ? 'HL7' : 'HTTP',
      inboundDataType: channel?.source.inboundDataType || DataType.HL7V2,
    },
    processingScript: channel?.processingScript || '',
    filterScript: channel?.filterScript || '',
    responseScript: channel?.responseScript || '',
    destinations: channel
      ? channel.destinations.map((d) => ({ ...newDestination(), ...d }))
      : [newDestination()],
  };
}
const dataOptions = Object.values(DataType);
export default function ChannelForm({ isOpen, onClose, onSubmit, initialData, seedData }: Props) {
  const [draft, setDraft] = useState<ChannelFormData>(() => initialDraft(initialData));
  const [baseline, setBaseline] = useState(''),
    [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [discard, setDiscard] = useState(false),
    [key, setKey] = useState(''),
    [rotating, setRotating] = useState(false),
    [confirmKey, setConfirmKey] = useState(false);
  const [editor, setEditor] = useState<{
    destination?: number;
    field: 'processingScript' | 'responseScript' | 'templateScript';
    title: string;
  } | null>(null);
  useEffect(() => {
    if (isOpen) {
      const value = seedData || initialDraft(initialData);
      setDraft(value);
      setBaseline(JSON.stringify(value));
      setStep(0);
      setError('');
      setKey('');
      setDiscard(false);
      setEditor(null);
    }
  }, [isOpen, initialData, seedData]);
  const dirty = JSON.stringify(draft) !== baseline;
  const close = () => {
    if (saving || rotating) return;
    if (dirty) setDiscard(true);
    else onClose();
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
    setSaving(true);
    setError('');
    try {
      await onSubmit(draft);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save channel');
    } finally {
      setSaving(false);
    }
  }
  async function rotate() {
    if (!initialData) return;
    setRotating(true);
    try {
      const { data } = await api.put(`/channel/${initialData.id}/credential`);
      setKey(data.data.apiKey);
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
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          source: { ...d.source, inboundDataType: e.target.value as DataType },
                        }))
                      }
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
                          ? 'Create or rotate the key used by external sources.'
                          : 'Save this channel first, then open it to create a source API key.'}
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
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {initialData?.source.endpoint && (
                  <div className="field">
                    <span>Current source endpoint</span>
                    <code className="code-box break-anywhere">{initialData.source.endpoint}</code>
                  </div>
                )}
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
                    <strong>Source transformer</strong>
                    <p>
                      {draft.processingScript
                        ? 'A transformer script is configured.'
                        : 'Messages pass through unchanged when no transformer is configured.'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setEditor({ field: 'processingScript', title: 'Source transformer' })
                    }
                  >
                    <Code2 size={15} />
                    Edit script
                  </Button>
                </div>
                <details className="advanced-section">
                  <summary>Advanced processing</summary>
                  <label className="field">
                    <span>Source filter</span>
                    <small>Return true to accept a message, false to filter it.</small>
                    <textarea
                      rows={5}
                      className="code-input"
                      value={draft.filterScript}
                      onChange={(e) => setDraft((d) => ({ ...d, filterScript: e.target.value }))}
                    />
                  </label>
                  <div className="script-setting">
                    <div>
                      <strong>Source response</strong>
                      <p>Customize the response after processing.</p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setEditor({ field: 'responseScript', title: 'Source response' })
                      }
                    >
                      Edit script
                    </Button>
                  </div>
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
                  <section key={dest.id ?? index} className="destination-editor">
                    <div className="section-header">
                      <h3>
                        <span className="step-number">{index + 1}</span>
                        {dest.name || 'New destination'}
                      </h3>
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label={`Remove destination ${index + 1}`}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            destinations: d.destinations.filter((_, i) => i !== index),
                          }))
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <label className="field">
                      <span>Destination name *</span>
                      <input
                        value={dest.name}
                        maxLength={150}
                        onChange={(e) => changeDestination(index, { name: e.target.value })}
                      />
                    </label>
                    <div className="form-grid">
                      <label className="field">
                        <span>Connector</span>
                        <select
                          value={dest.type}
                          onChange={(e) =>
                            changeDestination(index, { type: e.target.value as DestinationType })
                          }
                        >
                          {Object.values(DestinationType).map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Outbound format</span>
                        <select
                          value={dest.outboundDataType}
                          onChange={(e) =>
                            changeDestination(index, {
                              outboundDataType: e.target.value as DataType,
                            })
                          }
                        >
                          {dataOptions.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="field">
                      <span>Endpoint *</span>
                      <input
                        value={dest.endpoint}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={
                          dest.type === 'REST'
                            ? 'https://api.example.com/messages'
                            : 'tcp://host:2575'
                        }
                        onChange={(e) => changeDestination(index, { endpoint: e.target.value })}
                      />
                    </label>
                    {dest.credentialConfigured && (
                      <p className="muted">
                        Credentials are retained for an unchanged URL. Re-enter them when changing
                        this endpoint.
                      </p>
                    )}
                    <details className="advanced-section">
                      <summary>Advanced · scripts, retries & timeout</summary>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={dest.isEnabled !== false}
                          onChange={(e) =>
                            changeDestination(index, { isEnabled: e.target.checked })
                          }
                        />
                        Destination enabled
                      </label>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={!!dest.retryEnabled}
                          onChange={(e) =>
                            changeDestination(index, { retryEnabled: e.target.checked })
                          }
                        />
                        Retry failed deliveries
                      </label>
                      <div className="form-grid">
                        <label className="field">
                          <span>Max retries</span>
                          <input
                            type="number"
                            min={0}
                            max={10}
                            value={dest.maxRetries ?? 3}
                            onChange={(e) =>
                              changeDestination(index, { maxRetries: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Retry interval (seconds)</span>
                          <input
                            type="number"
                            min={1}
                            max={86400}
                            value={dest.retryIntervalSeconds ?? 30}
                            onChange={(e) =>
                              changeDestination(index, {
                                retryIntervalSeconds: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Timeout (milliseconds)</span>
                          <input
                            type="number"
                            min={100}
                            max={120000}
                            value={dest.timeoutMs ?? 10000}
                            onChange={(e) =>
                              changeDestination(index, { timeoutMs: Number(e.target.value) })
                            }
                          />
                        </label>
                      </div>
                      <label className="field">
                        <span>Destination filter</span>
                        <textarea
                          rows={4}
                          className="code-input"
                          value={dest.filterScript || ''}
                          onChange={(e) =>
                            changeDestination(index, { filterScript: e.target.value })
                          }
                        />
                      </label>
                      <div className="heading-actions">
                        {(['processingScript', 'responseScript', 'templateScript'] as const).map(
                          (field) => (
                            <Button
                              key={field}
                              type="button"
                              variant="secondary"
                              onClick={() =>
                                setEditor({
                                  destination: index,
                                  field,
                                  title:
                                    field === 'processingScript'
                                      ? 'Destination transformer'
                                      : field === 'responseScript'
                                        ? 'Destination response'
                                        : 'Destination template',
                                })
                              }
                            >
                              <Code2 size={14} />
                              {field === 'processingScript'
                                ? 'Transformer'
                                : field === 'responseScript'
                                  ? 'Response'
                                  : 'Template'}
                            </Button>
                          ),
                        )}
                      </div>
                    </details>
                  </section>
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
                    source={draft.source.type}
                    destinations={draft.destinations.map((d) => d.name || 'Unnamed destination')}
                  />
                </div>
                <dl className="definition-list">
                  <div>
                    <dt>Inbound format</dt>
                    <dd>{draft.source.inboundDataType}</dd>
                  </div>
                  <div>
                    <dt>Source transformer</dt>
                    <dd>{draft.processingScript ? 'Configured' : 'Pass-through'}</dd>
                  </div>
                  <div>
                    <dt>Source filter</dt>
                    <dd>{draft.filterScript ? 'Configured' : 'Accept all messages'}</dd>
                  </div>
                </dl>
                {draft.destinations.map((d, i) => (
                  <div key={i} className="review-destination">
                    <span className="step-number">{i + 1}</span>
                    <div>
                      <strong>{d.name || 'Unnamed destination'}</strong>
                      <small className="break-anywhere">{d.endpoint || 'Endpoint required'}</small>
                      <small>
                        {d.type} · {d.outboundDataType} ·{' '}
                        {d.isEnabled === false ? 'Disabled' : 'Enabled'} ·{' '}
                        {d.retryEnabled ? `${d.maxRetries ?? 3} retries` : 'No automatic retry'}
                      </small>
                    </div>
                  </div>
                ))}
                <p className="muted">
                  {initialData
                    ? 'The channel keeps its current running state.'
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
          onClose();
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
        message="This changes the source credential immediately. External sources using the previous key must be updated. Copy the new key before closing this editor."
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
