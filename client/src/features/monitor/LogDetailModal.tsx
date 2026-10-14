import { useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchLogDetail, resendMessage } from '../../services/message.api';
import type { LogEntry, DestinationLog } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { StatusBadge, EmptyState, formatTime } from '../../components/ui/OperationalUI';
import { PayloadViewer } from './PayloadViewer';
export default function LogDetailModal({
  log: initialLog,
  onClose,
}: {
  log: LogEntry;
  onClose: () => void;
}) {
  const [log, setLog] = useState(initialLog),
    [tab, setTab] = useState('summary'),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [confirm, setConfirm] = useState<DestinationLog | null>(null),
    [resending, setResending] = useState(false);
  const { can } = useAuth();
  async function loadPage(page: number) {
    setLoading(true);
    setError('');
    try {
      setLog(await fetchLogDetail(log.id, page));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load delivery history');
    } finally {
      setLoading(false);
    }
  }
  async function retry() {
    if (!confirm?.messageId) return;
    setResending(true);
    setError('');
    try {
      await resendMessage(confirm.messageId);
      setConfirm(null);
      setNotice('Resend processed. Delivery results have been refreshed.');
      await loadPage(log.destinationPagination?.page || 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to resend message');
    } finally {
      setResending(false);
    }
  }
  return (
    <>
      <Modal isOpen onClose={onClose} title={`Message #${log.id}`} variant="drawer">
        <div className="message-detail">
          <div className="detail-identity">
            <div>
              <strong>{log.channelName}</strong>
              <small>
                {formatTime(log.timestamp)} · {log.direction === 'OUT' ? 'Outbound' : 'Inbound'}
              </small>
            </div>
            <StatusBadge status={log.status} />
          </div>
          <div className="tabs" role="tablist" aria-label="Message detail sections">
            {['summary', ...(log.payloadAllowed ? ['payload'] : []), 'history'].map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {t === 'summary' ? 'Summary' : t === 'payload' ? 'Payload' : 'Delivery history'}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="alert success">
              {notice}
            </p>
          )}
          {tab === 'summary' && (
            <div className="form-section">
              <h3>Message overview</h3>
              <dl className="definition-list">
                <div>
                  <dt>Message ID</dt>
                  <dd>#{log.id}</dd>
                </div>
                <div>
                  <dt>Channel</dt>
                  <dd>
                    {log.channelName} <span className="muted">#{log.channelId}</span>
                  </dd>
                </div>
                <div>
                  <dt>Direction</dt>
                  <dd>{log.direction || 'IN'}</dd>
                </div>
                <div>
                  <dt>Received</dt>
                  <dd>{formatTime(log.timestamp)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge status={log.status} />
                  </dd>
                </div>
                <div>
                  <dt>Retry attempts</dt>
                  <dd>{log.retryCount ?? 0}</dd>
                </div>
                {log.nextRetryAt && (
                  <div>
                    <dt>Next retry</dt>
                    <dd>{formatTime(log.nextRetryAt)}</dd>
                  </div>
                )}
                {log.errorCode && (
                  <div>
                    <dt>Diagnostic</dt>
                    <dd className="break-anywhere">{log.errorCode}</dd>
                  </div>
                )}
                {log.correlationId && (
                  <div>
                    <dt>Correlation ID</dt>
                    <dd className="break-anywhere">{log.correlationId}</dd>
                  </div>
                )}
              </dl>
              <div className="summary-help">
                <strong>
                  {['FAILED', 'IN-ERROR', 'OUT-ERROR', 'DEAD_LETTER', 'PARTIAL'].includes(
                    log.status || '',
                  )
                    ? 'Review the delivery history'
                    : 'Follow the message journey'}
                </strong>
                <p>
                  {log.destinationLogs?.length
                    ? 'Open Delivery history for destination results, responses and retry actions.'
                    : 'This message has no destination attempts recorded.'}
                </p>
              </div>
              {!log.payloadAllowed && (
                <p className="muted">
                  Payload access requires an authorized role. Your current role can view metadata.
                </p>
              )}
            </div>
          )}
          {tab === 'payload' && log.payloadAllowed && (
            <div className="form-section">
              <PayloadViewer title="Original payload" value={log.originalPayload} />
              <PayloadViewer title="Transformed payload" value={log.transformedPayload} />
            </div>
          )}
          {tab === 'history' && (
            <div className="delivery-history">
              {!log.destinationLogs?.length ? (
                <EmptyState
                  title="No delivery attempts"
                  description="Destination results will appear after a delivery is attempted."
                />
              ) : (
                log.destinationLogs.map((dest, i) => (
                  <section key={`${dest.messageId}-${dest.sentAt}-${i}`} className="delivery-card">
                    <div className="delivery-heading">
                      <span className="timeline-dot" />
                      <div>
                        <h3>{dest.destinationName || 'Destination'}</h3>
                        <small>
                          {formatTime(dest.sentAt)}
                          {dest.ackCode ? ` · ACK ${dest.ackCode}` : ''}
                        </small>
                      </div>
                      <StatusBadge status={dest.status} />
                    </div>
                    {can('message:resend') &&
                      dest.canResend === true &&
                      ['OUT-ERROR', 'DEAD_LETTER'].includes(dest.status) &&
                      dest.messageId && (
                        <button
                          className="btn-secondary action-button"
                          disabled={resending || loading}
                          onClick={() => {
                            setError('');
                            setConfirm(dest);
                          }}
                        >
                          <RotateCcw size={14} />
                          Review & resend
                        </button>
                      )}
                    {log.payloadAllowed && (
                      <details className="delivery-payload">
                        <summary>
                          Request, outbound & response
                          <ChevronDown size={14} />
                        </summary>
                        <PayloadViewer title="Request data" value={dest.requestData} />
                        <PayloadViewer title="Outbound payload" value={dest.outboundData} />
                        <PayloadViewer title="Destination response" value={dest.responseText} />
                      </details>
                    )}
                  </section>
                ))
              )}
              {log.destinationPagination && (
                <div className="pagination">
                  <span>Results page {log.destinationPagination.page}</span>
                  <div className="heading-actions">
                    <Button
                      variant="secondary"
                      disabled={loading || log.destinationPagination.page <= 1}
                      onClick={() => void loadPage(log.destinationPagination!.page - 1)}
                    >
                      Previous results
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={loading || !log.destinationPagination.hasNext}
                      onClick={() => void loadPage(log.destinationPagination!.page + 1)}
                    >
                      Next results
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
      <Modal
        isOpen={!!confirm}
        onClose={() => {
          if (!resending) setConfirm(null);
        }}
        title="Review before resending"
      >
        <div className="form-body">
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <p>
            Send stored outbound message <strong>#{confirm?.messageId}</strong> again to{' '}
            <strong>{confirm?.destinationName}</strong>.
          </p>
          <p className="muted">
            The stored final payload and destination snapshot are reused. The channel must be
            running. Confirm the receiving system has not already accepted this message.
          </p>
          {confirm && log.payloadAllowed && (
            <PayloadViewer title="Payload to resend" value={confirm.outboundData} />
          )}
          <div className="form-actions">
            <Button variant="secondary" disabled={resending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button disabled={resending} onClick={() => void retry()}>
              {resending ? 'Sending…' : 'Confirm resend'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
