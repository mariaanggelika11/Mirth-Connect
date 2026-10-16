import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Button } from '../../components/ui/Button';
interface Alert {
  code: string;
  state: string;
  active: boolean;
  first_seen_at: string;
}
export function AlertPanel() {
  const [rows, setRows] = useState<Alert[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const { data } = await api.get('/alerts');
      setRows(data.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load alerts');
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="form-section">
      <h3>Operational alerts</h3>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p>No operational alerts recorded. Alert delivery is configured by the deployment owner.</p>
      ) : (
        rows.map((row) => (
          <div className="review-destination" key={row.code}>
            <span>
              {row.code} · {row.state} · {new Date(row.first_seen_at).toLocaleString('en-US')}
            </span>
            <Button
              variant="secondary"
              disabled={busy || !row.active || row.state === 'ACKNOWLEDGED'}
              onClick={() => {
                setBusy(true);
                void api
                  .post(`/alerts/${row.code}/acknowledge`)
                  .then(load)
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Acknowledge alert
            </Button>
          </div>
        ))
      )}
    </section>
  );
}
