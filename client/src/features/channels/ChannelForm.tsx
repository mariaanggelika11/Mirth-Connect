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
import { ReviewTest } from './ReviewTest';
import { FilterEditor } from './FilterEditor';
import { readFieldMapping } from '../../../../server/src/utils/fieldMapping';
import { readSimpleCondition } from '../../../../server/src/utils/simpleCondition';
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
  const [sourceFilterValid, setSourceFilterValid] = useState(true);
  const [destinationFilterValidity, setDestinationFilterValidity] = useState<boolean[]>([]);
  const [destinationKeys, setDestinationKeys] = useState<number[]>([]);
  const nextDestinationKey = useRef(0);
  const [sourceConfiguration, setSourceConfiguration] = useState<{
    baseUrl: string;
    path: string;
  } | null>(null);
  const [draft, setDraft] = useState<ChannelFormData>(() => initialDraft(initialData));
  const [baseline, setBaseline] = useState(''),
    [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [testError, setTestError] = useState(''),
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
    step,
    draft,
    profileText,
    sample,
    rawPreview,
    canViewRaw,
    sourceFilterValid,
    filterEnabled,
    destinationFilterValidity,
    transformationValid,
  });
  const currentPreviewContext = useRef(previewContext);
  const previewRequest = useRef(0);
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
      setTestError('');
      setKey('');
      setDiscard(false);
      setEditor(null);
      setTestResult(null);
      setRawPreview(false);
      setTransformationValid(true);
      setSourceFilterValid(true);
      setDestinationFilterValidity(value.destinations.map(() => true));
      setDestinationKeys(value.destinations.map(() => nextDestinationKey.current++));
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
  useEffect(() => {
    previewRequest.current++;
    setTestResult(null);
    setTestError('');
    setTesting(false);
  }, [previewContext]);
  useEffect(() => {
    if (!canViewRaw) {
      setRawPreview(false);
      setTestResult(null);
    }
  }, [canViewRaw]);
  useEffect(() => setKey(''), [step, draft.source.type]);
  const dirty =
    JSON.stringify(draft) !== baseline ||
    profileText !== profileBaseline ||
    !transformationValid ||
    (filterEnabled && !sourceFilterValid) ||
    destinationFilterValidity.includes(false);
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
  function unfinishedFilter() {
    if (filterEnabled && !sourceFilterValid) {
      setStep(0);
      setError('Complete the source filter condition or choose another filter mode.');
      return true;
    }
    const index = destinationFilterValidity.findIndex((valid) => !valid);
    if (index >= 0) {
      setStep(2);
      setError(
        `Complete the filter condition for destination ${index + 1}, or choose another filter mode.`,
      );
      return true;
    }
    return false;
  }
  function navigate(targetStep: number) {
    if (targetStep !== step && unfinishedFilter()) return;
    if (targetStep > 1 && !transformationValid) {
      setStep(1);
      setError('Complete or remove the unfinished field mapping.');
      return;
    }
    setStep(targetStep);
    setError('');
  }
  function next() {
    setError('');
    if (unfinishedFilter()) return;
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
    if (unfinishedFilter()) return;
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
  function reviewConfigurationError() {
    if (!draft.name.trim()) return 'Enter a channel name in Source before testing.';
    if (!draft.source.inboundDataType || !dataOptions.includes(draft.source.inboundDataType))
      return 'Select the inbound format in Source before testing.';
    if (!transformationValid) return 'Complete each Source Field and Target Field before testing.';
    if (filterEnabled && !sourceFilterValid)
      return 'Complete the source filter condition before testing.';
    const invalidFilter = destinationFilterValidity.findIndex((valid) => !valid);
    if (invalidFilter >= 0)
      return `Complete the filter condition for destination ${invalidFilter + 1} before testing.`;
    for (const [index, destination] of draft.destinations.entries()) {
      if (!destination.outboundDataType || !dataOptions.includes(destination.outboundDataType))
        return 'Destination output format has not been selected.';
      if (!destination.name.trim())
        return `Enter a name for destination ${index + 1} before testing.`;
      if (!destination.endpoint.trim())
        return `Enter an endpoint for destination ${index + 1} before testing.`;
    }
    try {
      selectedValidationProfile(validation, profileText);
    } catch {
      return 'Fix the custom validation schema in Source before testing.';
    }
    return '';
  }
  async function previewOutput() {
    if (step !== 3 || testing) return;
    setTestResult(null);
    setTestError('');
    const configurationError = reviewConfigurationError();
    if (configurationError) {
      setTestError(configurationError);
      return;
    }
    let payload: unknown = sample;
    if (draft.source.inboundDataType === DataType.JSON) {
      try {
        payload = JSON.parse(sample);
      } catch {
        setTestError('The test payload is not valid JSON.');
        return;
      }
    } else if (!sample.trim()) {
      setTestError('Enter a synthetic test message before testing.');
      return;
    }
    const context = previewContext;
    const request = ++previewRequest.current;
    setTesting(true);
    setError('');
    try {
      const validationProfile = selectedValidationProfile(validation, profileText);
      const { data } = await api.post<DryRunResult>('/channel/preview-transformation', {
        configuration: { ...draft, validationProfile },
        payload,
        raw: rawPreview && canViewRaw,
      });
      if (currentPreviewContext.current === context && previewRequest.current === request)
        setTestResult(data);
    } catch (error) {
      if (currentPreviewContext.current === context && previewRequest.current === request)
        setTestError(
          error instanceof Error
            ? error.message
            : 'Check the source and destination settings, then try the test again.',
        );
    } finally {
      if (previewRequest.current === request) setTesting(false);
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
  const steps = ['Source', 'Transformation', 'Destinations', 'Review & Test'];
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
                onClick={() => navigate(i)}
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
            <div
              className="form-section"
              style={{ display: step === 0 ? 'block' : 'none' }}
              aria-hidden={step !== 0}
            >
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
                        API key digunakan oleh sistem sumber untuk mengirim data ke channel.
                      </p>
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
                <details className="advanced-section" aria-label="Source validation settings">
                  <summary>
                    Validation
                    {validation !== 'NONE' && <small> · Configured</small>}
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
                        checked={validation === 'BASIC' || validation === 'BASIC_JSON'}
                        onChange={() => chooseValidation('BASIC')}
                      />
                      Basic validation
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
                        <span>Custom validation schema</span>
                        <textarea
                          aria-label="Custom validation schema editor"
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
                <details className="advanced-section" aria-label="Source filter settings">
                  <summary>Source filter{filterEnabled && <small> · Configured</small>}</summary>
                  <p className="muted">Choose which valid messages this channel processes.</p>
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
                  {!filterEnabled && <p className="muted">All valid messages are accepted.</p>}
                  <div
                    style={{ display: filterEnabled ? 'block' : 'none' }}
                    aria-hidden={!filterEnabled}
                  >
                    <FilterEditor
                      kind="source"
                      value={filterEnabled ? draft.filterScript || '' : retainedFilter}
                      onChange={(script) => {
                        setRetainedFilter(script);
                        setDraft((d) => ({ ...d, filterScript: script }));
                      }}
                      onValidityChange={(valid) => {
                        setSourceFilterValid(valid);
                        if (!valid) setTestResult(null);
                      }}
                    />
                  </div>
                </details>
                <details className="advanced-section" aria-label="Source transformer settings">
                  <summary>
                    Source transformer
                    {draft.processingScript?.trim() && <small> · Configured</small>}
                  </summary>
                  <p>
                    <strong>Source transformation:</strong>{' '}
                    {fieldMapping
                      ? `${fieldMapping.rows.length} field mappings configured in Transformation`
                      : draft.processingScript?.trim()
                        ? 'Custom transformation configured'
                        : 'No transformation'}
                  </p>
                  <p className="muted">
                    Change or normalize the message before destination processing.
                  </p>
                  {fieldMapping && (
                    <p className="muted">This is the same mapping shown in Transformation.</p>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setEditor({ field: 'processingScript', title: 'Source transformation' })
                    }
                  >
                    <Code2 size={14} /> Configure transformation
                  </Button>
                </details>
                {draft.responseScript?.trim() && (
                  <small>Legacy custom source response is active.</small>
                )}
              </details>
            </div>
            <div style={{ display: step === 1 ? 'block' : 'none' }} aria-hidden={step !== 1}>
              <TransformationEditor
                inboundFormat={draft.source.inboundDataType || DataType.JSON}
                processingScript={draft.processingScript || ''}
                onScriptChange={(script) => setDraft((d) => ({ ...d, processingScript: script }))}
                onValidityChange={(valid) => {
                  setTransformationValid(valid);
                  if (!valid) setTestResult(null);
                }}
              />
            </div>
            <div
              className="form-section"
              style={{ display: step === 2 ? 'block' : 'none' }}
              aria-hidden={step !== 2}
            >
              <div className="section-intro">
                <h3>Where should messages go?</h3>
                <p>Destinations run in the order shown below.</p>
              </div>
              {draft.destinations.map((dest, index) => (
                <DestinationEditor
                  key={destinationKeys[index] ?? dest.id ?? index}
                  dest={dest}
                  index={index}
                  inboundFormat={draft.source.inboundDataType}
                  onChange={(values) => changeDestination(index, values)}
                  onRemove={() => {
                    setDestinationFilterValidity((values) => values.filter((_, i) => i !== index));
                    setDestinationKeys((values) => values.filter((_, i) => i !== index));
                    setDraft((d) => ({
                      ...d,
                      destinations: d.destinations.filter((_, i) => i !== index),
                    }));
                  }}
                  onEditScript={setEditor}
                  onFilterValidityChange={(valid) => {
                    setDestinationFilterValidity((values) =>
                      values.map((value, i) => (i === index ? valid : value)),
                    );
                    if (!valid) setTestResult(null);
                  }}
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
                onClick={() => {
                  setDestinationFilterValidity((values) => [...values, true]);
                  setDestinationKeys((values) => [...values, nextDestinationKey.current++]);
                  setDraft((d) => ({
                    ...d,
                    destinations: [
                      ...d.destinations,
                      {
                        ...newDestination(),
                        outboundDataType: d.source.inboundDataType || DataType.JSON,
                      },
                    ],
                  }));
                }}
              >
                <Plus size={16} />
                Add Destination
              </Button>
            </div>
            {step === 3 && (
              <div className="form-section">
                <div className="section-intro">
                  <h3>Review &amp; Test</h3>
                  <p>{draft.name || 'Unnamed channel'}</p>
                </div>
                <div className="integration-flow" aria-label="Integration flow">
                  <div>
                    <strong>
                      {draft.source.type} / {draft.source.inboundDataType}
                    </strong>
                  </div>
                  <span aria-hidden="true">↓</span>
                  <div>
                    <strong>
                      {fieldMapping
                        ? `${fieldMapping.rows.length} field mappings`
                        : draft.processingScript?.trim()
                          ? 'Custom transformation script'
                          : 'Original fields (pass-through)'}
                    </strong>
                  </div>
                  <div className="integration-flow-branches">
                    {draft.destinations.map((destination, index) => (
                      <div className="integration-flow-destination" key={destination.id ?? index}>
                        <span aria-hidden="true">↓</span>
                        <strong>
                          {destination.type} / {destination.outboundDataType || 'Select format'}
                        </strong>
                        <small>{destination.name || 'Unnamed destination'}</small>
                      </div>
                    ))}
                  </div>
                </div>
                <dl className="definition-list">
                  <div>
                    <dt>Source</dt>
                    <dd>
                      {draft.source.type} / {draft.source.inboundDataType}
                    </dd>
                  </div>
                </dl>
                <section className="form-section" aria-label="Source processing summary">
                  <h3>Source processing</h3>
                  <dl className="definition-list">
                    <div>
                      <dt>Validation</dt>
                      <dd>
                        {validation === 'NONE'
                          ? 'Parsing only'
                          : validation === 'CUSTOM'
                            ? 'Custom schema'
                            : validation === 'BASIC_JSON'
                              ? 'Basic (existing JSON object schema)'
                              : 'Basic'}
                      </dd>
                    </div>
                    <div>
                      <dt>Filter</dt>
                      <dd>
                        {!draft.filterScript?.trim()
                          ? 'Off'
                          : readSimpleCondition(draft.filterScript)
                            ? 'Simple condition'
                            : /^return\s+true\s*;?$/.test(draft.filterScript.trim())
                              ? 'Accept all messages'
                              : /^return\s+false\s*;?$/.test(draft.filterScript.trim())
                                ? 'Filter all messages'
                                : 'Custom condition'}
                      </dd>
                    </div>
                    <div>
                      <dt>Transformer</dt>
                      <dd>
                        {fieldMapping
                          ? `${fieldMapping.rows.length} field mappings (configured in Transformation)`
                          : draft.processingScript?.trim()
                            ? 'Custom transformation'
                            : 'None (pass-through)'}
                      </dd>
                    </div>
                  </dl>
                </section>
                <dl className="definition-list">
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
                          <dt>Connector / Output format</dt>
                          <dd>
                            {destination.type} / {destination.outboundDataType || 'Not selected'}
                          </dd>
                        </div>
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
                <ReviewTest
                  inboundFormat={draft.source.inboundDataType || DataType.JSON}
                  destinations={draft.destinations}
                  sample={sample}
                  onSampleChange={setSample}
                  onTest={() => void previewOutput()}
                  result={testResult}
                  testing={testing}
                  error={testError}
                  configurationError={reviewConfigurationError()}
                  rawPreview={rawPreview}
                  onRawPreviewChange={setRawPreview}
                  canViewRaw={canViewRaw}
                />
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
                  onClick={() => navigate(step - 1)}
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
