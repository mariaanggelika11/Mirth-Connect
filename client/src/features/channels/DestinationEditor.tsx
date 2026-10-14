import { Code2, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { DataType, DestinationType } from '../../types';
import type { Destination } from '../../types';
import type { ChannelScriptEditor } from './channelDraft';
interface Props {
  dest: Destination;
  index: number;
  onChange: (values: Partial<Destination>) => void;
  onRemove: () => void;
  onEditScript: (editor: ChannelScriptEditor) => void;
}
const dataOptions = Object.values(DataType);
export function DestinationEditor({ dest, index, onChange, onRemove, onEditScript }: Props) {
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
        </label>
      </div>
      <label className="field">
        <span>Endpoint *</span>
        <input
          value={dest.endpoint}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            dest.type === 'REST' ? 'https://api.example.com/messages' : 'tcp://host:2575'
          }
          onChange={(e) => onChange({ endpoint: e.target.value })}
        />
      </label>
      {dest.credentialConfigured && (
        <p className="muted">
          Credentials are retained for an unchanged URL. Re-enter them when changing this endpoint.
        </p>
      )}
      <details className="advanced-section">
        <summary>Advanced · scripts, retries & timeout</summary>
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
          <label className="field">
            <span>Timeout (milliseconds)</span>
            <input
              type="number"
              min={100}
              max={120000}
              value={dest.timeoutMs ?? 10000}
              onChange={(e) => onChange({ timeoutMs: Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="field">
          <span>Destination filter</span>
          <textarea
            rows={4}
            className="code-input"
            value={dest.filterScript || ''}
            onChange={(e) => onChange({ filterScript: e.target.value })}
          />
        </label>
        <div className="heading-actions">
          {(['processingScript', 'responseScript', 'templateScript'] as const).map((field) => (
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
          ))}
        </div>
      </details>
    </section>
  );
}
