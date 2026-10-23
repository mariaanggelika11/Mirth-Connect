import { Button } from '../../components/ui/Button';
import type { DataType, Destination } from '../../types';
import { DestinationConnectionTest } from './DestinationConnectionTest';
import { PayloadPreview } from './PayloadPreview';
import { formatSample } from './testSamples';
import { DryRunPreview, destinationPreviewReason, type DryRunResult } from './DryRunPreview';

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
  canViewRaw: boolean;
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
  canViewRaw,
}: Props) {
  const result = suppliedResult?.rawPayload && !canViewRaw ? null : suppliedResult;
  return (
    <details className="advanced-section review-test" aria-label="Optional configuration test">
      <summary>
        Test configuration <small>Optional</small>
      </summary>
      <section className="form-section review-test-content" aria-label="Review and test">
        <label className="field">
          <span>Test input · {inboundFormat}</span>
          <textarea
            className="code-input"
            rows={4}
            spellCheck={false}
            value={sample}
            onChange={(event) => onSampleChange(event.target.value)}
          />
          <small>Use synthetic data. No message will be sent.</small>
        </label>
        <details className="validation-help">
          <summary>Input help</summary>
          <p>
            Use fields that match your configuration. The example may need changes to pass your
            rules.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onSampleChange(formatSample(inboundFormat))}
          >
            Load sample
          </Button>
        </details>
        <div className="heading-actions">
          <Button type="button" disabled={testing} onClick={onTest}>
            {testing ? 'Testing…' : 'Run Test'}
          </Button>
        </div>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <section className="preview-stage" aria-label="Generated output">
            <h3>Test result</h3>
            <div role="status">
              <p>
                Status:{' '}
                {!result.success
                  ? 'Failed'
                  : result.accepted
                    ? 'Transformation successful'
                    : 'Filtered'}{' '}
                · {result.elapsedMs} ms. No message was sent.
              </p>
              {!result.success && result.source?.code && (
                <p className="alert error" role="alert">
                  {result.source.message ||
                    'Check the source validation rules, required mapping fields and transformation script.'}
                </p>
              )}
              {result.success && !result.accepted && (
                <p className="muted">This input was filtered. No outbound message was created.</p>
              )}
              {result.accepted && !destinations.length && (
                <p className="muted">Receive-only channel. No outbound delivery is configured.</p>
              )}
              {result.accepted &&
                !!destinations.length &&
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
                    <p className="muted">{destinationPreviewReason(destination)}</p>
                  ) : (
                    <PayloadPreview
                      payload={destination.finalPayload}
                      format={destination.outputFormat}
                      fields={destination.fieldTree}
                      copyable
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        <details className="advanced-section">
          <summary>Advanced test options</summary>
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
    </details>
  );
}
