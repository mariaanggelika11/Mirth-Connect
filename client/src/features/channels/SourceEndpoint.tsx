import type { Channel } from '../../types';

export function SourceEndpoint({ channel }: { channel: Pick<Channel, 'source'> }) {
  if (channel.source.type !== 'HTTP' || !channel.source.endpoint) return null;
  return (
    <section className="source-endpoint form-section" aria-label="Current source endpoint">
      <h3>Current source endpoint</h3>
      <code className="code-box break-anywhere">{channel.source.endpoint}</code>
    </section>
  );
}
