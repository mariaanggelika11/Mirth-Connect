import { useCallback, useEffect, useRef, useState } from 'react';
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
  const reviewRequest = useRef(0);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);
  const readOnly = channel.status === 'ARCHIVED' || !can('channel:write');
  const [activeRevision, setActiveRevision] = useState(channel.activeRevision || 0);
  const canViewRaw = can('message:raw');
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
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
  const dryRunContext = JSON.stringify([channel.id, currentRevision, synthetic, canViewRaw]);
  const currentDryRunContext = useRef(dryRunContext);
  currentDryRunContext.current = dryRunContext;
  useEffect(() => {
    setDryRunResult(null);
  }, [canViewRaw]);
  useEffect(() => {
    setDryRunResult(null);
  }, [synthetic]);
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
  const view = useCallback(
    async (revision: number) => {
      const request = ++reviewRequest.current;
      setError('');
      setPreview('');
      setReviewing({ revision, destinations: [], configuration: null, loading: true, error: '' });
      try {
        const { data } = await api.get(`/channel/${channel.id}/revisions/${revision}`);
        if (request !== reviewRequest.current) return;
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
        if (request !== reviewRequest.current) return;
        setReviewing({
          revision,
          destinations: [],
          configuration: null,
          loading: false,
          error: e instanceof Error ? e.message : 'Unable to load revision. Try again.',
        });
      }
    },
    [channel.id],
  );
  useEffect(() => {
    if (!rows.length || rows.some((row) => row.revision === currentRevision)) return;
    setCurrentRevision(
      (
        rows.find((row) => row.state === 'DRAFT') ||
        rows.find((row) => row.revision === activeRevision) ||
        rows[0]
      ).revision,
    );
  }, [rows, currentRevision, activeRevision]);
  useEffect(() => {
    setDryRunResult(null);
    setTestResult('');
    if (currentRevision !== null) void view(currentRevision);
    return () => {
      reviewRequest.current++;
    };
  }, [currentRevision, view]);
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
      const { data } = await api.patch(`/channel/${channel.id}/revisions/${revision}`, {
        expectedChecksum: checksum,
        changeSummary: summary.trim() || 'Update channel draft',
        patch,
      });
      setEditing(null);
      setSummary('');
      setSelected([]);
      setPreview('');
      await reload();
      setCurrentRevision(data.revision);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save draft');
    } finally {
      setBusy(false);
    }
  }
  async function testRevision(revision: number) {
    const context = dryRunContext;
    setTestOpen(true);
    setBusy(true);
    setError('');
    setTestResult('');
    setDryRunResult(null);
    try {
      const { data: configuration } = await api.get(`/channel/${channel.id}/revisions/${revision}`);
      if (currentDryRunContext.current !== context) return;
      let payload: unknown = synthetic;
      if (configuration.data.source.inboundDataType === 'JSON') {
        payload = JSON.parse(synthetic);
      }
      const { data } = await api.post(`/channel/${channel.id}/revisions/${revision}/dry-run`, {
        payload,
        raw: canViewRaw,
      });
      if (currentDryRunContext.current === context)
        setDryRunResult({ ...data, rawPayload: data.rawPayload ?? canViewRaw });
    } catch (e) {
      if (currentDryRunContext.current !== context) return;
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
  const row = rows.find((item) => item.revision === currentRevision);
  const review = reviewing?.revision === currentRevision ? reviewing : null;
  const ready = !!review?.configuration && !review.loading && !review.error;
  const editable = !readOnly && row?.state === 'DRAFT';
  const activatable =
    !readOnly &&
    !!row &&
    ['DRAFT', 'PUBLISHED'].includes(row.state) &&
    row.revision !== activeRevision;
  const stateLabel =
    row?.revision === activeRevision
      ? 'Active'
      : row?.state === 'DRAFT'
        ? 'Draft'
        : row?.state === 'PUBLISHED'
          ? 'Previous version'
          : 'Archived';
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
      <div className="form-body revision-panel">
        <div className="revision-toolbar">
          <span className="muted">Active revision: {activeRevision}.</span>
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
        </div>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <label className="field">
          <span>Version</span>
          <select
            aria-label="Revision version"
            value={currentRevision ?? ''}
            disabled={busy || !!editing || loading || !rows.length}
            onChange={(event) => setCurrentRevision(Number(event.target.value))}
          >
            {!rows.length && (
              <option value="">{loading ? 'Loading revisions…' : 'No revisions available'}</option>
            )}
            {rows.map((item) => (
              <option key={item.revision} value={item.revision}>
                Revision {item.revision} ·{' '}
                {item.revision === activeRevision
                  ? 'Active'
                  : item.state === 'DRAFT'
                    ? 'Draft'
                    : item.state === 'PUBLISHED'
                      ? 'Published'
                      : 'Archived'}
              </option>
            ))}
          </select>
        </label>
        {row && (
          <div className="revision-caption">
            <span
              className={`revision-label ${stateLabel === 'Draft' ? 'draft' : stateLabel === 'Active' ? 'active' : ''}`}
            >
              {stateLabel}
            </span>
            <span>{row.change_summary || `Revision ${row.revision}`}</span>
          </div>
        )}
        <section
          className="revision-content"
          tabIndex={0}
          aria-label={
            editing ? 'Draft editor' : `Configuration review · revision ${currentRevision ?? ''}`
          }
          aria-busy={!editing && !!row && (!review || review.loading)}
        >
          {editing && (
            <section
              className="form-section"
              aria-label={`Edit draft revision ${editing.revision}`}
            >
              <h3>Edit draft revision {editing.revision}</h3>
              <p>
                Saving creates a successor draft and preserves credentials and scripts on the
                server. The active configuration is unchanged.
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
          {!editing && (
            <>
              {(loading || (row && (!review || review.loading))) && (
                <p role="status">Loading configuration…</p>
              )}
              {!loading && !row && <p role="status">No revisions available.</p>}
              {review?.error && (
                <div className="form-section">
                  <p role="alert" className="alert error">
                    {review.error}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (currentRevision) void view(currentRevision);
                    }}
                  >
                    Retry review
                  </Button>
                </div>
              )}
              {ready && review?.configuration && (
                <div className="revision-summary">
                  <h3>{review.configuration.name || channel.name}</h3>
                  <div className="revision-flow">
                    <div>
                      <small>Source</small>
                      <strong>
                        {review.configuration.source?.type || 'Not configured'} /{' '}
                        {review.configuration.source?.inboundDataType || 'Not specified'}
                      </strong>
                    </div>
                    <span aria-hidden="true">→</span>
                    <div>
                      <small>Destinations</small>
                      <strong>{review.destinations.length || 'Receive only'}</strong>
                    </div>
                  </div>
                  <p className="muted">
                    {review.configuration.processingScript
                      ? 'Transformation configured'
                      : 'Messages pass through without a source transformation.'}
                  </p>
                  {(review.configuration.destinations || []).map((destination, index) => (
                    <div key={index} className="revision-destination">
                      <strong>{destination.name}</strong>
                      <span>
                        {destination.type} / {destination.outboundDataType || 'Not specified'}
                      </span>
                      <code className="break-anywhere">{destination.endpoint}</code>
                      <small>
                        Retry:{' '}
                        {destination.retryEnabled ? `up to ${destination.maxRetries ?? 3}` : 'off'}{' '}
                        · Timeout: {(destination.timeoutMs ?? 10000) / 1000} seconds
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
        <div className="revision-actions">
          {editable && (
            <Button
              variant="secondary"
              disabled={busy || !!editing || !ready}
              onClick={() => {
                if (row) void edit(row.revision);
              }}
            >
              Edit draft {row?.revision}
            </Button>
          )}
          {activatable && (
            <Button
              disabled={busy || !!editing || !ready}
              onClick={() => {
                if (row)
                  setActivation({
                    revision: row.revision,
                    action: row.state === 'DRAFT' ? 'publish' : 'rollback',
                  });
              }}
            >
              {row?.state === 'DRAFT' ? 'Publish' : 'Rollback'}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={requestClose}>
            Done
          </Button>
        </div>
        <details className="revision-advanced">
          <summary>Advanced options</summary>
          <div className="form-section">
            <label className="field">
              <span>Publish / rollback summary (optional)</span>
              <input
                maxLength={500}
                value={summary}
                disabled={busy}
                onChange={(event) => setSummary(event.target.value)}
              />
            </label>
            {row?.created_at && (
              <p className="muted">Created {new Date(row.created_at).toLocaleString('en-US')}</p>
            )}
            {ready && (
              <details>
                <summary>Configuration details (sanitized)</summary>
                <pre className="code-box" tabIndex={0} aria-label="Sanitized configuration">
                  {JSON.stringify(review?.configuration, null, 2)}
                </pre>
              </details>
            )}
            {!readOnly && row && ['DRAFT', 'PUBLISHED'].includes(row.state) && (
              <details open={testOpen} onToggle={(event) => setTestOpen(event.currentTarget.open)}>
                <summary>Test with synthetic data</summary>
                <div className="form-section">
                  <label className="field">
                    <span>Synthetic revision test payload</span>
                    <textarea
                      rows={4}
                      value={synthetic}
                      disabled={busy}
                      onChange={(event) => setSynthetic(event.target.value)}
                    />
                  </label>
                  <p className="muted">Synthetic data only. Testing does not send messages.</p>
                  <Button
                    variant="secondary"
                    disabled={busy || !!editing || !ready || !synthetic.trim()}
                    onClick={() => void testRevision(row.revision)}
                  >
                    Dry-run revision {row.revision}
                  </Button>
                  {dryRunResult && (!dryRunResult.rawPayload || canViewRaw) && (
                    <div aria-label="Revision dry-run result">
                      <DryRunPreview result={dryRunResult} />
                    </div>
                  )}
                </div>
              </details>
            )}
            {!readOnly &&
              ready &&
              row &&
              ['DRAFT', 'PUBLISHED'].includes(row.state) &&
              review?.destinations.length > 0 && (
                <details>
                  <summary>Destination connection tests</summary>
                  <div className="form-section">
                    <p className="muted">Opens a TCP/TLS connection. No patient data is sent.</p>
                    {review.destinations.map((destination, index) => (
                      <Button
                        key={index}
                        variant="secondary"
                        disabled={busy || !!editing}
                        onClick={() => void probe(row.revision, index)}
                      >
                        Test connection · {destination.name}
                      </Button>
                    ))}
                    {testResult && (
                      <pre className="code-box" role="status" aria-label="Revision dry-run result">
                        {testResult}
                      </pre>
                    )}
                  </div>
                </details>
              )}
            <details>
              <summary>Compare versions</summary>
              <div className="revision-compare-list">
                {rows.map((item) => (
                  <label className="check-field" key={item.revision}>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.revision)}
                      disabled={busy}
                      onChange={(event) =>
                        setSelected((values) =>
                          event.target.checked
                            ? [...values.slice(-1), item.revision]
                            : values.filter((value) => value !== item.revision),
                        )
                      }
                    />
                    Compare revision {item.revision}
                  </label>
                ))}
              </div>
              <Button
                variant="secondary"
                disabled={busy || selected.length !== 2}
                onClick={() => void compare()}
              >
                Compare selected revisions
              </Button>
              {preview && (
                <pre className="code-box" tabIndex={0} aria-label="Revision comparison">
                  {preview}
                </pre>
              )}
            </details>
          </div>
        </details>
      </div>
    </Modal>
  );
}
