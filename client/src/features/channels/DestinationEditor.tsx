import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { DataType, DestinationType } from '../../types';
import type { Destination } from '../../types';
import type { ChannelScriptEditor } from './channelDraft';
import { FilterEditor } from './FilterEditor';
import { TransformationEditor } from './TransformationEditor';
import {
  readDestinationFilter,
  writeDestinationFilter,
} from '../../../../server/src/utils/sourceFilter';
import {
  destinationHttpIssues,
  destinationDeliveryIssues,
  destinationDeliveryCustomized,
  destinationHttpCustomized,
} from './destinationSettings';
import type { FieldOption } from '../../components/ui/FieldPicker';
import {
  compatibleContentTypes,
  type HttpSettings,
} from '../../../../server/src/utils/httpSettings';
interface Props {
  dest: Destination;
  index: number;
  onChange: (values: Partial<Destination>) => void;
  onRemove: () => void;
  onEditScript: (editor: ChannelScriptEditor) => void;
  onFilterValidityChange?: (valid: boolean) => void;
  onTransformationValidityChange?: (valid: boolean) => void;
  onConfigurationErrorChange?: (message: string) => void;
  inboundFormat?: string;
  sourceFields?: FieldOption[];
  validationAttempt?: number;
}
const dataOptions = Object.values(DataType);
const connectorValue = (type: DestinationType) =>
  type === DestinationType.HL7
    ? DestinationType.MLLP
    : type === DestinationType.RAW
      ? DestinationType.TCP
      : type;
function socketAddress(endpoint: string) {
  try {
    const url = new URL(endpoint.includes('://') ? endpoint : `tcp://${endpoint}`);
    if (!['tcp:', 'mllp:', 'mllps:'].includes(url.protocol)) throw new Error();
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port,
      tls: url.protocol === 'mllps:',
    };
  } catch {
    return { host: '', port: '', tls: false };
  }
}
function socketEndpoint(host: string, port: string, tls: boolean, mllp: boolean) {
  if (
    !host ||
    !/^\d+$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    /[\s/@?#]/.test(host) ||
    (tls && !mllp)
  )
    return '';
  try {
    const endpoint = `${tls ? 'mllps' : 'tcp'}://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
    const url = new URL(endpoint);
    return url.hostname && !url.username && !url.password && !url.search && !url.hash
      ? endpoint
      : '';
  } catch {
    return '';
  }
}
export function DestinationEditor({
  dest,
  index,
  onChange,
  onRemove,
  onEditScript,
  onFilterValidityChange,
  onTransformationValidityChange,
  onConfigurationErrorChange,
  inboundFormat,
  sourceFields = [],
  validationAttempt = 0,
}: Props) {
  const storedFilter = readDestinationFilter(dest.filterScript || '');
  const [retainedRule, setRetainedRule] = useState(storedFilter.rule);
  const [pendingFilterEnable, setPendingFilterEnable] = useState(false);
  const [filterValid, setFilterValid] = useState(!!storedFilter.rule.trim());
  const [filterStorageError, setFilterStorageError] = useState('');
  const [transformationOpen, setTransformationOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLElement>(null);
  const [transformationValid, setTransformationValid] = useState(true);
  const [socket, setSocket] = useState(() => socketAddress(dest.endpoint));
  const lastEndpoint = useRef(dest.endpoint);
  const transformationValidity = useRef(onTransformationValidityChange);
  transformationValidity.current = onTransformationValidityChange;
  const configurationErrorCallback = useRef(onConfigurationErrorChange);
  configurationErrorCallback.current = onConfigurationErrorChange;
  const socketConnector = dest.type !== DestinationType.REST;
  const mllpConnector = dest.type === DestinationType.MLLP || dest.type === DestinationType.HL7;
  const socketValid =
    !socketConnector || !!socketEndpoint(socket.host, socket.port, socket.tls, mllpConnector);
  const http = dest.deliveryPolicy?.http || {};
  const contentTypes = compatibleContentTypes(dest.outboundDataType || DataType.HL7V2);
  const httpIssues = destinationHttpIssues(http, dest.outboundDataType || DataType.JSON);
  const httpConfigurationValid = socketConnector || !httpIssues.first;
  const deliveryIssues = destinationDeliveryIssues(dest);
  const deliveryError = Object.values(deliveryIssues)[0] || '';
  const showIssue = (field: string) => validationAttempt > 0 || touched[field];
  function touch(field: string) {
    setTouched((current) => ({ ...current, [field]: true }));
  }
  useEffect(() => {
    if (!validationAttempt) return;
    if (
      !httpConfigurationValid ||
      deliveryError ||
      (filterEnabled && !filterValid) ||
      !transformationValid
    )
      setAdvancedOpen(true);
    if (!transformationValid) setTransformationOpen(true);
    const frame = requestAnimationFrame(() => {
      if (filterEnabled && !filterValid) {
        const section = root.current?.querySelector<HTMLDetailsElement>(
          'details[aria-label="Destination filter settings"]',
        );
        if (section) section.open = true;
      }
      const field = root.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      for (
        let parent = field?.parentElement;
        parent && parent !== root.current;
        parent = parent.parentElement
      ) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      field?.focus();
    });
    return () => cancelAnimationFrame(frame);
    // Only attempted navigation opens disclosures; normal edits retain their current state.
  }, [validationAttempt]);
  const lastFilter = useRef(dest.filterScript || '');
  const filterValidity = useRef(onFilterValidityChange);
  filterValidity.current = onFilterValidityChange;
  const filterEnabled = storedFilter.enabled || pendingFilterEnable;
  useEffect(() => {
    const script = dest.filterScript || '';
    if (script === lastFilter.current) return;
    lastFilter.current = script;
    const retained = readDestinationFilter(script);
    setRetainedRule(retained.rule);
    setPendingFilterEnable(false);
    setFilterValid(!!retained.rule.trim());
  }, [dest.filterScript]);
  useEffect(() => {
    filterValidity.current?.(!filterEnabled || filterValid);
  }, [filterEnabled, filterValid]);
  useEffect(() => {
    if (lastEndpoint.current === dest.endpoint) return;
    lastEndpoint.current = dest.endpoint;
    setSocket(socketAddress(dest.endpoint));
  }, [dest.endpoint]);
  useEffect(() => {
    configurationErrorCallback.current?.(
      !socketValid
        ? 'Enter a valid destination host and a port from 1 to 65535.'
        : !httpConfigurationValid
          ? httpIssues.security
            ? 'Correct the saved destination authentication or headers through the channel API.'
            : httpIssues.first
          : deliveryError,
    );
    transformationValidity.current?.(
      transformationValid && socketValid && httpConfigurationValid && !deliveryError,
    );
  }, [transformationValid, socketValid, httpConfigurationValid, httpIssues.first, deliveryError]);
  function changeHttp(changes: Partial<HttpSettings>) {
    onChange({ deliveryPolicy: { ...dest.deliveryPolicy, http: { ...http, ...changes } } });
  }
  function changeSocket(changes: Partial<typeof socket>) {
    const next = { ...socket, ...changes };
    setSocket(next);
    const endpoint = socketEndpoint(next.host, next.port, next.tls, mllpConnector);
    lastEndpoint.current = endpoint;
    onChange({ endpoint });
  }
  function storeFilter(rule: string, enabled: boolean) {
    try {
      const script = writeDestinationFilter(rule, enabled);
      lastFilter.current = script;
      onChange({ filterScript: script });
      setFilterStorageError('');
    } catch (error) {
      setFilterStorageError(
        error instanceof Error ? error.message : 'Unable to retain this destination filter.',
      );
    }
  }
  const deliveryConfigured = destinationDeliveryCustomized(dest);
  const responseConfigured = Boolean(dest.responseScript?.trim());
  const advancedConfigured =
    (filterEnabled && !!retainedRule.trim()) ||
    !!dest.processingScript?.trim() ||
    !!dest.templateScript?.trim() ||
    responseConfigured ||
    deliveryConfigured ||
    (!socketConnector && destinationHttpCustomized(http, dest.outboundDataType || DataType.JSON));
  return (
    <section className="destination-editor" ref={root}>
      <div className="section-header">
        <h3>Destination {index + 1}</h3>
        <div className="destination-actions">
          {(dest.id !== undefined || dest.isEnabled === false) && (
            <label className="check-field">
              <input
                type="checkbox"
                aria-label="Destination enabled"
                checked={dest.isEnabled !== false}
                onChange={(event) => onChange({ isEnabled: event.target.checked })}
              />
              Enabled
            </label>
          )}
          <button
            type="button"
            className="icon-btn danger"
            aria-label={`Remove destination ${index + 1}`}
            onClick={onRemove}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <label className="field">
        <span>Destination name *</span>
        <input
          aria-label="Destination name"
          aria-describedby={
            !dest.name.trim() && showIssue('name') ? `destination-${index}-name-error` : undefined
          }
          aria-invalid={!dest.name.trim() && !!showIssue('name')}
          onBlur={() => touch('name')}
          value={dest.name}
          maxLength={150}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        {!dest.name.trim() && showIssue('name') && (
          <small id={`destination-${index}-name-error`} className="field-error" role="alert">
            Destination name is required.
          </small>
        )}
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Connector</span>
          <select
            value={connectorValue(dest.type)}
            onChange={(e) => {
              const type = e.target.value as DestinationType;
              if ((type === DestinationType.REST) !== (dest.type === DestinationType.REST)) {
                setSocket({ host: '', port: '', tls: false });
                lastEndpoint.current = '';
                onChange({
                  type,
                  endpoint: '',
                  ...([DestinationType.HL7, DestinationType.MLLP].includes(type)
                    ? { outboundDataType: DataType.HL7V2 }
                    : {}),
                });
              } else if (
                socket.tls &&
                ![DestinationType.HL7, DestinationType.MLLP].includes(type)
              ) {
                setSocket({ host: '', port: '', tls: false });
                lastEndpoint.current = '';
                onChange({ type, endpoint: '' });
              } else
                onChange({
                  type,
                  ...([DestinationType.HL7, DestinationType.MLLP].includes(type)
                    ? { outboundDataType: DataType.HL7V2 }
                    : {}),
                });
            }}
          >
            <option value="REST">HTTP sender</option>
            <option value="MLLP">MLLP sender</option>
            <optgroup label="Advanced connector">
              <option value="TCP">TCP sender</option>
            </optgroup>
          </select>
        </label>
        <label className="field">
          <span>Outbound format</span>
          <select
            value={dest.outboundDataType}
            onChange={(e) =>
              onChange({
                outboundDataType: e.target.value as DataType,
              })
            }
          >
            {mllpConnector && dest.outboundDataType && dest.outboundDataType !== DataType.HL7V2 && (
              <option value={dest.outboundDataType}>
                {dest.outboundDataType} — legacy configuration
              </option>
            )}
            {(mllpConnector ? [DataType.HL7V2] : dataOptions).map((t) => (
              <option key={t} value={t}>
                {t === DataType.HL7V2 ? 'HL7 v2' : t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {dest.type === DestinationType.REST ? (
        <>
          <div className="field">
            <label htmlFor={`destination-endpoint-${index}`}>Endpoint *</label>
            <input
              id={`destination-endpoint-${index}`}
              aria-invalid={!dest.endpoint.trim() && !!showIssue('endpoint')}
              onBlur={() => touch('endpoint')}
              value={dest.endpoint}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                dest.type === 'REST' ? 'https://api.example.com/messages' : 'tcp://host:2575'
              }
              onChange={(e) => onChange({ endpoint: e.target.value })}
            />
            {!dest.endpoint.trim() && showIssue('endpoint') && (
              <small className="field-error" role="alert">
                Endpoint is required.
              </small>
            )}
          </div>
        </>
      ) : (
        <div className="socket-destination form-section">
          <div className="form-grid">
            <label className="field">
              <span>Host</span>
              <input
                value={socket.host}
                maxLength={253}
                placeholder="receiver.example.org"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => changeSocket({ host: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Port</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={socket.port}
                placeholder="2575"
                onChange={(event) => changeSocket({ port: event.target.value })}
              />
            </label>
          </div>
          {mllpConnector && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={socket.tls}
                onChange={(event) => changeSocket({ tls: event.target.checked })}
              />
              Use TLS
            </label>
          )}
          {(socket.host || socket.port) && !socketValid && (
            <p className="field-error" role="alert">
              Enter a valid host and a port from 1 to 65535.
            </p>
          )}
          <p className="muted">
            {[DestinationType.HL7, DestinationType.MLLP].includes(dest.type)
              ? 'MLLP framing is applied automatically. Delivery requires a matching AA acknowledgment; AE/AR, control ID mismatch and timeout remain delivery errors.'
              : 'Raw TCP sender. MLLP framing and HL7 acknowledgment are not applied.'}
          </p>
          {!socket.tls && (
            <small>
              Plaintext transport is intended for a trusted isolated network. Use TLS for protected
              transport.
            </small>
          )}
        </div>
      )}
      <TransformationEditor
        inboundFormat={(inboundFormat as DataType) || DataType.JSON}
        outboundFormat={dest.outboundDataType}
        sourceFields={sourceFields}
        context="destination"
        processingScript={dest.processingScript || ''}
        onScriptChange={(script) => onChange({ processingScript: script })}
        onValidityChange={(valid) => {
          setTransformationValid(valid);
        }}
        renderLayout={(main, scriptSettings, hl7Settings) => (
          <>
            <details
              className="advanced-section"
              aria-label="Advanced destination settings"
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary>
                <span>Advanced destination settings</span>
                {(!httpConfigurationValid ||
                  !!deliveryError ||
                  !transformationValid ||
                  (filterEnabled && !filterValid)) &&
                validationAttempt > 0 ? (
                  <small> · Check settings</small>
                ) : advancedConfigured ? (
                  <small> · Customized</small>
                ) : null}
              </summary>
              {dest.credentialConfigured && (
                <p className="muted">
                  Saved endpoint credentials are retained only while this endpoint is unchanged.
                </p>
              )}
              {!socketConnector &&
              ((http.authentication && http.authentication !== 'NONE') || http.headers?.length) ? (
                <p className="muted">Saved destination security settings are retained.</p>
              ) : null}
              {!socketConnector && httpIssues.security && validationAttempt > 0 && (
                <p className="field-error" role="alert">
                  Correct the saved destination authentication or headers through the channel API.
                </p>
              )}
              <details
                className="advanced-section"
                aria-label="Destination transformation settings"
                open={transformationOpen}
                onToggle={(event) => setTransformationOpen(event.currentTarget.open)}
              >
                <summary>
                  Transformation{dest.processingScript?.trim() && <small> · Configured</small>}
                </summary>
                <section
                  className="form-section"
                  role="region"
                  aria-label={`Transformation · ${dest.name || `Destination ${index + 1}`}`}
                >
                  {main}
                  {scriptSettings}
                </section>
                {!!dest.templateScript?.trim() && (
                  <details
                    className="advanced-section"
                    aria-label="Legacy destination output script"
                  >
                    <summary>Legacy output script · Active</summary>
                    <p className="muted">
                      This saved sandboxed script receives msg after destination transformation and
                      before format conversion. Its return value replaces the outbound payload. It
                      is retained separately for compatibility; Review &amp; Test shows the final
                      result.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setTransformationOpen(false);
                        onEditScript({
                          destination: index,
                          field: 'templateScript',
                          title: 'Legacy destination output script',
                        });
                      }}
                    >
                      Edit legacy output script
                    </Button>
                  </details>
                )}
              </details>
              <details className="advanced-section" aria-label="Destination filter settings">
                <summary>
                  Filter{' '}
                  <small>
                    ·{' '}
                    {!filterEnabled
                      ? 'Off'
                      : filterValid && retainedRule.trim()
                        ? 'Configured'
                        : 'Needs configuration'}
                  </small>
                </summary>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={filterEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setPendingFilterEnable(enabled && !retainedRule.trim());
                      storeFilter(retainedRule, enabled);
                    }}
                  />
                  Enable destination filter
                </label>
                {filterStorageError && (
                  <p className="alert error" role="alert">
                    {filterStorageError}
                  </p>
                )}
                <div
                  style={{ display: filterEnabled ? 'block' : 'none' }}
                  aria-hidden={!filterEnabled}
                >
                  <FilterEditor
                    kind="destination"
                    value={retainedRule}
                    onChange={(script) => {
                      setRetainedRule(script);
                      setPendingFilterEnable(false);
                      storeFilter(script, filterEnabled);
                    }}
                    onValidityChange={setFilterValid}
                    sourceFields={sourceFields}
                    allowAdvanced
                  />
                </div>
              </details>
              <details className="advanced-section" aria-label="Delivery settings">
                <summary>Delivery{deliveryConfigured && <small> · Customized</small>}</summary>
                {!socketConnector && (
                  <>
                    <label className="field">
                      <span>Content-Type</span>
                      <select
                        aria-label="Content-Type"
                        aria-invalid={!!httpIssues.contentType && !!showIssue('contentType')}
                        aria-describedby={
                          httpIssues.contentType && showIssue('contentType')
                            ? `destination-${index}-content-error`
                            : undefined
                        }
                        onBlur={() => touch('contentType')}
                        value={http.contentType || ''}
                        onChange={(event) =>
                          changeHttp({
                            contentType:
                              (event.target.value as HttpSettings['contentType']) || undefined,
                          })
                        }
                      >
                        <option value="">Automatic ({contentTypes[0]})</option>
                        {http.contentType && !contentTypes.includes(http.contentType) && (
                          <option value={http.contentType}>
                            {http.contentType} — select a compatible type
                          </option>
                        )}
                        {contentTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                      {showIssue('contentType') && httpIssues.contentType && (
                        <small
                          id={`destination-${index}-content-error`}
                          className="field-error"
                          role="alert"
                        >
                          {httpIssues.contentType}
                        </small>
                      )}
                    </label>
                  </>
                )}
                {dest.type === DestinationType.REST && (
                  <>
                    <label className="field">
                      <span>HTTP method</span>
                      <select
                        aria-label="HTTP method"
                        value={http.method || 'POST'}
                        onChange={(event) =>
                          changeHttp({ method: event.target.value as HttpSettings['method'] })
                        }
                      >
                        <option>POST</option>
                        <option>PUT</option>
                        <option>PATCH</option>
                      </select>
                      {httpIssues.method && validationAttempt > 0 && (
                        <small className="field-error" role="alert">
                          {httpIssues.method}
                        </small>
                      )}
                    </label>
                  </>
                )}
                <label className="field">
                  <span>Request timeout (seconds)</span>
                  <input
                    aria-label="Request timeout (seconds)"
                    aria-describedby={
                      deliveryIssues.timeoutMs && showIssue('timeoutMs')
                        ? `destination-${index}-timeoutMs-error`
                        : undefined
                    }
                    aria-invalid={!!deliveryIssues.timeoutMs && !!showIssue('timeoutMs')}
                    onBlur={() => touch('timeoutMs')}
                    type="number"
                    min={0.1}
                    max={120}
                    step={0.001}
                    value={(dest.timeoutMs ?? 10000) / 1000}
                    onChange={(e) =>
                      onChange({ timeoutMs: Math.round(Number(e.target.value) * 1000) })
                    }
                  />
                  {showIssue('timeoutMs') && deliveryIssues.timeoutMs && (
                    <small
                      id={`destination-${index}-timeoutMs-error`}
                      className="field-error"
                      role="alert"
                    >
                      {deliveryIssues.timeoutMs}
                    </small>
                  )}
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={!!dest.retryEnabled}
                    onChange={(e) => onChange({ retryEnabled: e.target.checked })}
                  />
                  Automatic retry
                </label>
                {(dest.retryEnabled ||
                  deliveryIssues.maxRetries ||
                  deliveryIssues.retryIntervalSeconds) && (
                  <div className="form-grid">
                    <label className="field">
                      <span>Retry attempts</span>
                      <input
                        aria-label="Retry attempts"
                        aria-describedby={
                          deliveryIssues.maxRetries && showIssue('maxRetries')
                            ? `destination-${index}-maxRetries-error`
                            : undefined
                        }
                        aria-invalid={!!deliveryIssues.maxRetries && !!showIssue('maxRetries')}
                        onBlur={() => touch('maxRetries')}
                        type="number"
                        min={0}
                        max={10}
                        value={dest.maxRetries ?? 3}
                        onChange={(e) => onChange({ maxRetries: Number(e.target.value) })}
                      />
                      {showIssue('maxRetries') && deliveryIssues.maxRetries && (
                        <small
                          id={`destination-${index}-maxRetries-error`}
                          className="field-error"
                          role="alert"
                        >
                          {deliveryIssues.maxRetries}
                        </small>
                      )}
                    </label>
                    <label className="field">
                      <span>Retry interval (seconds)</span>
                      <input
                        aria-label="Retry interval (seconds)"
                        aria-describedby={
                          deliveryIssues.retryIntervalSeconds && showIssue('retryIntervalSeconds')
                            ? `destination-${index}-retryIntervalSeconds-error`
                            : undefined
                        }
                        aria-invalid={
                          !!deliveryIssues.retryIntervalSeconds &&
                          !!showIssue('retryIntervalSeconds')
                        }
                        onBlur={() => touch('retryIntervalSeconds')}
                        type="number"
                        min={1}
                        max={86400}
                        value={dest.retryIntervalSeconds ?? 30}
                        onChange={(e) =>
                          onChange({
                            retryIntervalSeconds: Number(e.target.value),
                          })
                        }
                      />
                      {showIssue('retryIntervalSeconds') && deliveryIssues.retryIntervalSeconds && (
                        <small
                          id={`destination-${index}-retryIntervalSeconds-error`}
                          className="field-error"
                          role="alert"
                        >
                          {deliveryIssues.retryIntervalSeconds}
                        </small>
                      )}
                    </label>
                  </div>
                )}
                <details className="advanced-section">
                  <summary>Expert delivery settings</summary>
                  <div className="form-grid">
                    {(
                      [
                        ['failureThreshold', 'Circuit failure threshold', 100],
                        ['openSeconds', 'Circuit open duration (seconds)', 3600],
                        ['maxConcurrency', 'Destination concurrency limit', 100],
                      ] as const
                    ).map(([key, label, max]) => (
                      <label className="field" key={key}>
                        <span>{label}</span>
                        <input
                          aria-label={label}
                          type="number"
                          min={1}
                          max={max}
                          placeholder="Deployment default"
                          aria-invalid={!!deliveryIssues[key] && !!showIssue(key)}
                          onBlur={() => touch(key)}
                          value={dest.deliveryPolicy?.[key] ?? ''}
                          onChange={(e) =>
                            onChange({
                              deliveryPolicy: {
                                ...dest.deliveryPolicy,
                                [key]: e.target.value ? Number(e.target.value) : undefined,
                              },
                            })
                          }
                        />
                        {showIssue(key) && deliveryIssues[key] && (
                          <small
                            id={`destination-${index}-${key}-error`}
                            className="field-error"
                            role="alert"
                          >
                            {deliveryIssues[key]}
                          </small>
                        )}
                      </label>
                    ))}
                  </div>
                </details>
              </details>
              {hl7Settings}
              {responseConfigured && <small>Legacy custom destination response is active.</small>}
            </details>
          </>
        )}
      />
    </section>
  );
}
