import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Button } from '../../components/ui/Button';
function section(configuration: Record<string, unknown>, key: string) {
  const value = configuration[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function display(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : 'Not reported';
}
export function RuntimeSettingsPanel() {
  const [configuration, setConfiguration] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    api
      .get('/system/configuration')
      .then(({ data }) => {
        if (mounted) setConfiguration(data.data);
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
    };
  }, []);
  async function download() {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.get('/system/diagnostics');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'mirth-diagnostic-metadata.json';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to download diagnostic metadata');
    } finally {
      setBusy(false);
    }
  }
  const runtime = configuration ? section(configuration, 'runtime') : {};
  const transport = configuration ? section(configuration, 'transport') : {};
  const retention = configuration ? section(configuration, 'retention') : {};
  return (
    <section className="card-bw settings-panel">
      <h2>Runtime information</h2>
      <p>Current backend configuration.</p>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {configuration ? (
        <dl className="definition-list">
          <div>
            <dt>Node.js</dt>
            <dd>{display(runtime.node)}</dd>
          </div>
          <div>
            <dt>Environment</dt>
            <dd>{display(runtime.environment)}</dd>
          </div>
          <div>
            <dt>Encryption version</dt>
            <dd>{display(runtime.encryptionKeyVersion)}</dd>
          </div>
          <div>
            <dt>Database TLS</dt>
            <dd>
              {transport.postgresTlsVerified === true
                ? 'Certificate verified'
                : transport.postgresTlsVerified === false
                  ? 'Not verified'
                  : 'Not reported'}
            </dd>
          </div>
          <div>
            <dt>MLLP</dt>
            <dd>
              {transport.mllpEnabled === true
                ? transport.mllpMutualTls === true
                  ? 'Enabled · mutual TLS'
                  : transport.mllpTls === true
                    ? 'Enabled · TLS'
                    : 'Enabled · plaintext'
                : transport.mllpEnabled === false
                  ? 'Disabled'
                  : 'Not reported'}
            </dd>
          </div>
          <div>
            <dt>Message retention</dt>
            <dd>
              {retention.enabled === true
                ? `${display(retention.messageDays)} days`
                : retention.enabled === false
                  ? 'Automatic cleanup disabled'
                  : 'Not reported'}
            </dd>
          </div>
        </dl>
      ) : (
        !error && <p role="status">Loading runtime settings…</p>
      )}
      <details className="advanced-section">
        <summary>Diagnostic report</summary>
        <Button
          variant="secondary"
          disabled={busy || !configuration}
          onClick={() => void download()}
        >
          {busy ? 'Preparing report…' : 'Download diagnostic metadata'}
        </Button>
        <p className="muted">
          The audited report contains counts and runtime settings. Payloads, credentials, scripts,
          logs, endpoint URLs and operator notes are excluded.
        </p>
      </details>
    </section>
  );
}
