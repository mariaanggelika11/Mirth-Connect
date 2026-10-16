import { Code2, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { DataType, DestinationType } from '../../types';
import type { Destination } from '../../types';
import type { ChannelScriptEditor } from './channelDraft';
import { FilterEditor } from './FilterEditor';
interface Props {
  dest: Destination;
  index: number;
  onChange: (values: Partial<Destination>) => void;
  onRemove: () => void;
  onEditScript: (editor: ChannelScriptEditor) => void;
  onFilterValidityChange?: (valid: boolean) => void;
  inboundFormat?: string;
}
const dataOptions = Object.values(DataType);
export function DestinationEditor({
  dest,
  index,
  onChange,
  onRemove,
  onEditScript,
  onFilterValidityChange,
  inboundFormat,
}: Props) {
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
        <input
          id={`destination-endpoint-${index}`}
          value={dest.endpoint}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            dest.type === 'REST' ? 'https://api.example.com/messages' : 'tcp://host:2575'
          }
          onChange={(e) => onChange({ endpoint: e.target.value })}
        />
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
        <details className="advanced-section" aria-label="Destination filter settings">
          <summary>
            Destination filter{dest.filterScript?.trim() && <small> · Configured</small>}
          </summary>
          <FilterEditor
            kind="destination"
            value={dest.filterScript || ''}
            onChange={(script) => onChange({ filterScript: script })}
            onValidityChange={onFilterValidityChange}
          />
        </details>
        <details className="advanced-section" aria-label="Destination transformer settings">
          <summary>
            Destination transformer
            {(dest.processingScript?.trim() || dest.templateScript?.trim()) && (
              <small> · Configured</small>
            )}
          </summary>
          <p className="muted">
            {dest.processingScript?.trim()
              ? 'Custom transformation configured'
              : 'No additional transformation'}
          </p>
          <div className="heading-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                onEditScript({
                  destination: index,
                  field: 'processingScript',
                  title: 'Destination transformer',
                })
              }
            >
              <Code2 size={14} />
              Configure transformation
            </Button>
          </div>
          <details className="advanced-section">
            <summary>
              Advanced template{dest.templateScript?.trim() && <small> · Configured</small>}
            </summary>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                onEditScript({
                  destination: index,
                  field: 'templateScript',
                  title: 'Destination template',
                })
              }
            >
              <Code2 size={14} />
              {dest.templateScript ? 'Edit template' : 'Add template'}
            </Button>
          </details>
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
        {responseConfigured && <small>Legacy custom destination response is active.</small>}
      </details>
    </section>
  );
}
