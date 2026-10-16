import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import type { Channel, ChannelFormData } from '../../types';
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
  created_at?: string;
  published_at?: string;
}
export function RevisionPanel({
  channel,
  onClose,
  onChanged,
  onPublished,
}: {
  channel: Channel;
  onClose: () => void;
  onChanged: () => void;
  onPublished?: (revision: number) => void;
}) {
  const { can } = useAuth();
  const [activation, setActivation] = useState<{
    revision: number;
    action: 'publish' | 'rollback';
  } | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const reviewRef = useRef<HTMLElement>(null);
  const readOnly = channel.status === 'ARCHIVED' || !can('channel:write');
  const [activeRevision, setActiveRevision] = useState(channel.activeRevision || 0);
  const canViewRaw = can('message:raw');
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
      configuration: Partial<ChannelFormData> | null;
      loading: boolean;
      error: string;
    } | null>(null),
    [selected, setSelected] = useState<number[]>([]);
  const dirty = !!editing && JSON.stringify(editing) !== editBaseline;
  useEffect(() => {
    if (!reviewing) return;
    reviewRef.current?.focus({ preventScroll: true });
    reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [reviewing]);
  useEffect(() => {
    setRawPreview(false);
    setDryRunResult(null);
  }, [canViewRaw]);
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
    setLoading(true);
    try {
      const { data } = await api.get(`/channel/${channel.id}/revisions`);
      setRows(data.data);
      if (Number.isInteger(data.activeRevision)) setActiveRevision(data.activeRevision);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    api
      .get(`/channel/${channel.id}/revisions`)
      .then(({ data }) => {
        setRows(data.data);
        if (Number.isInteger(data.activeRevision)) setActiveRevision(data.activeRevision);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [channel.id]);
  async function view(revision: number) {
    setBusy(true);
    setError('');
    setPreview('');
    setReviewing({ revision, destinations: [], configuration: null, loading: true, error: '' });
    try {
      const { data } = await api.get(`/channel/${channel.id}/revisions/${revision}`);
      if (!data.data || typeof data.data !== 'object')
        throw new Error('Configuration could not be loaded. Try reviewing this revision again.');
      setReviewing({
        revision,
        destinations: data.data.destinations || [],
        configuration: data.data,
        loading: false,
        error: '',
      });
    } catch (e) {
      setReviewing({
        revision,
        destinations: [],
        configuration: null,
        loading: false,
        error: e instanceof Error ? e.message : 'Unable to load revision. Try again.',
      });
    } finally {
      setBusy(false);
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
        changeSummary: summary.trim() || 'Update channel draft',
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
    setTestOpen(true);
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
      setError(
        e instanceof SyntaxError
          ? 'The test payload is not valid JSON.'
          : e instanceof Error
            ? e.message
            : 'Unable to test revision',
      );
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
      const { data } = await api.post(`/channel/${channel.id}/revisions/${revision}/${action}`, {
        changeSummary:
          summary.trim() ||
          (action === 'rollback'
            ? 'Rollback channel configuration'
            : 'Publish channel configuration'),
        expectedActiveRevision: activeRevision,
      });
      onPublished?.(data.activeRevision);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to publish revision');
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal isOpen onClose={requestClose} title={`Revisions · ${channel.name}`}>
      <ConfirmationModal
        isOpen={!!activation}
        onClose={() => setActivation(null)}
        title={activation?.action === 'rollback' ? 'Rollback channel' : 'Publish draft'}
        confirmLabel={activation?.action === 'rollback' ? 'Confirm rollback' : 'Confirm publish'}
        message={
          activation?.action === 'rollback'
            ? `Restore configuration from revision ${activation.revision}? This creates a new published revision. Existing history and accepted messages are preserved. Any pending drafts will be archived.`
            : `Publish draft ${activation?.revision}? New messages will use this configuration. Previously accepted messages keep their saved configuration. Other pending drafts will be archived.`
        }
        onConfirm={async () => {
          if (activation) await publish(activation.revision, activation.action);
        }}
      />
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
        <p>Active revision: {activeRevision}. This is the configuration used for new messages.</p>
        <p className="muted">
          Draft → Review → Publish. Rollback restores an older published configuration as a new
          revision; it never removes history.
        </p>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <Button
          variant="secondary"
          disabled={busy || dirty || loading}
          onClick={() => {
            void reload()
              .then(() => setError(''))
              .catch((e) =>
                setError(e instanceof Error ? e.message : 'Unable to reload revisions'),
              );
          }}
        >
          Refresh revisions
        </Button>
        <details>
          <summary>Optional change note</summary>
          <label className="field">
            <span>Publish / rollback summary (optional)</span>
            <input maxLength={500} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </label>
        </details>
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
            <Button disabled={busy || !editing.name.trim()} onClick={() => void saveDraft()}>
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
        <details open={testOpen} onToggle={(event) => setTestOpen(event.currentTarget.open)}>
          <summary>Test revision with synthetic data</summary>
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
        </details>
        {loading && <p role="status">Loading revisions…</p>}
        {!loading && !rows.length && <p role="status">No revisions available.</p>}
        {rows.map((row) => (
          <section key={row.revision} className="form-section">
            <strong>
              Revision {row.revision} · {row.state}
            </strong>
            {row.revision === activeRevision && <span className="status-badge">Active</span>}
            {row.created_at && (
              <small className="table-subtext">
                Created {new Date(row.created_at).toLocaleString('en-US')}
              </small>
            )}
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
              <Button
                variant="secondary"
                disabled={busy}
                aria-expanded={reviewing?.revision === row.revision}
                onClick={() => void view(row.revision)}
              >
                Review configuration
              </Button>
              {row.state === 'DRAFT' && !readOnly && (
                <Button
                  variant="secondary"
                  disabled={busy || !!editing}
                  onClick={() => void edit(row.revision)}
                >
                  Edit draft {row.revision}
                </Button>
              )}
              {['DRAFT', 'PUBLISHED'].includes(row.state) && !readOnly && (
                <Button
                  variant="secondary"
                  disabled={busy || !synthetic.trim()}
                  onClick={() => void testRevision(row.revision)}
                >
                  Dry-run revision {row.revision}
                </Button>
              )}
              {!readOnly &&
                ['DRAFT', 'PUBLISHED'].includes(row.state) &&
                row.revision !== activeRevision && (
                  <Button
                    disabled={busy || !!editing}
                    onClick={() =>
                      setActivation({
                        revision: row.revision,
                        action: row.state === 'DRAFT' ? 'publish' : 'rollback',
                      })
                    }
                  >
                    {row.state === 'DRAFT' ? 'Publish' : 'Rollback'}
                  </Button>
                )}
            </div>
            {reviewing?.revision === row.revision && (
              <section
                ref={reviewRef}
                tabIndex={-1}
                className="form-section"
                aria-label={`Configuration review · revision ${row.revision}`}
              >
                <h3>Configuration · revision {row.revision}</h3>
                {reviewing.loading && <p role="status">Loading configuration…</p>}
                {reviewing.error && (
                  <p role="alert" className="alert error">
                    {reviewing.error}
                  </p>
                )}
                {reviewing.configuration && (
                  <>
                    <p>
                      <strong>{reviewing.configuration.name || channel.name}</strong>
                    </p>
                    <p>
                      Source: {reviewing.configuration.source?.type || 'Not configured'} /{' '}
                      {reviewing.configuration.source?.inboundDataType || 'Not specified'}
                    </p>
                    <p>
                      Transformation:{' '}
                      {reviewing.configuration.processingScript ? 'Configured' : 'Pass-through'}
                    </p>
                    {!reviewing.destinations.length && <p>No destinations configured.</p>}
                    {(reviewing.configuration.destinations || []).map((destination, index) => (
                      <div key={index} className="form-section">
                        <strong>{destination.name}</strong>
                        <p>
                          {destination.type} / {destination.outboundDataType || 'Not specified'}
                        </p>
                        <code className="code-box break-anywhere">{destination.endpoint}</code>
                        <p>
                          Retry:{' '}
                          {destination.retryEnabled
                            ? `Enabled · up to ${destination.maxRetries ?? 3} retries`
                            : 'Disabled'}{' '}
                          · Timeout: {(destination.timeoutMs ?? 10000) / 1000} seconds
                        </p>
                      </div>
                    ))}
                    <details>
                      <summary>Configuration details (sanitized)</summary>
                      <pre className="code-box">
                        {JSON.stringify(reviewing.configuration, null, 2)}
                      </pre>
                    </details>
                    {!readOnly &&
                      ['DRAFT', 'PUBLISHED'].includes(row.state) &&
                      reviewing.destinations.length > 0 && (
                        <div className="form-section">
                          <p>
                            Connection tests open a TCP/TLS connection and send no patient data.
                          </p>
                          {reviewing.destinations.map((destination, index) => (
                            <Button
                              key={index}
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void probe(row.revision, index)}
                            >
                              Test connection · {destination.name}
                            </Button>
                          ))}
                        </div>
                      )}
                  </>
                )}
              </section>
            )}
          </section>
        ))}
        <Button variant="secondary" disabled={selected.length !== 2} onClick={() => void compare()}>
          Compare selected revisions
        </Button>
        {preview && <pre className="code-box">{preview}</pre>}
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
