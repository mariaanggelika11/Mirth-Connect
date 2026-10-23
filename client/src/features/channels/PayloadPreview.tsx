import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { FieldExplorer, type FieldOption } from '../../components/ui/FieldExplorer';
export function PayloadPreview({
  payload,
  format,
  fields,
  copyable = false,
}: {
  payload: unknown;
  format?: string;
  fields?: FieldOption[];
  copyable?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const [view, setView] = useState<'raw' | 'tree'>('raw');
  const hl7 = format === 'HL7V2';
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return (
    <div className="payload-preview">
      {copyable && (
        <div className="heading-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(raw || '');
                setCopyStatus('Output copied.');
              } catch {
                setCopyStatus('Copy unavailable. Select the output to copy it.');
              }
            }}
          >
            Copy Output
          </Button>
          <small role="status">{copyStatus}</small>
        </div>
      )}
      {hl7 && (
        <div className="heading-actions" role="group" aria-label="HL7 preview view">
          <Button
            type="button"
            variant="secondary"
            aria-pressed={view === 'raw'}
            onClick={() => setView('raw')}
          >
            Raw HL7
          </Button>
          <Button
            type="button"
            variant="secondary"
            aria-pressed={view === 'tree'}
            onClick={() => setView('tree')}
          >
            HL7 field tree
          </Button>
        </div>
      )}
      {hl7 && view === 'tree' ? (
        <>
          <p className="muted">
            Structure from the generated message. Payload values follow the preview privacy setting
            in Raw HL7.
          </p>
          <FieldExplorer fields={fields || []} label="Generated HL7 fields" />
        </>
      ) : (
        <pre className="code-box">{hl7 ? raw?.replace(/\r\n|\r/g, '\n') : raw}</pre>
      )}
    </div>
  );
}
