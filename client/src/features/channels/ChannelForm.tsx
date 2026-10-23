import { readSourceFilter, writeSourceFilter } from '../../../../server/src/utils/sourceFilter';
import { DestinationEditor } from './DestinationEditor';
import type { ChannelScriptEditor } from './channelDraft';
import {
  newDestination,
  initialDraft,
  createMessageValidationDraft,
  messageValidationProfile,
  messageValidationSummary,
  messageValidationConfigured,
  validationDraftErrors,
} from './channelDraft';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus } from 'lucide-react';
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
import { MessageValidationEditor } from './MessageValidationEditor';
import { readFieldMapping } from '../../../../server/src/utils/fieldMapping';
import { readSimpleCondition } from '../../../../server/src/utils/simpleCondition';
import { SourceEndpoint } from './SourceEndpoint';
import type { DryRunResult } from './DryRunPreview';
import { useAuth } from '../../contexts/AuthContext';
import { compatibleContentTypes } from '../../../../server/src/utils/httpSettings';
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
  const [destinationTransformationValidity, setDestinationTransformationValidity] = useState<
    boolean[]
  >([]);
  const [destinationIssues, setDestinationIssues] = useState<string[]>([]);
  const [destinationKeys, setDestinationKeys] = useState<number[]>([]);
  const nextDestinationKey = useRef(0);
  const scrollBody = useRef<HTMLDivElement>(null);
  const channelNameInput = useRef<HTMLInputElement>(null);
  const [sourceValidationAttempt, setSourceValidationAttempt] = useState(0);
  const [validationAttempt, setValidationAttempt] = useState(0);
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
    [validation, setValidation] = useState(() => createMessageValidationDraft()),
    [validationBaseline, setValidationBaseline] = useState(''),
    [showValidationErrors, setShowValidationErrors] = useState(false),
    [filterEnabled, setFilterEnabled] = useState(false),
    [retainedFilter, setRetainedFilter] = useState(''),
    [rawPreview, setRawPreview] = useState(false);
  const [editor, setEditor] = useState<ChannelScriptEditor | null>(null);
  const previewContext = JSON.stringify({
    isOpen,
    step,
    draft,
    validation,
    sample,
    rawPreview,
    canViewRaw,
    sourceFilterValid,
    filterEnabled,
    destinationFilterValidity,
    destinationTransformationValidity,
    transformationValid,
  });
  const currentPreviewContext = useRef(previewContext);
  const previewRequest = useRef(0);
  currentPreviewContext.current = previewContext;
  useEffect(() => {
    if (isOpen) {
      const value = seedData || initialDraft(initialData);
      setDraft(value);
      const validationValue = createMessageValidationDraft(
        value.validationProfile,
        value.source.inboundDataType,
      );
      setValidation(validationValue);
      setValidationBaseline(JSON.stringify(validationValue));
      setShowValidationErrors(false);
      setValidationAttempt(0);
      setSourceValidationAttempt(0);
      const storedFilter = readSourceFilter(value.filterScript);
      setFilterEnabled(storedFilter.enabled);
      setRetainedFilter(storedFilter.rule);
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
      setDestinationTransformationValidity(value.destinations.map(() => true));
      setDestinationIssues(value.destinations.map(() => ''));
      setDestinationKeys(value.destinations.map(() => nextDestinationKey.current++));
      setSample(syntheticSample(value.source.inboundDataType));
    } else {
      setKey('');
      setTestResult(null);
    }
  }, [isOpen, initialData, seedData]);
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
    JSON.stringify(validation) !== validationBaseline ||
    !transformationValid ||
    (filterEnabled && !sourceFilterValid) ||
    destinationFilterValidity.includes(false) ||
    destinationTransformationValidity.includes(false);
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
    setError('');
    setDraft((d) => ({
      ...d,
      destinations: d.destinations.map((v, i) => (i === index ? { ...v, ...values } : v)),
    }));
  }
  function unfinishedFilter() {
    if (filterEnabled && !sourceFilterValid) {
      setSourceValidationAttempt((value) => value + 1);
      setStep(0);
      setError('Complete the source filter condition or disable the source filter.');
      return true;
    }
    const index = destinationFilterValidity.findIndex((valid) => !valid);
    if (index >= 0) {
      setValidationAttempt((value) => value + 1);
      setStep(2);
      setError(
        `Complete the filter condition for destination ${index + 1}, or disable its filter.`,
      );
      return true;
    }
    const invalidTransformation = destinationTransformationValidity.findIndex((valid) => !valid);
    if (invalidTransformation >= 0) {
      setValidationAttempt((value) => value + 1);
      setStep(2);
      setError(
        destinationIssues[invalidTransformation] ||
          `Complete or remove the unfinished field mapping for destination ${invalidTransformation + 1}.`,
      );
      return true;
    }
    return false;
  }
  function unfinishedValidation() {
    const errors = validationDraftErrors(validation, draft.source.inboundDataType);
    if (!errors.length) return false;
    setSourceValidationAttempt((value) => value + 1);
    setShowValidationErrors(true);
    setStep(0);
    setError(errors[0]);
    return true;
  }
  function navigate(targetStep: number) {
    if (targetStep > 0 && unfinishedRequiredFields(1)) return;
    if (targetStep > 0 && unfinishedValidation()) return;
    if (targetStep !== step && unfinishedFilter()) return;
    if (targetStep > 1 && !transformationValid) {
      setStep(1);
      setError('Complete or remove the unfinished field mapping.');
      return;
    }
    if (unfinishedRequiredFields(targetStep)) return;
    setStep(targetStep);
    setError('');
  }
  function unfinishedRequiredFields(targetStep: number) {
    if (targetStep > 0 && !draft.name.trim()) {
      setStep(0);
      setError('Give this channel a name before continuing.');
      requestAnimationFrame(() => channelNameInput.current?.focus());
      return true;
    }
    if (
      targetStep > 2 &&
      draft.destinations.some(
        (destination) =>
          !destination.name.trim() || !destination.endpoint.trim() || !destination.outboundDataType,
      )
    ) {
      setValidationAttempt((value) => value + 1);
      setStep(2);
      setError('Each destination needs a name, endpoint and outbound format.');
      return true;
    }
    return false;
  }
  function next() {
    setError('');
    if (unfinishedRequiredFields(1)) return;
    if (unfinishedValidation()) return;
    if (unfinishedFilter()) return;
    if (step === 1 && !transformationValid) {
      setError('Complete or remove the unfinished field mapping.');
      return;
    }
    if (unfinishedRequiredFields(step + 1)) return;
    setStep((s) => Math.min(3, s + 1));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (unfinishedValidation()) return;
    if (unfinishedFilter()) return;
    if (step < 3) {
      next();
      return;
    }
    if (unfinishedRequiredFields(3)) return;
    if (!transformationValid) {
      setStep(1);
      setError('Complete or remove the unfinished field mapping.');
      return;
    }
    let validationProfile: Record<string, unknown>;
    try {
      validationProfile = messageValidationProfile(validation, draft.source.inboundDataType);
    } catch (error) {
      setShowValidationErrors(true);
      setError(
        error instanceof Error
          ? error.message
          : 'Review the message validation configuration in Source.',
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
    const invalidDestinationTransformation = destinationTransformationValidity.findIndex(
      (valid) => !valid,
    );
    if (invalidDestinationTransformation >= 0)
      return (
        destinationIssues[invalidDestinationTransformation] ||
        `Complete or remove the unfinished field mapping for destination ${invalidDestinationTransformation + 1} before testing.`
      );
    for (const [index, destination] of draft.destinations.entries()) {
      if (!destination.outboundDataType || !dataOptions.includes(destination.outboundDataType))
        return 'Destination output format has not been selected.';
      if (!destination.name.trim())
        return `Enter a name for destination ${index + 1} before testing.`;
      if (!destination.endpoint.trim())
        return `Enter an endpoint for destination ${index + 1} before testing.`;
    }
    try {
      messageValidationProfile(validation, draft.source.inboundDataType);
    } catch (error) {
      return error instanceof Error
        ? error.message
        : 'Fix the validation configuration in Source before testing.';
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
      const validationProfile = messageValidationProfile(validation, draft.source.inboundDataType);
      const { data } = await api.post<DryRunResult>('/channel/preview-transformation', {
        configuration: {
          ...draft,
          changeSummary: draft.changeSummary?.trim() || undefined,
          validationProfile,
        },
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
  useEffect(() => {
    if (!error || step !== 0 || (!showValidationErrors && !(filterEnabled && !sourceFilterValid)))
      return;
    const section = document.querySelector<HTMLDetailsElement>(
      '.channel-editor details[data-source-advanced]',
    );
    if (section) section.open = true;
    if (filterEnabled && !sourceFilterValid) {
      const filter = section?.querySelector<HTMLDetailsElement>(
        '[aria-label="Source filter settings"]',
      );
      if (filter) filter.open = true;
    }
    if (showValidationErrors) {
      const validation = section?.querySelector<HTMLDetailsElement>(
        '[aria-label="Source validation settings"]',
      );
      if (validation) validation.open = true;
    }
  }, [
    error,
    step,
    showValidationErrors,
    filterEnabled,
    sourceFilterValid,
    sourceValidationAttempt,
  ]);
  useEffect(() => {
    if (isOpen && scrollBody.current) scrollBody.current.scrollTop = 0;
  }, [step, isOpen]);
  const steps = ['Source', 'Transformation', 'Destinations', 'Review & Test'];
  const fieldMapping = readFieldMapping(draft.processingScript || '');
  const customSource = Boolean(
    (filterEnabled && sourceFilterValid && retainedFilter.trim()) ||
    draft.responseScript?.trim() ||
    messageValidationConfigured(validation, draft.source.inboundDataType) ||
    (draft.idempotencyMode && draft.idempotencyMode !== 'OPTIONAL'),
  );
  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={close}
        title={initialData ? 'Edit channel' : 'New channel'}
        className="channel-dialog"
      >
        <form onSubmit={save} className="channel-editor" noValidate>
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
          <div className="editor-body" ref={scrollBody}>
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
              <label className="field">
                <span>
                  Channel name <span className="required">*</span>
                </span>
                <input
                  ref={channelNameInput}
                  autoComplete="off"
                  value={draft.name}
                  maxLength={150}
                  placeholder="e.g. JSON_TO_XML_PATIENT"
                  onChange={(e) => {
                    setError('');
                    setDraft((d) => ({ ...d, name: e.target.value }));
                  }}
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
                      setValidation((v) => {
                        if (v.customText.trim() !== '{}' || Object.keys(v.retainedCustom).length)
                          return v;
                        return {
                          ...v,
                          customKind:
                            e.target.value === DataType.XML
                              ? 'XML'
                              : e.target.value === DataType.HL7V2
                                ? 'HL7'
                                : e.target.value === DataType.TEXT
                                  ? 'PROFILE'
                                  : 'JSON_SCHEMA',
                        };
                      });
                    }}
                  >
                    {dataOptions.map((format) => (
                      <option key={format}>{format}</option>
                    ))}
                  </select>
                </label>
              </div>
              {draft.source.type === 'HTTP' && initialData && (
                <>
                  {initialData?.source.type === 'HTTP' && <SourceEndpoint channel={initialData} />}
                  <section className="source-authentication" aria-label="Source authentication">
                    <p className="muted">
                      {initialData.apiKeyConfigured
                        ? 'Source API key configured.'
                        : 'Create a source API key before sending messages.'}
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
                      </div>
                    )}
                  </section>
                </>
              )}
              {draft.source.type === 'HL7' && initialData?.source.type === 'HL7' && (
                <div className="field">
                  <span>Source endpoint</span>
                  <code>{initialData.source.endpoint}</code>
                  <small>Access is controlled by the listener network and TLS settings.</small>
                </div>
              )}
              <details className="advanced-section" data-source-advanced>
                <summary>
                  <span>Advanced source settings</span>
                  {customSource && <span className="configured-hint">Customized</span>}
                </summary>
                <MessageValidationEditor
                  key={`${initialData?.id || 'new'}:${isOpen}`}
                  value={validation}
                  format={draft.source.inboundDataType}
                  showErrors={showValidationErrors}
                  onChange={(value) => {
                    setValidation(value);
                    setShowValidationErrors(false);
                    setError('');
                    try {
                      const profile = messageValidationProfile(value, draft.source.inboundDataType);
                      setDraft((d) => ({ ...d, validationProfile: profile }));
                    } catch {
                      // Retain incomplete editor text; navigation, Test and Save report configuration errors.
                    }
                  }}
                />
                <details className="advanced-section" aria-label="Source filter settings">
                  <summary>
                    Filter
                    <small>
                      {' · '}
                      {!filterEnabled
                        ? 'Off'
                        : sourceFilterValid && retainedFilter.trim()
                          ? 'Configured'
                          : 'Needs configuration'}
                    </small>
                  </summary>
                  {draft.source.type === 'HL7' && (
                    <p className="muted">
                      This listener is shared. Each message must match exactly one running HL7
                      channel.
                    </p>
                  )}
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={filterEnabled}
                      onChange={(e) => {
                        try {
                          const script = writeSourceFilter(retainedFilter, e.target.checked);
                          setFilterEnabled(e.target.checked);
                          setDraft((d) => ({ ...d, filterScript: script }));
                        } catch (error) {
                          setError(
                            error instanceof Error ? error.message : 'Unable to update filter.',
                          );
                        }
                      }}
                    />
                    Enable source filter
                  </label>
                  <div
                    style={{ display: filterEnabled ? 'block' : 'none' }}
                    aria-hidden={!filterEnabled}
                  >
                    <FilterEditor
                      kind="source"
                      value={retainedFilter}
                      onChange={(script) => {
                        setError('');
                        setRetainedFilter(script);
                        setDraft((d) => ({
                          ...d,
                          filterScript: writeSourceFilter(script, filterEnabled),
                        }));
                      }}
                      onValidityChange={(valid) => {
                        setSourceFilterValid(valid);
                        if (!valid) setTestResult(null);
                      }}
                    />
                  </div>
                </details>
              </details>
            </div>
            <div style={{ display: step === 1 ? 'block' : 'none' }} aria-hidden={step !== 1}>
              <TransformationEditor
                inboundFormat={draft.source.inboundDataType || DataType.JSON}
                processingScript={draft.processingScript || ''}
                onScriptChange={(script) => {
                  setError('');
                  setDraft((d) => ({ ...d, processingScript: script }));
                }}
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
              {draft.destinations.map((dest, index) => (
                <DestinationEditor
                  key={destinationKeys[index] ?? dest.id ?? index}
                  dest={dest}
                  validationAttempt={validationAttempt}
                  index={index}
                  inboundFormat={draft.source.inboundDataType}
                  onChange={(values) => changeDestination(index, values)}
                  onRemove={() => {
                    setDestinationIssues((values) => values.filter((_, i) => i !== index));
                    setDestinationFilterValidity((values) => values.filter((_, i) => i !== index));
                    setDestinationTransformationValidity((values) =>
                      values.filter((_, i) => i !== index),
                    );
                    setDestinationKeys((values) => values.filter((_, i) => i !== index));
                    setDraft((d) => ({
                      ...d,
                      destinations: d.destinations.filter((_, i) => i !== index),
                    }));
                  }}
                  onEditScript={setEditor}
                  onConfigurationErrorChange={(message) =>
                    setDestinationIssues((values) =>
                      values.map((value, i) => (i === index ? message : value)),
                    )
                  }
                  onFilterValidityChange={(valid) => {
                    setDestinationFilterValidity((values) =>
                      values.map((value, i) => (i === index ? valid : value)),
                    );
                    if (!valid) setTestResult(null);
                  }}
                  onTransformationValidityChange={(valid) => {
                    setDestinationTransformationValidity((values) =>
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
                  setDestinationTransformationValidity((values) => [...values, true]);
                  setDestinationIssues((values) => [...values, '']);
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
                  <p className="review-channel-name">{draft.name}</p>
                </div>
                <div className="integration-flow" aria-label="Integration flow">
                  <div>
                    <small>Source</small>
                    <strong>
                      {draft.source.type} / {draft.source.inboundDataType}
                    </strong>
                  </div>
                  <span className="integration-flow-arrow" aria-hidden="true">
                    →
                  </span>
                  <div>
                    <small>Transformation</small>
                    <strong>
                      {fieldMapping
                        ? `${fieldMapping.rows.length} field mappings`
                        : draft.processingScript?.trim()
                          ? 'Custom transformation script'
                          : 'No field changes'}
                    </strong>
                  </div>
                  <span className="integration-flow-arrow" aria-hidden="true">
                    →
                  </span>
                  <div className="integration-flow-branches">
                    {draft.destinations.map((destination, index) => (
                      <div className="integration-flow-destination" key={destination.id ?? index}>
                        <small>Destination {draft.destinations.length > 1 ? index + 1 : ''}</small>
                        <strong>
                          {destination.type} / {destination.outboundDataType || 'Select format'}
                        </strong>
                        <small>{destination.name || 'Unnamed destination'}</small>
                        {destination.isEnabled === false && <small>Disabled</small>}
                      </div>
                    ))}
                    {!draft.destinations.length && (
                      <small>Receive only · no outbound delivery</small>
                    )}
                  </div>
                </div>
                <details className="advanced-section review-configuration-details">
                  <summary>View details</summary>
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
                    {draft.responseScript?.trim() && (
                      <small>Legacy custom source response is active.</small>
                    )}
                    <dl className="definition-list">
                      <div>
                        <dt>Validation</dt>
                        <dd>
                          {messageValidationSummary(validation, draft.source.inboundDataType)}
                        </dd>
                      </div>
                      <div>
                        <dt>Filter</dt>
                        <dd>
                          {!filterEnabled
                            ? 'Disabled'
                            : readSimpleCondition(retainedFilter)
                              ? 'Simple condition'
                              : 'Legacy filter retained'}
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
                          {destination.type === 'REST' && (
                            <>
                              <div>
                                <dt>HTTP request</dt>
                                <dd>
                                  {destination.deliveryPolicy?.http?.method || 'POST'} ·{' '}
                                  {destination.deliveryPolicy?.http?.contentType ||
                                    compatibleContentTypes(
                                      destination.outboundDataType || 'JSON',
                                    )[0]}
                                </dd>
                              </div>
                            </>
                          )}
                          {(() => {
                            const mapping = readFieldMapping(destination.processingScript || '');
                            return mapping?.version === 2 && mapping.hl7 ? (
                              <div>
                                <dt>HL7 profile</dt>
                                <dd>
                                  {mapping.hl7.messageType} · {mapping.hl7.version}
                                </dd>
                              </div>
                            ) : null;
                          })()}
                          <div>
                            <dt>Timeout</dt>
                            <dd>{(destination.timeoutMs ?? 10000) / 1000} seconds</dd>
                          </div>
                        </dl>
                        {destination.isEnabled === false && <small>Destination disabled</small>}
                      </div>
                    </section>
                  ))}
                </details>
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
