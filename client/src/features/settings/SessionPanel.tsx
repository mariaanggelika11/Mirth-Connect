import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
interface Session {
  family_id: string;
  created_at: string;
  expires_at: string;
  revoked: boolean;
}
export function SessionPanel() {
  const [sessions, setSessions] = useState<Session[]>([]),
    [error, setError] = useState(''),
    [target, setTarget] = useState<Session | null>(null),
    [loading, setLoading] = useState(true);
  async function load() {
    try {
      const { data } = await api.get('/auth/sessions');
      setSessions(data.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load sessions');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="form-section">
      <h3>Browser sessions</h3>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <p>No browser sessions returned.</p>
      ) : (
        sessions.map((s) => (
          <div key={s.family_id} className="review-destination">
            <span>
              Created {new Date(s.created_at).toLocaleString()} · Expires{' '}
              {new Date(s.expires_at).toLocaleString()} ·{' '}
              {s.revoked
                ? 'Revoked'
                : new Date(s.expires_at).getTime() <= Date.now()
                  ? 'Expired'
                  : 'Active'}
            </span>
            <Button variant="secondary" disabled={s.revoked} onClick={() => setTarget(s)}>
              Revoke session
            </Button>
          </div>
        ))
      )}
      <ConfirmationModal
        isOpen={!!target}
        onClose={() => setTarget(null)}
        title="Revoke browser session"
        message="This session will lose API access. Revoking your current session will require signing in again."
        onConfirm={async () => {
          if (!target) return;
          await api.post(`/auth/sessions/${target.family_id}/revoke`);
          setTarget(null);
          await load();
        }}
      />
    </section>
  );
}
