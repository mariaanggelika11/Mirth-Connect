import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import type { Channel } from '../../types';

export function SourceEndpoint({ channel }: { channel: Pick<Channel, 'source'> }) {
  const [status, setStatus] = useState('');
  if (channel.source.type !== 'HTTP' || !channel.source.endpoint) return null;
  return (
    <section className="source-endpoint form-section" aria-label="Current source endpoint">
      <h3>Current source endpoint</h3>
      <code className="code-box break-anywhere">{channel.source.endpoint}</code>
      <div className="heading-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(channel.source.endpoint!);
              setStatus('Endpoint copied.');
            } catch {
              setStatus('Copy unavailable. Select the endpoint to copy it.');
            }
          }}
        >
          Copy Endpoint
        </Button>
        <small role="status">{status}</small>
      </div>
    </section>
  );
}
