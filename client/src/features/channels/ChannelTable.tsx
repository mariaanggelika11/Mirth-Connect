import { useState, useEffect, useRef } from 'react';
import { downloadChannelXml } from '../../services/channel.config';
import {
  ChevronDown,
  Copy,
  Download,
  MoreHorizontal,
  Play,
  Square,
  Pencil,
  Trash2,
  ArrowRight,
  Workflow,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Channel, ChannelStatus } from '../../types';
import { updateChannelStatus } from '../../services/channel.api';
import { StatusBadge, FlowLabel, EmptyState } from '../../components/ui/OperationalUI';
interface Props {
  channels: Channel[];
  onRefresh: () => void;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
  onViewMessages?: (id: number) => void;
  onDuplicate?: (channel: Channel) => void;
}
function ChannelRow({
  channel,
  onRefresh,
  onEdit,
  onDelete,
  onViewMessages,
  onDuplicate,
}: Omit<Props, 'channels'> & { channel: Channel }) {
  const { can } = useAuth();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => {
      menuRef.current?.removeAttribute('open');
    };
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menuOpen]);
  const [expanded, setExpanded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const running = channel.status === ChannelStatus.RUNNING;
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      await updateChannelStatus(
        channel.id,
        running ? ChannelStatus.STOPPED : ChannelStatus.RUNNING,
      );
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status update failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <tr className="table-row">
        <td>
          <button
            className="channel-name"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <span className="connection-icon">
              <Workflow size={17} />
            </span>
            <span>
              <strong>{channel.name}</strong>
              <small>Channel #{channel.id}</small>
            </span>
            <ChevronDown size={15} className={expanded ? 'rotate-180' : ''} />
          </button>
        </td>
        <td>
          <StatusBadge status={channel.status} />
        </td>
        <td>
          <FlowLabel
            source={channel.source.type}
            destinations={channel.destinations.map((d) => d.name)}
          />
          <small className="table-subtext truncate-endpoint" title={channel.source.endpoint}>
            {channel.source.endpoint || 'Endpoint not configured'}
          </small>
        </td>
        <td className="numeric">
          <strong>{(channel.received ?? 0).toLocaleString()}</strong>
          <small className="table-subtext">{(channel.sent ?? 0).toLocaleString()} sent</small>
        </td>
        <td className="numeric">
          <span className={(channel.errors ?? 0) > 0 ? 'error-count' : 'muted'}>
            {(channel.errors ?? 0).toLocaleString()}
          </span>
        </td>
        <td>
          <div className="row-actions">
            {can('channel:operate') && (
              <button
                className={`operation-button ${running ? '' : 'start'}`}
                disabled={busy}
                aria-label={running ? 'Stop channel' : 'Start channel'}
                onClick={() => void toggle()}
              >
                {running ? <Square size={13} /> : <Play size={13} />}
                <span>{busy ? 'Updating…' : running ? 'Stop' : 'Start'}</span>
              </button>
            )}
            <details
              className="action-menu"
              ref={menuRef}
              onToggle={(event) => {
                const element = event.currentTarget;
                setMenuOpen(element.open);
                if (element.open) {
                  const rect = element.getBoundingClientRect();
                  setMenuPoint({
                    left: Math.max(8, rect.left - 170),
                    top: Math.max(8, Math.min(rect.top, window.innerHeight - 240)),
                  });
                }
              }}
            >
              <summary aria-label={`More actions for ${channel.name}`}>
                <MoreHorizontal size={20} />
              </summary>
              <div
                className="action-popover"
                style={{
                  position: 'fixed',
                  left: menuPoint.left,
                  top: menuPoint.top,
                  right: 'auto',
                  transform: 'none',
                }}
                onClick={() => menuRef.current?.removeAttribute('open')}
              >
                <button onClick={() => onViewMessages?.(channel.id)}>
                  <ArrowRight size={15} />
                  View messages
                </button>
                {can('channel:write') && (
                  <button aria-label="Edit channel" onClick={() => onEdit(channel)}>
                    <Pencil size={15} />
                    Edit channel
                  </button>
                )}
                {can('channel:write') && (
                  <>
                    <button onClick={() => onDuplicate?.(channel)}>
                      <Copy size={15} />
                      Duplicate channel
                    </button>
                    <button onClick={() => downloadChannelXml(channel)}>
                      <Download size={15} />
                      Export XML
                    </button>
                  </>
                )}
                {can('channel:delete') && (
                  <button
                    className="danger"
                    aria-label="Delete channel"
                    disabled={running}
                    title={running ? 'Stop the channel before deleting' : 'Delete channel'}
                    onClick={() => onDelete(channel)}
                  >
                    <Trash2 size={15} />
                    Delete channel
                  </button>
                )}
              </div>
            </details>
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="expanded-row">
          <td colSpan={6}>
            <div className="channel-detail">
              <div className="section-header">
                <div>
                  <h3>Connection details</h3>
                  <p>
                    {channel.source.inboundDataType || 'HL7V2'} source ·{' '}
                    {channel.destinations.length} destination
                    {channel.destinations.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <button className="text-button" onClick={() => onViewMessages?.(channel.id)}>
                  View messages
                  <ArrowRight size={14} />
                </button>
              </div>
              {!channel.destinations.length ? (
                <p className="muted">
                  No destinations configured. Add one in the channel editor to deliver messages.
                </p>
              ) : (
                <div className="destination-summary-list">
                  {channel.destinations.map((d, i) => (
                    <div key={d.id ?? i}>
                      <span className="step-number">{i + 1}</span>
                      <div>
                        <strong>{d.name}</strong>
                        <small className="break-anywhere">{d.endpoint}</small>
                      </div>
                      <span className="role-badge">{d.type}</span>
                      <span className="muted">
                        {d.isEnabled === false
                          ? 'Disabled'
                          : d.retryEnabled
                            ? 'Enabled · retry on'
                            : 'Enabled'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {can('channel:write') && (
                <details className="advanced-section">
                  <summary>Processing scripts</summary>
                  {[
                    { name: 'Source transformer', script: channel.processingScript },
                    { name: 'Source filter', script: channel.filterScript },
                    { name: 'Source response', script: channel.responseScript },
                  ].map((s) => (
                    <div key={s.name}>
                      <strong>{s.name}</strong>
                      <pre className="code-box">{s.script || 'No script configured'}</pre>
                    </div>
                  ))}
                </details>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
export default function ChannelTable(props: Props) {
  return (
    <div className="card-bw">
      <div className="table-scroll">
        <table className="table channel-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Status</th>
              <th>Connection</th>
              <th className="numeric">Traffic</th>
              <th className="numeric">Errors</th>
              <th className="actions-column">Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.channels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                onRefresh={props.onRefresh}
                onEdit={props.onEdit}
                onDelete={props.onDelete}
                onViewMessages={props.onViewMessages}
                onDuplicate={props.onDuplicate}
              />
            ))}
          </tbody>
        </table>
      </div>
      {!props.channels.length && (
        <EmptyState
          title="No channels found"
          description="Adjust your search or create a connection to get started."
        />
      )}
    </div>
  );
}
