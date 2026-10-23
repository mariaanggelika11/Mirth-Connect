import type { ValidationRuleResult } from '../../../../server/src/utils/validationRules';
import { ValidationResults } from '../../components/ui/ValidationResults';
import { PayloadPreview } from './PayloadPreview';
import type { FieldOption } from '../../components/ui/FieldExplorer';

export interface DryRunResult {
  rawPayload?: boolean;
  success: boolean;
  accepted: boolean;
  elapsedMs: number;
  input?: { format: string; payload: unknown };
  parsedInput?: { format: string; payload: unknown };
  source?: {
    format: string;
    payload: unknown;
    validation: string;
    validationResults?: ValidationRuleResult[];
    filter: string;
    transformation: string;
    code?: string;
    message?: string;
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
    message?: string;
    elapsedMs?: number;
    stages?: Record<string, string>;
    fieldTree?: FieldOption[];
    enabled?: boolean;
    delivery?: 'NOT_SENT' | 'FILTERED' | 'DISABLED' | 'SOURCE_FILTERED' | 'NOT_SENT_ERROR';
  }[];
}
function payloadText(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
export const previewStageLabels: Record<string, string> = {
  PASSED: 'Passed',
  ACCEPTED: 'Accepted',
  FILTERED: 'Filtered',
  PASS_THROUGH: 'Pass-through',
  TRANSFORMED: 'Transformed',
  SKIPPED: 'Not run',
  APPLIED: 'Applied',
  CONVERTED: 'Converted',
  NOT_CONFIGURED: 'Not configured',
  ERROR: 'Failed',
  BYPASSED: 'Disabled',
  MATCHED: 'Matched',
  NOT_MATCHED: 'Not matched',
  NOT_RUN: 'Not run',
  UNKNOWN: 'Not recorded',
  NOT_SENT: 'Not sent (dry-run)',
  DISABLED: 'Destination disabled',
  SOURCE_FILTERED: 'Source filtered',
  NOT_SENT_ERROR: 'Not sent · processing failed',
};
export function destinationPreviewReason(destination: DryRunResult['results'][number]) {
  if (destination.delivery === 'DISABLED')
    return 'This destination is disabled. Its filter and transformation were not run.';
  if (destination.delivery === 'SOURCE_FILTERED')
    return 'The source filter stopped this message before destination processing.';
  if (destination.delivery === 'FILTERED' || destination.stages?.filter === 'NOT_MATCHED')
    return 'The condition did not match. No message was sent to this destination.';
  return 'This destination did not route the message. Check its enabled state and filter.';
}
export function DestinationStageSummary({
  destination,
  detailed = false,
}: {
  destination: DryRunResult['results'][number];
  detailed?: boolean;
}) {
  if (!destination.stages && destination.enabled === undefined && !destination.delivery)
    return null;
  const stages = Object.entries(destination.stages || {}).filter(
    ([name, status]) =>
      detailed ||
      name === 'filter' ||
      name === 'transformation' ||
      (name === 'template' && !['NOT_CONFIGURED', 'SKIPPED'].includes(status)),
  );
  return (
    <dl
      className="definition-list"
      aria-label={`Processing results: ${destination.name || 'Destination'}`}
    >
      {destination.enabled !== undefined && (
        <div>
          <dt>Destination</dt>
          <dd>{destination.enabled ? 'Enabled' : 'Disabled'}</dd>
        </div>
      )}
      {stages.map(([name, status]) => (
        <div key={name}>
          <dt>{name.charAt(0).toUpperCase() + name.slice(1)}</dt>
          <dd>{previewStageLabels[status] || status}</dd>
        </div>
      ))}
      <div>
        <dt>Delivery</dt>
        <dd>
          {destination.delivery
            ? previewStageLabels[destination.delivery] || destination.delivery
            : 'Not sent (dry-run)'}
        </dd>
      </div>
    </dl>
  );
}
export function DryRunPreview({ result }: { result: DryRunResult }) {
  return (
    <div className="dry-run-preview" aria-label="Output preview" role="status">
      <div className={`alert ${result.success ? '' : 'error'}`}>
        <strong>Network delivery: {result.networkDelivery || 'NOT_SENT'}</strong>
        <p>
          {result.success ? 'Preview completed' : 'Preview failed'} in {result.elapsedMs} ms. No
          message was sent. Destination responses are available after a real delivery in Messages.
        </p>
      </div>
      {result.input && (
        <section className="preview-stage" aria-label="Preview input">
          <h4>1. Original inbound payload · {result.input.format}</h4>
          <pre className="code-box">{payloadText(result.input.payload)}</pre>
          {result.parsedInput && (
            <>
              <h4>Parsed input · {result.parsedInput.format}</h4>
              <pre className="code-box">{payloadText(result.parsedInput.payload)}</pre>
            </>
          )}
        </section>
      )}
      {result.source && (
        <section className="preview-stage" aria-label="Preview source processing">
          <h4>2. Source processing · {result.source.format}</h4>
          <dl className="definition-list">
            <div>
              <dt>Source validation</dt>
              <dd>{previewStageLabels[result.source.validation] || result.source.validation}</dd>
            </div>
            <div>
              <dt>Source filter</dt>
              <dd>{previewStageLabels[result.source.filter] || result.source.filter}</dd>
            </div>
            <div>
              <dt>Source transformation</dt>
              <dd>
                {previewStageLabels[result.source.transformation] || result.source.transformation}
              </dd>
            </div>
          </dl>
          <ValidationResults results={result.source.validationResults} />
          {result.source.code && (
            <p className="alert error">
              {result.source.message ||
                `Source processing failed: ${result.source.code}. Check the input format, validation rules and source scripts.`}
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
              <DestinationStageSummary destination={destination} detailed />
              {destination.status === 'ERROR' ? (
                <p className="alert error">
                  {destination.message ||
                    `Preview failed: ${destination.code || 'DESTINATION_INVALID'}`}
                </p>
              ) : destination.routed === false ? (
                <p>{destinationPreviewReason(destination)}</p>
              ) : (
                <>
                  <p>Generated outbound payload</p>
                  <PayloadPreview
                    payload={destination.finalPayload}
                    format={destination.outputFormat}
                    fields={destination.fieldTree}
                  />
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
