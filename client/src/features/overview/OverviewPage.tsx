import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  AlertTriangle,
  Workflow,
} from 'lucide-react';
import type { View } from '../../App';
import { fetchChannels } from '../../services/channel.api';
import { fetchMonitorStats } from '../../services/monitor.api';
import { fetchLogPage } from '../../services/message.api';
import { api, API_BASE_URL } from '../../services/api';
import type { Channel, LogEntry, MonitorStats } from '../../types';
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
  const [data, setData] = useState<{
    channels: Channel[];
    stats: MonitorStats;
    failures: LogEntry[];
  } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [database, setDatabase] = useState<boolean | null>(null),
    [updated, setUpdated] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [channels, stats, failures, ready] = await Promise.all([
        fetchChannels(),
        fetchMonitorStats(),
        fetchLogPage({ direction: 'ALL', statusGroup: 'errors', pageSize: 5 }),
        api
          .get(API_BASE_URL + '/ready', { baseURL: '' })
          .then(() => true)
          .catch(() => false),
      ]);
      setData({ channels, stats, failures: failures.data });
      setDatabase(ready);
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
      label: 'Active channels',
      value: stats?.channelsRunning,
      caption: `of ${data?.channels.length ?? '—'} configured`,
      icon: Workflow,
      action: () => onNavigate('channels'),
    },
    {
      label: 'Received today',
      value: stats?.messagesToday,
      caption: 'Since midnight in your time zone',
      icon: ArrowDownLeft,
      action: () => onNavigate('messages'),
    },
    {
      label: 'Message errors',
      value: stats?.totalErrors,
      caption: 'Across retained message history',
      icon: AlertTriangle,
      action: () => onNavigate('messages', { direction: 'ALL', statusGroup: 'errors' }),
    },
    {
      label: 'Waiting for retry',
      value: stats?.queuedMessages,
      caption: 'Queued or currently retrying',
      icon: Clock3,
      action: () => onNavigate('messages', { direction: 'OUT', statusGroup: 'pending' }),
    },
  ];
  const problemChannels =
    data?.channels.filter(
      (c) => c.status === 'ERROR' || !c.destinations.some((d) => d.isEnabled !== false),
    ) || [];
  return (
    <div className="page-stack">
      <PageHeading
        title="Overview"
        description="Your integrations, at a glance. Start with what needs attention."
        actions={<RefreshButton onClick={() => void load()} loading={loading} />}
      />
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="health-strip">
        <div>
          <span className="health-icon">
            <Activity size={19} />
          </span>
          <div>
            <strong>Workspace health</strong>
            <small>
              {database === null
                ? 'Checking database connection…'
                : database
                  ? 'Database is connected'
                  : 'Database connection needs attention'}
            </small>
          </div>
        </div>
        <span
          className={`status-pill ${database ? 'status-running' : database === null ? 'status-stopped' : 'status-error'}`}
        >
          <span className="status-dot" />
          {database ? 'Database ready' : database === null ? 'Checking' : 'Unavailable'}
        </span>
      </div>
      <div className="metric-grid">
        {metrics.map(({ label, value, caption, icon: Icon, action }) => (
          <button key={label} onClick={action} className="metric-card">
            <div>
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{value === undefined ? '—' : value.toLocaleString()}</strong>
            <small>{caption}</small>
          </button>
        ))}
      </div>
      <div className="overview-grid">
        <section className="card-bw">
          <div className="panel-heading">
            <div>
              <h2>Needs attention</h2>
              <p>Failed deliveries and incomplete connections.</p>
            </div>
            <span className="count-badge">
              {(stats?.totalErrors ?? 0) + problemChannels.length}
            </span>
          </div>
          {loading && !data ? (
            <p className="loading-state">Loading workspace…</p>
          ) : !problemChannels.length && !data?.failures.length ? (
            <EmptyState
              title="All clear"
              description="No message failures or channel configuration issues right now."
            />
          ) : (
            <div className="attention-list">
              {data?.failures.map((log) => (
                <button
                  key={'m' + log.id}
                  onClick={() =>
                    onNavigate('messages', {
                      direction: log.direction || 'IN',
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
                    <small>Delivery needs review before sending again</small>
                  </div>
                  <ArrowRight size={16} />
                </button>
              ))}
              {problemChannels.slice(0, 5).map((c) => (
                <button
                  key={'c' + c.id}
                  onClick={() => onNavigate('channels', { channelId: c.id })}
                >
                  <span className="attention-icon">
                    <Workflow size={17} />
                  </span>
                  <div>
                    <strong>{c.name}</strong>
                    <small>
                      {c.status === 'ERROR'
                        ? 'Channel is in an error state'
                        : 'No enabled destination configured'}
                    </small>
                  </div>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
          )}
          {!!data?.failures.length && (
            <button
              className="panel-link"
              onClick={() => onNavigate('messages', { direction: 'ALL', statusGroup: 'errors' })}
            >
              View all message errors
              <ArrowRight size={15} />
            </button>
          )}
        </section>
        <section className="card-bw">
          <div className="panel-heading">
            <div>
              <h2>Channel activity</h2>
              <p>Status of your configured connections.</p>
            </div>
            <button className="text-button" onClick={() => onNavigate('channels')}>
              View all
              <ArrowRight size={14} />
            </button>
          </div>
          {!data?.channels.length ? (
            <EmptyState
              title={loading ? 'Loading channels…' : 'No channels yet'}
              description="Create your first connection from the Channels page."
            />
          ) : (
            <div className="channel-activity">
              {data.channels.slice(0, 5).map((c) => (
                <button key={c.id} onClick={() => onNavigate('channels', { channelId: c.id })}>
                  <span className="connection-icon">
                    <Workflow size={18} />
                  </span>
                  <div>
                    <strong>{c.name}</strong>
                    <small>
                      {c.source.type || 'Source'} → {c.destinations.length} destinations
                    </small>
                  </div>
                  <StatusBadge status={c.status} />
                </button>
              ))}
            </div>
          )}
          <div className="panel-footnote">
            <CheckCircle2 size={14} />
            <span>
              Live data · {updated ? 'Updated ' + formatTime(updated) : 'Waiting for connection'}
            </span>
          </div>
        </section>
      </div>
      <div className="getting-started">
        <div>
          <h2>Every connection has a clear path.</h2>
          <p>Configure a channel, start it, and follow each message from source to destination.</p>
        </div>
        <button className="btn-secondary action-button" onClick={() => onNavigate('channels')}>
          Explore channels
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
