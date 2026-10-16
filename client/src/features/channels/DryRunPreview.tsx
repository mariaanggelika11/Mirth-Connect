export interface DryRunResult {
  success: boolean;
  accepted: boolean;
  elapsedMs: number;
  input?: { format: string; payload: unknown };
  source?: {
    format: string;
    payload: unknown;
    validation: string;
    filter: string;
    transformation: string;
    code?: string;
  };
  networkDelivery?: string;
  warnings?: string[];
  results: {
    destinationId?: number;
    name: string;
    routed?: boolean;
    finalPayload?: unknown;
    outputFormat?: string;
    connectorType?: string;
    status: string;
    code?: string;
    elapsedMs?: number;
    stages?: Record<string, string>;
  }[];
}
function payloadText(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
const stageLabels: Record<string, string> = {
  PASSED: 'Passed',
  ACCEPTED: 'Accepted',
  FILTERED: 'Filtered',
  PASS_THROUGH: 'Pass-through',
  TRANSFORMED: 'Custom transformation applied',
  SKIPPED: 'Skipped',
  APPLIED: 'Applied',
  CONVERTED: 'Converted',
  NOT_CONFIGURED: 'Not configured',
  ERROR: 'Failed',
};
export function DryRunPreview({ result }: { result: DryRunResult }) {
  return (
    <div className="dry-run-preview" aria-label="Output preview" role="status">
      <div className={`alert ${result.success ? '' : 'error'}`}>
        <strong>Network delivery: {result.networkDelivery || 'NOT_SENT'}</strong>
        <p>
          {result.success ? 'Preview completed' : 'Validation failed'} in {result.elapsedMs} ms. No
          message was sent. Destination responses are available after a real delivery in Messages.
        </p>
      </div>
      {result.input && (
        <section className="preview-stage" aria-label="Preview input">
          <h4>1. Original inbound payload · {result.input.format}</h4>
          <pre className="code-box">{payloadText(result.input.payload)}</pre>
        </section>
      )}
      {result.source && (
        <section className="preview-stage" aria-label="Preview source processing">
          <h4>2. Source processing · {result.source.format}</h4>
          <dl className="definition-list">
            <div>
              <dt>Source validation</dt>
              <dd>{stageLabels[result.source.validation] || result.source.validation}</dd>
            </div>
            <div>
              <dt>Source filter</dt>
              <dd>{stageLabels[result.source.filter] || result.source.filter}</dd>
            </div>
            <div>
              <dt>Source transformation</dt>
              <dd>{stageLabels[result.source.transformation] || result.source.transformation}</dd>
            </div>
          </dl>
          {result.source.code && (
            <p className="alert error">
              Source processing failed: {result.source.code}. Check the input format, validation
              rules and source scripts.
            </p>
          )}
          <pre className="code-box">{payloadText(result.source.payload)}</pre>
        </section>
      )}
      <section className="preview-stage" aria-label="Preview destination processing">
        <h4>3. Outbound deliveries</h4>
        {!result.results.length && (
          <p>
            {result.success
              ? 'No outbound destinations configured.'
              : 'Destination processing was skipped because source processing failed.'}
          </p>
        )}
        {result.results.map((destination, index) => (
          <div
            className="review-destination preview-destination"
            key={destination.destinationId ?? index}
          >
            <div>
              <strong>{destination.name}</strong>
              <p>
                Output format: {destination.outputFormat || 'Configured destination format'}
                {destination.connectorType ? ` over ${destination.connectorType}` : ''}
              </p>
              {destination.status === 'ERROR' ? (
                <p className="alert error">
                  Preview failed: {destination.code || 'DESTINATION_INVALID'}
                </p>
              ) : destination.routed === false ? (
                <p>Not routed: the message was filtered or this destination is disabled.</p>
              ) : (
                <>
                  {destination.stages && (
                    <dl className="definition-list">
                      {Object.entries(destination.stages).map(([name, status]) => (
                        <div key={name}>
                          <dt>{name.charAt(0).toUpperCase() + name.slice(1)}</dt>
                          <dd>{stageLabels[status] || status}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p>Generated outbound payload</p>
                  <pre className="code-box">{payloadText(destination.finalPayload)}</pre>
                </>
              )}
            </div>
          </div>
        ))}
      </section>
      {result.warnings?.map((warning, index) => (
        <p className="muted" key={index}>
          {warning}
        </p>
      ))}
    </div>
  );
}
