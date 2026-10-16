import { Code2, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { DataType, DestinationType } from '../../types';
import type { Destination } from '../../types';
import type { ChannelScriptEditor } from './channelDraft';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { FilterEditor } from './FilterEditor';
interface Props {
  dest: Destination;
  index: number;
  onChange: (values: Partial<Destination>) => void;
  onRemove: () => void;
  onEditScript: (editor: ChannelScriptEditor) => void;
  inboundFormat?: string;
}
const dataOptions = Object.values(DataType);
interface ConnectionResult {
  reachable: boolean;
  secure: boolean;
  elapsedMs: number;
  probe: 'TCP_HANDSHAKE' | 'TLS_HANDSHAKE';
  applicationDeliveryTested: false;
  warnings?: string[];
}
export function DestinationEditor({
  dest,
  index,
  onChange,
  onRemove,
  onEditScript,
  inboundFormat,
}: Props) {
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ConnectionResult | null>(null);
  const [probeError, setProbeError] = useState('');
  const processingConfigured = Boolean(
    dest.filterScript?.trim() || dest.processingScript?.trim() || dest.templateScript?.trim(),
  );
  const deliveryConfigured =
    dest.isEnabled === false ||
    Boolean(dest.retryEnabled) ||
    (dest.timeoutMs !== undefined && dest.timeoutMs !== 10000) ||
    (dest.maxRetries !== undefined && dest.maxRetries !== 3) ||
    (dest.retryIntervalSeconds !== undefined && dest.retryIntervalSeconds !== 30) ||
    Object.values(dest.deliveryPolicy ?? {}).some((value) => value !== undefined);
  const responseConfigured = Boolean(dest.responseScript?.trim());
  const advancedConfigured = processingConfigured || deliveryConfigured || responseConfigured;
  const probeTarget = JSON.stringify([dest.endpoint, dest.type, dest.timeoutMs]);
  const currentTarget = useRef(probeTarget);
  currentTarget.current = probeTarget;
  useEffect(() => {
    setProbeResult(null);
    setProbeError('');
  }, [dest.endpoint, dest.type, dest.timeoutMs]);
  async function testConnection() {
    const target = probeTarget;
    setProbing(true);
    setProbeResult(null);
    setProbeError('');
    try {
      const { data } = await api.post<ConnectionResult>('/channel/test-connection', {
        endpoint: dest.endpoint,
        type: dest.type,
        timeoutMs: Math.min(dest.timeoutMs ?? 10000, 10000),
      });
      if (currentTarget.current === target) setProbeResult(data);
    } catch (error) {
      if (currentTarget.current === target)
        setProbeError(error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setProbing(false);
    }
  }
  return (
    <section className="destination-editor">
      <div className="section-header">
        <h3>
          <span className="step-number">{index + 1}</span>
          {dest.name || 'New destination'}
        </h3>
        <button
          type="button"
          className="icon-btn danger"
          aria-label={`Remove destination ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 size={16} />
        </button>
      </div>
      <label className="field">
        <span>Destination name *</span>
        <input
          value={dest.name}
          maxLength={150}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Connector</span>
          <select
            value={dest.type}
            onChange={(e) => onChange({ type: e.target.value as DestinationType })}
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
              onChange({
                outboundDataType: e.target.value as DataType,
              })
            }
          >
            {dataOptions.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          {inboundFormat && (
            <small>
              {inboundFormat} → {dest.outboundDataType}
            </small>
          )}
        </label>
      </div>
      <div className="field">
        <label htmlFor={`destination-endpoint-${index}`}>Endpoint *</label>
        <div className="destination-endpoint-row">
          <input
            id={`destination-endpoint-${index}`}
            value={dest.endpoint}
            autoComplete="off"
            spellCheck={false}
            placeholder={
              dest.type === 'REST' ? 'https://api.example.com/messages' : 'tcp://host:2575'
            }
            disabled={probing}
            onChange={(e) => onChange({ endpoint: e.target.value })}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            title="Checks TCP/TLS without sending a message or patient data (up to 10 seconds)."
            disabled={probing || !dest.endpoint.trim()}
            onClick={() => void testConnection()}
          >
            {probing ? 'Testing connection…' : 'Test connection'}
          </Button>
        </div>
      </div>
      <div className="connection-test">
        {probeError && (
          <p className="alert error" role="alert">
            Connection failed: {probeError}
          </p>
        )}
        {probeResult && (
          <div className={`alert ${probeResult.reachable ? 'success' : 'error'}`} role="status">
            <strong>{probeResult.reachable ? 'Endpoint reachable' : 'Connection failed'}</strong>
            <p>
              {probeResult.probe === 'TLS_HANDSHAKE' ? 'TLS' : 'TCP'} handshake · Response time:{' '}
              {probeResult.elapsedMs} ms.
            </p>
            <p>Connectivity only; no message was sent. Use synthetic data to verify delivery.</p>
            {probeResult.warnings?.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
      </div>
      {dest.credentialConfigured && (
        <p className="muted">
          Credentials are retained for an unchanged URL. Re-enter them when changing this endpoint.
        </p>
      )}
      <details className="advanced-section">
        <summary>
          <span>Advanced destination settings</span>
          {advancedConfigured && <small> · Configured</small>}
        </summary>
        <details className="advanced-section" aria-label="Destination message processing">
          <summary>
            Message processing{processingConfigured && <small> · Configured</small>}
          </summary>
          <FilterEditor
            kind="destination"
            value={dest.filterScript || ''}
            onChange={(script) => onChange({ filterScript: script })}
          />
          <div className="heading-actions">
            {(['processingScript', 'templateScript'] as const).map((field) => (
              <Button
                key={field}
                type="button"
                variant="secondary"
                onClick={() =>
                  onEditScript({
                    destination: index,
                    field,
                    title:
                      field === 'processingScript'
                        ? 'Destination transformer'
                        : 'Destination template',
                  })
                }
              >
                <Code2 size={14} />
                {field === 'processingScript'
                  ? dest.processingScript
                    ? 'Edit destination transformation'
                    : 'Add destination transformation'
                  : dest.templateScript
                    ? 'Edit template'
                    : 'Add template'}
              </Button>
            ))}
          </div>
        </details>
        <details className="advanced-section" aria-label="Delivery settings">
          <summary>Delivery settings{deliveryConfigured && <small> · Configured</small>}</summary>
          <label className="field">
            <span>Request timeout (seconds)</span>
            <input
              type="number"
              min={0.1}
              max={120}
              step={0.001}
              value={(dest.timeoutMs ?? 10000) / 1000}
              onChange={(e) => onChange({ timeoutMs: Math.round(Number(e.target.value) * 1000) })}
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={dest.isEnabled !== false}
              onChange={(e) => onChange({ isEnabled: e.target.checked })}
            />
            Destination enabled
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={!!dest.retryEnabled}
              onChange={(e) => onChange({ retryEnabled: e.target.checked })}
            />
            Automatic retry
          </label>
          {dest.retryEnabled && (
            <div className="form-grid">
              <label className="field">
                <span>Retry attempts</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={dest.maxRetries ?? 3}
                  onChange={(e) => onChange({ maxRetries: Number(e.target.value) })}
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
                    onChange({
                      retryIntervalSeconds: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          )}
          <details className="advanced-section">
            <summary>Capacity and circuit protection</summary>
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
                    type="number"
                    min={1}
                    max={max}
                    placeholder="Deployment default"
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
                </label>
              ))}
            </div>
          </details>
        </details>
        <details className="advanced-section" aria-label="Destination response processing">
          <summary>Response processing{responseConfigured && <small> · Configured</small>}</summary>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              onEditScript({
                destination: index,
                field: 'responseScript',
                title: 'Destination response',
              })
            }
          >
            <Code2 size={14} />
            {dest.responseScript ? 'Edit response script' : 'Configure custom response'}
          </Button>
        </details>
      </details>
    </section>
  );
}
