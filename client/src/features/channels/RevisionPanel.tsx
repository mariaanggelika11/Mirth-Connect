import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { Channel } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
interface Revision {
  revision: number;
  state: string;
  change_summary: string;
  checksum: string;
}
export function RevisionPanel({
  channel,
  onClose,
  onChanged,
}: {
  channel: Channel;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Revision[]>([]),
    [error, setError] = useState(''),
    [summary, setSummary] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(''),
    [selected, setSelected] = useState<number[]>([]);
  useEffect(() => {
    api
      .get(`/channel/${channel.id}/revisions`)
      .then(({ data }) => setRows(data.data))
      .catch((e) => setError(e.message));
  }, [channel.id]);
  async function view(revision: number) {
    try {
      const { data } = await api.get(`/channel/${channel.id}/revisions/${revision}`);
      setPreview(JSON.stringify(data.data, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load revision');
    }
  }
  async function compare() {
    try {
      const results = await Promise.all(
        [...selected]
          .sort((a, b) => a - b)
          .map((r) => api.get(`/channel/${channel.id}/revisions/${r}`)),
      );
      setPreview(
        JSON.stringify({ before: results[0].data.data, after: results[1].data.data }, null, 2),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to compare revisions');
    }
  }
  async function publish(revision: number, action: string) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/channel/${channel.id}/revisions/${revision}/${action}`, {
        changeSummary: summary,
        expectedActiveRevision: channel.activeRevision || 0,
      });
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to publish revision');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal isOpen onClose={onClose} title={`Revisions · ${channel.name}`}>
      <div className="form-body">
        <p>
          Active revision: {channel.activeRevision || 0}. Publish affects new messages; saved
          deliveries retain their connector snapshot.
        </p>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <label className="field">
          <span>Publish / rollback summary *</span>
          <input maxLength={500} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        {rows.map((row) => (
          <section key={row.revision} className="form-section">
            <strong>
              Revision {row.revision} · {row.state}
            </strong>
            <p>{row.change_summary}</p>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(row.revision)}
                onChange={(e) =>
                  setSelected((v) =>
                    e.target.checked
                      ? [...v.slice(-1), row.revision]
                      : v.filter((r) => r !== row.revision),
                  )
                }
              />{' '}
              Compare revision {row.revision}
            </label>
            <div className="heading-actions">
              <Button variant="secondary" onClick={() => void view(row.revision)}>
                Review configuration
              </Button>
              <Button
                disabled={busy || !summary.trim() || row.state === 'ARCHIVED'}
                onClick={() =>
                  void publish(row.revision, row.state === 'DRAFT' ? 'publish' : 'rollback')
                }
              >
                {row.state === 'DRAFT' ? 'Publish' : 'Rollback'}
              </Button>
            </div>
          </section>
        ))}
        <Button variant="secondary" disabled={selected.length !== 2} onClick={() => void compare()}>
          Compare selected revisions
        </Button>
        {preview && <pre className="code-box">{preview}</pre>}
      </div>
    </Modal>
  );
}
