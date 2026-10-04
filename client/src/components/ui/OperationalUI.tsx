import type { ReactNode } from 'react';
import { ArrowRight, Inbox, RefreshCw } from 'lucide-react';
export function StatusBadge({ status }: { status?: string }) {
  const value = (status || 'UNKNOWN').toUpperCase();
  const good = ['RUNNING', 'SUCCESS', 'OUT-SENT', 'RECEIVED'].includes(value);
  const bad = ['ERROR', 'FAILED', 'IN-ERROR', 'OUT-ERROR', 'DEAD_LETTER'].includes(value);
  const waiting = ['QUEUED', 'RETRYING', 'PARTIAL', 'IN-PROCESS', 'PROCESSING', 'PAUSED'].includes(
    value,
  );
  const labels: Record<string, string> = {
    'OUT-SENT': 'Delivered',
    'OUT-ERROR': 'Delivery failed',
    'IN-ERROR': 'Inbound error',
    DEAD_LETTER: 'Dead letter',
    'IN-PROCESS': 'Processing',
  };
  const label =
    labels[value] ||
    value
      .toLowerCase()
      .replaceAll('_', ' ')
      .replace(/^./, (c) => c.toUpperCase());
  return (
    <span
      className={`status-pill ${good ? 'status-running' : bad ? 'status-error' : waiting ? 'status-warning' : 'status-stopped'}`}
    >
      <span className="status-dot" />
      {label}
    </span>
  );
}
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button
      type="button"
      className="btn-secondary action-button"
      onClick={onClick}
      disabled={loading}
    >
      <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
      Refresh
    </button>
  );
}
export function FlowLabel({ source, destinations }: { source: string; destinations: string[] }) {
  return (
    <span className="flow-label">
      <span>{source || 'Source'}</span>
      <ArrowRight size={14} />
      <span>
        {destinations.length
          ? destinations.length === 1
            ? destinations[0]
            : `${destinations.length} destinations`
          : 'No destination'}
      </span>
    </span>
  );
}
export function formatTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
