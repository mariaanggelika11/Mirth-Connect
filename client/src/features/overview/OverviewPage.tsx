import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  AlertTriangle,
  Workflow,
  Pause,
} from 'lucide-react';
import type { View } from '../../App';
import { fetchMonitorStats } from '../../services/monitor.api';
import { fetchLogPage } from '../../services/message.api';
import type { LogEntry, MonitorStats } from '../../types';
import {
  EmptyState,
  PageHeading,
  RefreshButton,
  StatusBadge,
  formatTime,
} from '../../components/ui/OperationalUI';
interface Props {
  onNavigate: (view: View, params?: Record<string, string | number>) => void;
}
export default function OverviewPage({ onNavigate }: Props) {
  const [data, setData] = useState<{ stats: MonitorStats; failures: LogEntry[] } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [updated, setUpdated] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [stats, failures] = await Promise.all([
        fetchMonitorStats(),
        fetchLogPage({ direction: 'IN', statusGroup: 'errors', pageSize: 5 }),
      ]);
      setData({ stats, failures: failures.data });
      setUpdated(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load overview');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  const stats = data?.stats;
  const metrics = [
    {
      label: 'Running Channels',
      value: stats?.channelsRunning,
      caption: 'Currently running',
      icon: Workflow,
      action: () => onNavigate('channels'),
    },
    {
      label: 'Stopped Channels',
      value: stats?.channelsStopped,
      caption: 'Currently stopped',
      icon: Pause,
      action: () => onNavigate('channels'),
    },
    {
      label: 'Messages Today',
      value: stats?.messagesToday,
      caption: 'Received since local midnight',
      icon: ArrowDownLeft,
      action: () => onNavigate('messages'),
    },
    {
      label: 'Successful',
      value: stats?.successfulMessages,
      caption: 'Successful inbound messages · retained history',
      icon: CheckCircle2,
      action: () => onNavigate('messages', { direction: 'IN', status: 'SUCCESS' }),
    },
    {
      label: 'Failed',
      value: stats?.failedMessages,
      caption: 'Failed or partially delivered · retained history',
      icon: AlertTriangle,
      action: () => onNavigate('messages', { direction: 'IN', statusGroup: 'errors' }),
    },
    {
      label: 'Retrying',
      value: stats?.retryingMessages,
      caption: 'Queued or currently retrying',
      icon: Clock3,
      action: () => onNavigate('messages', { direction: 'OUT', statusGroup: 'pending' }),
    },
  ];
  return (
    <div className="page-stack">
      <PageHeading
        title="Overview"
        description="Channel status and messages that need attention."
        actions={<RefreshButton onClick={() => void load()} loading={loading} />}
      />
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="metric-grid overview-metrics">
        {metrics.map(({ label, value, caption, icon: Icon, action }) => (
          <button key={label} onClick={action} className="metric-card">
            <div>
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{value === undefined ? '—' : value.toLocaleString('en-US')}</strong>
            <small>{caption}</small>
          </button>
        ))}
      </div>
      <section className="card-bw">
        <div className="panel-heading">
          <div>
            <h2>Recent Failures</h2>
            <p>Latest failed and partially delivered messages.</p>
          </div>
        </div>
        {loading && !data ? (
          <p className="loading-state">Loading messages…</p>
        ) : !data?.failures.length ? (
          <EmptyState
            title="No recent failures"
            description="No failed or partially delivered messages in retained history."
          />
        ) : (
          <div className="attention-list">
            {data.failures.map((log) => (
              <button
                key={log.id}
                onClick={() =>
                  onNavigate('messages', {
                    direction: 'IN',
                    status: log.status || '',
                    messageId: log.id,
                  })
                }
              >
                <span className="attention-icon danger">
                  <AlertTriangle size={17} />
                </span>
                <div>
                  <strong>
                    {log.channelName} · Message #{log.id}
                  </strong>
                  <small>{formatTime(log.timestamp)}</small>
                </div>
                <StatusBadge status={log.status} />
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        )}
        {!!data?.failures.length && (
          <button
            className="panel-link"
            onClick={() => onNavigate('messages', { direction: 'IN', statusGroup: 'errors' })}
          >
            View all failures
            <ArrowRight size={15} />
          </button>
        )}
        <div className="panel-footnote">
          <CheckCircle2 size={14} />
          <span>
            Live data · {updated ? 'Updated ' + formatTime(updated) : 'Waiting for connection'}
          </span>
        </div>
      </section>
    </div>
  );
}
