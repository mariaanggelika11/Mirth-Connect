import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Button } from '../../components/ui/Button';
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
  return (
    <section className="card-bw settings-panel">
      <h2>Effective security & operations settings</h2>
      <p>
        These settings reflect the running backend. Changes are managed through a reviewed
        deployment.
      </p>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {configuration ? (
        <pre className="code-box">{JSON.stringify(configuration, null, 2)}</pre>
      ) : (
        !error && <p role="status">Loading runtime settings…</p>
      )}
      <Button variant="secondary" disabled={busy || !configuration} onClick={() => void download()}>
        {busy ? 'Preparing report…' : 'Download diagnostic metadata'}
      </Button>
      <p className="muted">
        The audited report contains counts and runtime settings. Payloads, credentials, scripts,
        logs, endpoint URLs and operator notes are excluded.
      </p>
    </section>
  );
}
