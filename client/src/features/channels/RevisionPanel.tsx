import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { Channel } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { DryRunPreview } from './DryRunPreview';
import type { DryRunResult } from './DryRunPreview';
import { useAuth } from '../../contexts/AuthContext';
interface DraftEdit {
  revision: number;
  checksum: string;
  name: string;
  idempotencyMode: 'OPTIONAL' | 'REQUIRED' | 'DISABLED';
  destinations: { index: number; name: string; isEnabled: boolean; timeoutMs: number }[];
}
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
  const { can } = useAuth();
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [rawPreview, setRawPreview] = useState(false);
  const [rows, setRows] = useState<Revision[]>([]),
    [error, setError] = useState(''),
    [summary, setSummary] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(''),
    [editing, setEditing] = useState<DraftEdit | null>(null),
    [editBaseline, setEditBaseline] = useState(''),
    [discard, setDiscard] = useState<'CLOSE' | 'CANCEL' | null>(null),
    [synthetic, setSynthetic] = useState('{"fixture":"synthetic"}'),
    [testResult, setTestResult] = useState(''),
    [reviewing, setReviewing] = useState<{
      revision: number;
      destinations: { name: string }[];
    } | null>(null),
    [selected, setSelected] = useState<number[]>([]);
  const dirty = !!editing && JSON.stringify(editing) !== editBaseline;
  useEffect(() => {
    setDryRunResult(null);
  }, [synthetic, rawPreview]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  function requestClose() {
    if (busy) return;
    if (dirty) setDiscard('CLOSE');
    else onClose();
  }
  async function reload() {
    const { data } = await api.get(`/channel/${channel.id}/revisions`);
    setRows(data.data);
  }
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
      setReviewing({ revision, destinations: data.data.destinations });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load revision');
    }
  }
  async function edit(revision: number) {
    setError('');
    try {
      const { data } = await api.get(`/channel/${channel.id}/revisions/${revision}`);
      const value: DraftEdit = {
        revision,
        checksum: data.checksum,
        name: data.data.name,
        idempotencyMode: data.data.idempotencyMode || 'OPTIONAL',
        destinations: data.data.destinations.map(
          (d: { name: string; isEnabled: boolean; timeoutMs: number }, index: number) => ({
            index,
            name: d.name,
            isEnabled: d.isEnabled,
            timeoutMs: d.timeoutMs,
          }),
        ),
      };
      setEditing(value);
      setEditBaseline(JSON.stringify(value));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to edit draft');
    }
  }
  async function saveDraft() {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      const { revision, checksum, ...patch } = editing;
      await api.patch(`/channel/${channel.id}/revisions/${revision}`, {
        expectedChecksum: checksum,
        changeSummary: summary,
        patch,
      });
      setEditing(null);
      setSummary('');
      setSelected([]);
      setPreview('');
      await reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save draft');
    } finally {
      setBusy(false);
    }
  }
  async function testRevision(revision: number) {
    setBusy(true);
    setError('');
    setTestResult('');
    setDryRunResult(null);
    try {
      const { data: configuration } = await api.get(`/channel/${channel.id}/revisions/${revision}`);
      let payload: unknown = synthetic;
      if (configuration.data.source.inboundDataType === 'JSON') {
        payload = JSON.parse(synthetic);
      }
      const { data } = await api.post(`/channel/${channel.id}/revisions/${revision}/dry-run`, {
        payload,
        ...(rawPreview && can('message:raw') ? { raw: true } : {}),
      });
      setDryRunResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to test revision');
    } finally {
      setBusy(false);
    }
  }
  async function probe(revision: number, index: number) {
    setBusy(true);
    setError('');
    setTestResult('');
    setDryRunResult(null);
    try {
      const { data } = await api.post(
        `/channel/${channel.id}/revisions/${revision}/destinations/${index}/test-connection`,
        {},
      );
      setTestResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to test connection');
    } finally {
      setBusy(false);
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
      setReviewing(null);
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
    <Modal isOpen onClose={requestClose} title={`Revisions · ${channel.name}`}>
      <ConfirmationModal
        isOpen={!!discard}
        onClose={() => setDiscard(null)}
        title="Discard draft changes?"
        message="Your unsaved draft changes will be discarded. Saved revisions are preserved."
        confirmLabel="Discard draft changes"
        onConfirm={() => {
          const action = discard;
          setDiscard(null);
          setEditing(null);
          if (action === 'CLOSE') onClose();
        }}
      />
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
        {editing && (
          <section className="form-section" aria-label={`Edit draft revision ${editing.revision}`}>
            <h3>Edit draft revision {editing.revision}</h3>
            <p>
              Saving creates a successor draft and preserves credentials and scripts on the server.
              The active configuration is unchanged.
            </p>
            <label className="field">
              <span>Draft channel name</span>
              <input
                maxLength={150}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Draft duplicate message protection</span>
              <select
                value={editing.idempotencyMode}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    idempotencyMode: e.target.value as DraftEdit['idempotencyMode'],
                  })
                }
              >
                {['OPTIONAL', 'REQUIRED', 'DISABLED'].map((mode) => (
                  <option key={mode}>{mode}</option>
                ))}
              </select>
            </label>
            {editing.destinations.map((d) => (
              <div key={d.index} className="form-section">
                <label className="field">
                  <span>Draft destination {d.index + 1} name</span>
                  <input
                    maxLength={150}
                    value={d.name}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        destinations: editing.destinations.map((v) =>
                          v.index === d.index ? { ...v, name: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={d.isEnabled}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        destinations: editing.destinations.map((v) =>
                          v.index === d.index ? { ...v, isEnabled: e.target.checked } : v,
                        ),
                      })
                    }
                  />{' '}
                  Enabled destination {d.index + 1}
                </label>
                <label className="field">
                  <span>Draft destination {d.index + 1} timeout (seconds)</span>
                  <input
                    type="number"
                    min={0.1}
                    max={120}
                    step={0.1}
                    value={d.timeoutMs / 1000}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        destinations: editing.destinations.map((v) =>
                          v.index === d.index
                            ? { ...v, timeoutMs: Math.round(Number(e.target.value) * 1000) }
                            : v,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
            <Button
              disabled={busy || !summary.trim() || !editing.name.trim()}
              onClick={() => void saveDraft()}
            >
              Save successor draft
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => (dirty ? setDiscard('CANCEL') : setEditing(null))}
            >
              Cancel draft edit
            </Button>
          </section>
        )}
        <label className="field">
          <span>Synthetic revision test payload</span>
          <textarea
            rows={4}
            disabled={busy}
            value={synthetic}
            onChange={(e) => setSynthetic(e.target.value)}
          />
        </label>
        <p>
          Use synthetic data only. Revision dry-run performs no network delivery and masks its
          payload preview.
        </p>
        {can('message:raw') && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={rawPreview}
              onChange={(e) => {
                setRawPreview(e.target.checked);
                setDryRunResult(null);
              }}
            />
            View raw synthetic preview (audited)
          </label>
        )}
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
              {row.state === 'DRAFT' && (
                <Button
                  variant="secondary"
                  disabled={busy || !!editing}
                  onClick={() => void edit(row.revision)}
                >
                  Edit draft {row.revision}
                </Button>
              )}
              {row.state !== 'ARCHIVED' && (
                <Button
                  variant="secondary"
                  disabled={busy || !synthetic.trim()}
                  onClick={() => void testRevision(row.revision)}
                >
                  Dry-run revision {row.revision}
                </Button>
              )}
              <Button
                disabled={busy || !!editing || !summary.trim() || row.state === 'ARCHIVED'}
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
        {reviewing &&
          rows.find((r) => r.revision === reviewing.revision)?.state !== 'ARCHIVED' &&
          reviewing.destinations.length > 0 && (
            <section className="form-section">
              <p>
                Connection tests perform DNS and TCP/TLS handshake only. They open a network
                connection and send no patient data.
              </p>
              {reviewing.destinations.map((destination, index) => (
                <Button
                  key={index}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void probe(reviewing.revision, index)}
                >
                  Test connection · {destination.name}
                </Button>
              ))}
            </section>
          )}
        {dryRunResult && (
          <div aria-label="Revision dry-run result">
            <DryRunPreview result={dryRunResult} />
          </div>
        )}
        {testResult && (
          <pre className="code-box" role="status" aria-label="Revision dry-run result">
            {testResult}
          </pre>
        )}
      </div>
    </Modal>
  );
}
