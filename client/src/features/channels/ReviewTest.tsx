import { Button } from '../../components/ui/Button';
import { ValidationResults } from '../../components/ui/ValidationResults';
import type { DataType, Destination } from '../../types';
import { DestinationConnectionTest } from './DestinationConnectionTest';
import { DryRunPreview, previewStageLabels, type DryRunResult } from './DryRunPreview';

interface Props {
  inboundFormat: DataType;
  destinations: Destination[];
  sample: string;
  onSampleChange: (value: string) => void;
  onTest: () => void;
  result: DryRunResult | null;
  testing: boolean;
  error: string;
  configurationError: string;
  rawPreview: boolean;
  onRawPreviewChange: (value: boolean) => void;
  canViewRaw: boolean;
}

function payloadText(payload: unknown) {
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

export function ReviewTest({
  inboundFormat,
  destinations,
  sample,
  onSampleChange,
  onTest,
  result: suppliedResult,
  testing,
  error,
  configurationError,
  rawPreview,
  onRawPreviewChange,
  canViewRaw,
}: Props) {
  const result = rawPreview && !canViewRaw ? null : suppliedResult;
  return (
    <section className="form-section" aria-label="Review and test">
      <h3>Test your integration</h3>
      <label className="field">
        <span>Test input · {inboundFormat}</span>
        <textarea
          className="code-input"
          rows={7}
          spellCheck={false}
          value={sample}
          onChange={(event) => onSampleChange(event.target.value)}
        />
        <small>Use synthetic data. This test does not send a message.</small>
      </label>
      <div>
        <Button type="button" variant="secondary" disabled={testing} onClick={onTest}>
          {testing ? 'Testing…' : 'Test Transformation'}
        </Button>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <section className="preview-stage" aria-label="Generated output">
        <h3>Generated output</h3>
        {!result && <p className="muted">Run the test to see the output for each destination.</p>}
        {result && (
          <div role="status">
            <p>
              {result.success ? 'Test completed' : 'Test failed'} · {result.elapsedMs} ms. No
              message was sent.
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
            <ValidationResults results={result.source?.validationResults} />
            {!result.success && result.source?.code && (
              <p className="alert error" role="alert">
                {result.source.message ||
                  'Check the source validation rules, required mapping fields and transformation script.'}
              </p>
            )}
            {result.success && !result.accepted && (
              <p className="muted">This input was filtered. No outbound message was created.</p>
            )}
            {result.accepted &&
              !result.results.some((destination) => destination.routed !== false) && (
                <p className="muted">No destination accepted this message.</p>
              )}
            {result.results.map((destination, index) => (
              <div className="transformation-output" key={destination.destinationId ?? index}>
                <strong>{destination.name || `Destination ${index + 1}`}</strong>
                <span className="muted"> · {destination.outputFormat}</span>
                {destination.status === 'ERROR' ? (
                  <p className="alert error" role="alert">
                    {destination.message ||
                      'Check this destination’s output format and transformation settings.'}
                  </p>
                ) : destination.routed === false ? (
                  <p className="muted">
                    Not routed: this destination is disabled or its filter did not match.
                  </p>
                ) : (
                  <pre className="code-box">{payloadText(destination.finalPayload)}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <details className="advanced-section">
        <summary>Advanced test options</summary>
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
        {!rawPreview && <small>Preview values follow privacy settings.</small>}
        {result && (
          <details className="advanced-section">
            <summary>Processing details</summary>
            <DryRunPreview result={result} />
          </details>
        )}
        {!!destinations.length && (
          <div className="form-section">
            <h4>Destination connection checks</h4>
            <p className="muted">
              Optional TCP/TLS handshake. This checks connectivity without sending a message.
            </p>
            {configurationError && (
              <p className="muted">
                Complete Source, Transformation and Destinations before checking connections.
              </p>
            )}
            {destinations.map((destination, index) => (
              <DestinationConnectionTest
                key={destination.id ?? index}
                destination={destination}
                disabled={testing || !!configurationError}
              />
            ))}
          </div>
        )}
      </details>
    </section>
  );
}
