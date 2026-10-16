import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { api } from '../../services/api';
import type { Destination } from '../../types';

interface ConnectionResult {
  reachable: boolean;
  secure: boolean;
  elapsedMs: number;
  probe: 'TCP_HANDSHAKE' | 'TLS_HANDSHAKE';
  applicationDeliveryTested: false;
  warnings?: string[];
}

export function DestinationConnectionTest({
  destination,
  disabled,
}: {
  destination: Destination;
  disabled: boolean;
}) {
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [error, setError] = useState('');
  const target = JSON.stringify([destination.endpoint, destination.type, destination.timeoutMs]);
  const currentTarget = useRef(target);
  currentTarget.current = target;
  useEffect(() => {
    setResult(null);
    setError('');
  }, [target]);
  useEffect(
    () => () => {
      currentTarget.current = '';
    },
    [],
  );

  async function testConnection() {
    if (disabled || probing) return;
    const requestedTarget = target;
    setProbing(true);
    setResult(null);
    setError('');
    try {
      const { data } = await api.post<ConnectionResult>('/channel/test-connection', {
        endpoint: destination.endpoint,
        type: destination.type,
        timeoutMs: Math.min(destination.timeoutMs ?? 10000, 10000),
      });
      if (currentTarget.current === requestedTarget) setResult(data);
    } catch (cause) {
      if (currentTarget.current === requestedTarget)
        setError(
          cause instanceof Error ? cause.message : 'Check the destination endpoint and try again.',
        );
    } finally {
      setProbing(false);
    }
  }

  return (
    <section className="connection-test" aria-label={`Connection test: ${destination.name}`}>
      <strong>{destination.name || 'Unnamed destination'}</strong>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || probing || !destination.endpoint.trim()}
        onClick={() => void testConnection()}
      >
        {probing ? 'Testing connection…' : 'Test connection'}
      </Button>
      {error && (
        <p className="alert error" role="alert">
          Connection failed: {error}
        </p>
      )}
      {result && (
        <div className={`alert ${result.reachable ? 'success' : 'error'}`} role="status">
          <strong>{result.reachable ? 'Endpoint reachable' : 'Connection failed'}</strong>
          <p>
            {result.probe === 'TLS_HANDSHAKE' ? 'TLS' : 'TCP'} handshake · Response time:{' '}
            {result.elapsedMs} ms.
          </p>
          <p>Connectivity only; no message was sent.</p>
          {result.warnings?.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
    </section>
  );
}
