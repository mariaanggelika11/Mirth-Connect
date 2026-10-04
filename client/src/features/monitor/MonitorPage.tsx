import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, SlidersHorizontal, X, ArrowRight } from 'lucide-react';
import { fetchChannels } from '../../services/channel.api';
import { fetchLogPage, fetchLogDetail } from '../../services/message.api';
import { LogEntry, Channel } from '../../types';
import { Button } from '../../components/ui/Button';
import {
  EmptyState,
  PageHeading,
  RefreshButton,
  StatusBadge,
  formatTime,
} from '../../components/ui/OperationalUI';
import LogDetailModal from './LogDetailModal';
interface Props {
  initialFilters?: {
    channelId?: string;
    status?: string;
    statusGroup?: 'errors' | 'pending';
    direction?: string;
    messageId?: number;
  };
}
const statuses = [
  'RECEIVED',
  'SUCCESS',
  'PARTIAL',
  'FAILED',
  'IN-ERROR',
  'IN-PROCESS',
  'PROCESSING',
  'OUT-SENT',
  'OUT-ERROR',
  'QUEUED',
  'RETRYING',
  'DEAD_LETTER',
  'FILTERED',
];
export default function MonitorView({ initialFilters = {} }: Props) {
  const version = useRef(0),
    detailVersion = useRef(0);
  const [logs, setLogs] = useState<LogEntry[]>([]),
    [channels, setChannels] = useState<Channel[]>([]),
    [loading, setLoading] = useState(true),
    [selectedChannel, setSelectedChannel] = useState(initialFilters.channelId || 'ALL'),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [status, setStatus] = useState(initialFilters.status || ''),
    [group, setGroup] = useState<'errors' | 'pending' | undefined>(initialFilters.statusGroup),
    [direction, setDirection] = useState(initialFilters.direction || 'IN'),
    [search, setSearch] = useState(''),
    [appliedSearch, setAppliedSearch] = useState(''),
    [dateFrom, setDateFrom] = useState(''),
    [dateTo, setDateTo] = useState(''),
    [error, setError] = useState(''),
    [selectedLog, setSelectedLog] = useState<LogEntry | null>(null),
    [openingId, setOpeningId] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    setError('');
    try {
      if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo))
        throw new Error('Start date must be before end date.');
      const [result, c] = await Promise.all([
        fetchLogPage({
          channelId: selectedChannel === 'ALL' ? undefined : Number(selectedChannel),
          page,
          direction,
          status: status || undefined,
          statusGroup: group,
          search: appliedSearch || undefined,
          dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
          dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
        }),
        fetchChannels(),
      ]);
      if (current !== version.current) return;
      setLogs(result.data);
      setTotal(result.pagination.total);
      setChannels(c);
    } catch (e) {
      if (current === version.current)
        setError(e instanceof Error ? e.message : 'Unable to load messages');
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [selectedChannel, page, direction, status, group, appliedSearch, dateFrom, dateTo]);
  useEffect(() => {
    void load();
    return () => {
      version.current++;
    };
  }, [load]);
  const view = useCallback(async (id: number) => {
    const current = ++detailVersion.current;
    setOpeningId(id);
    setError('');
    try {
      const result = await fetchLogDetail(id);
      if (current === detailVersion.current) setSelectedLog(result);
    } catch (e) {
      if (current === detailVersion.current)
        setError(e instanceof Error ? e.message : 'Unable to open message');
    } finally {
      if (current === detailVersion.current) setOpeningId(null);
    }
  }, []);
  useEffect(() => {
    if (initialFilters.messageId) void view(initialFilters.messageId);
    return () => {
      detailVersion.current++;
    };
  }, [initialFilters.messageId, view]);
  const filtered =
    group ||
    selectedChannel !== 'ALL' ||
    status ||
    search ||
    dateFrom ||
    dateTo ||
    direction !== 'IN';
  return (
    <div className="page-stack">
      <PageHeading
        title="Messages"
        description="Trace each message, review delivery results, and resolve failures."
        actions={<RefreshButton onClick={() => void load()} loading={loading} />}
      />
      <div className="message-presets">
        <button
          className={!status && !group ? 'active' : ''}
          onClick={() => {
            setStatus('');
            setGroup(undefined);
            setPage(1);
          }}
        >
          All messages
        </button>
        <button
          className={group === 'errors' ? 'active' : ''}
          onClick={() => {
            setDirection('ALL');
            setGroup('errors');
            setStatus('');
            setPage(1);
          }}
        >
          Errors
        </button>
        <button
          className={group === 'pending' ? 'active' : ''}
          onClick={() => {
            setDirection('OUT');
            setStatus('');
            setGroup('pending');
            setPage(1);
          }}
        >
          Waiting for retry
        </button>
        <button
          className={status === 'DEAD_LETTER' ? 'active' : ''}
          onClick={() => {
            setDirection('OUT');
            setStatus('DEAD_LETTER');
            setGroup(undefined);
            setPage(1);
          }}
        >
          Dead letters
        </button>
      </div>
      <section className="card-bw">
        <div className="filter-toolbar message-filters">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Search message ID or channel"
              placeholder="Search message ID or channel…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            className="input-bw"
            aria-label="Channel"
            value={selectedChannel}
            onChange={(e) => {
              setSelectedChannel(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All channels</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Direction"
            className="input-bw"
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value);
              setStatus('');
              setPage(1);
            }}
          >
            <option value="ALL">All directions</option>
            <option value="IN">Inbound</option>
            <option value="OUT">Outbound</option>
          </select>
          <details className="filter-details">
            <summary>
              <SlidersHorizontal size={15} />
              More filters
            </summary>
            <div>
              <label className="field">
                <span>Status</span>
                <select
                  aria-label="Status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setGroup(undefined);
                    setPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>From date</span>
                <input
                  aria-label="From date"
                  type="datetime-local"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label className="field">
                <span>To date</span>
                <input
                  aria-label="To date"
                  type="datetime-local"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            </div>
          </details>
          {filtered && (
            <button
              className="text-button"
              onClick={() => {
                setSelectedChannel('ALL');
                setStatus('');
                setGroup(undefined);
                setSearch('');
                setAppliedSearch('');
                setDateFrom('');
                setDateTo('');
                setDirection('IN');
                setPage(1);
              }}
            >
              <X size={14} />
              Clear filters
            </button>
          )}
        </div>
        {error && (
          <div className="alert error table-alert" role="alert">
            {error}
          </div>
        )}
        <div className="table-scroll">
          <table className="table message-table">
            <thead>
              <tr>
                <th>Message</th>
                <th>Received</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Delivery</th>
                <th>Retries</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="loading-state">
                    Loading messages…
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const deliveries = log.destinationLogs || [],
                    sent = deliveries.filter((d) => d.status === 'OUT-SENT').length;
                  return (
                    <tr key={log.id} className="table-row">
                      <td>
                        <button
                          className="message-id"
                          onClick={() => void view(log.id)}
                          aria-label={`Open message ${log.id}`}
                          disabled={openingId !== null}
                        >
                          #{log.id}
                          <small>{log.direction || direction}</small>
                        </button>
                      </td>
                      <td className="nowrap">{formatTime(log.timestamp)}</td>
                      <td>
                        <strong>{log.channelName}</strong>
                      </td>
                      <td>
                        <StatusBadge status={log.status} />
                      </td>
                      <td className="muted">
                        {deliveries.length
                          ? `${sent} / ${deliveries.length} delivered`
                          : log.direction === 'OUT'
                            ? 'Outbound delivery'
                            : 'Inbound only'}
                      </td>
                      <td>
                        {log.retryCount ?? 0}
                        {log.nextRetryAt && (
                          <small className="table-subtext">
                            Next: {formatTime(log.nextRetryAt)}
                          </small>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon-btn"
                          aria-label={`View message ${log.id} details`}
                          disabled={openingId !== null}
                          onClick={() => void view(log.id)}
                        >
                          {openingId === log.id ? '…' : <ArrowRight size={17} />}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && !logs.length && (
          <EmptyState
            title={error ? 'Messages unavailable' : 'No messages found'}
            description={
              error
                ? 'Try refreshing once the connection is available.'
                : filtered
                  ? 'Adjust your filters to see more messages.'
                  : 'Start a channel and send a message to see its journey here.'
            }
          />
        )}
        <div className="pagination">
          <span>
            {total.toLocaleString()} messages{' '}
            <span className="muted">
              · Page {page} of {Math.max(1, Math.ceil(total / 50))}
            </span>
          </span>
          <div className="heading-actions">
            <Button
              variant="secondary"
              disabled={loading || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={loading || page * 50 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </section>
      {selectedLog && (
        <LogDetailModal
          log={selectedLog}
          onClose={() => {
            setSelectedLog(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
