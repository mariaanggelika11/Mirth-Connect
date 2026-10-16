import { useState } from 'react';
import type { Channel } from '../../types';
import { Button } from '../../components/ui/Button';
import { sourceRequest } from './sourceRequest';

export function SourceEndpoint({ channel }: { channel: Pick<Channel, 'id' | 'name' | 'source'> }) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  if (channel.source.type !== 'HTTP' || !channel.source.endpoint) return null;
  const examples = sourceRequest(channel);
  async function copy(value: string, label: string) {
    setNotice('');
    setError('');
    try {
      await navigator.clipboard.writeText(value);
      setNotice(label + ' copied');
    } catch {
      setError('Clipboard is unavailable. Select and copy the endpoint, or use HTTPS.');
    }
  }
  return (
    <section className="source-endpoint form-section" aria-label="Current source endpoint">
      <h3>Current source endpoint</h3>
      <code className="code-box break-anywhere">{examples.endpoint}</code>
      <div className="heading-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void copy(examples.endpoint, 'Endpoint')}
        >
          Copy endpoint
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void copy(examples.curl, 'curl example')}
        >
          Copy curl example
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void copy(examples.postman, 'Postman collection')}
        >
          Copy Postman request
        </Button>
      </div>
      <small>
        Examples contain placeholders. Supply your source API key and a unique request ID before
        sending synthetic data.
      </small>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
