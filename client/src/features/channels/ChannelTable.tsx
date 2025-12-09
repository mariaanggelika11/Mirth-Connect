import React, { useState } from "react";
import { Channel, ChannelStatus, Destination, DestinationType } from "../../types";
import { updateChannelStatus } from "../../services/channel.api";
import { PlayIcon, StopIcon, EditIcon, TrashIcon, ChevronDownIcon, CodeIcon } from "../../components/icons/Icon";

interface ChannelTableProps {
  channels: Channel[];
  onRefresh: () => void;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
}

const StatusIndicator: React.FC<{ status?: ChannelStatus | string }> = ({ status }) => {
  const normalizedStatus = (status || "").toString().trim().toUpperCase();

  const map = {
    RUNNING: { text: "Running", cls: "status-pill status-running" },
    STOPPED: { text: "Stopped", cls: "status-pill status-stopped" },
    ERROR: { text: "Error", cls: "status-pill status-error" },
  };

  const config = map[normalizedStatus as keyof typeof map] || map.STOPPED;

  return <span className={config.cls}>{config.text}</span>;
};

const ScriptDisplay: React.FC<{ title: string; script?: string }> = ({ title, script }) => {
  if (!script) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <CodeIcon /> {title}
      </div>
      <pre className="code-box">
        <code>{script}</code>
      </pre>
    </div>
  );
};

const DestinationRow: React.FC<{ destination: Destination }> = ({ destination }) => {
  const [isScriptVisible, setIsScriptVisible] = useState(false);

  return (
    <>
      <tr>
        <td>{destination.name}</td>
        <td>{destination.type}</td>
        <td>{destination.endpoint}</td>
        <td style={{ textAlign: "center" }}>
          {destination.processingScript ? (
            <button onClick={() => setIsScriptVisible(!isScriptVisible)} className="icon-btn">
              <CodeIcon /> {isScriptVisible ? "Hide" : "View"}
            </button>
          ) : (
            "-"
          )}
        </td>
        <td style={{ textAlign: "center" }}>{(destination.sent ?? 0).toLocaleString()}</td>
        <td style={{ textAlign: "center" }}>{(destination.errors ?? 0).toLocaleString()}</td>
      </tr>

      {isScriptVisible && destination.processingScript && (
        <tr>
          <td colSpan={6}>
            <ScriptDisplay title={`${destination.name} - Script`} script={destination.processingScript} />
          </td>
        </tr>
      )}
    </>
  );
};

const ChannelRow: React.FC<{
  channel: Channel;
  onRefresh: () => void;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
}> = ({ channel, onRefresh, onEdit, onDelete }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (newStatus: ChannelStatus) => {
    setIsUpdating(true);
    try {
      await updateChannelStatus(channel.id, newStatus);
      onRefresh();
    } finally {
      setIsUpdating(false);
    }
  };

  const isStopped = channel.status?.toString().toUpperCase() === "STOPPED" || channel.status?.toString().toUpperCase() === "ERROR";

  return (
    <>
      <tr className="table-row">
        <td>
          <button onClick={() => setIsExpanded(!isExpanded)} className="icon-btn">
            <ChevronDownIcon style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }} />
          </button>
          <strong style={{ marginLeft: 6 }}>{channel.name}</strong>
          <div style={{ fontSize: 11, color: "var(--text-soft)" }}>{channel.id}</div>
        </td>

        <td>
          <StatusIndicator status={channel.status} />
        </td>

        <td>{channel.source.endpoint}</td>

        <td style={{ textAlign: "center" }}>{(channel.received ?? 0).toLocaleString()}</td>

        <td style={{ textAlign: "center" }}>{channel.destinations ? channel.destinations.reduce((t, d) => t + (d.sent ?? 0), 0).toLocaleString() : 0}</td>

        <td style={{ textAlign: "center" }}>{channel.destinations ? channel.destinations.reduce((t, d) => t + (d.errors ?? 0), 0).toLocaleString() : 0}</td>

        <td style={{ textAlign: "right" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            {isStopped ? (
              <button onClick={() => handleStatusChange(ChannelStatus.RUNNING)} disabled={isUpdating} className="icon-btn">
                <PlayIcon />
              </button>
            ) : (
              <button onClick={() => handleStatusChange(ChannelStatus.STOPPED)} disabled={isUpdating} className="icon-btn">
                <StopIcon />
              </button>
            )}

            <button onClick={() => onEdit(channel)} className="icon-btn">
              <EditIcon />
            </button>

            <button onClick={() => onDelete(channel)} className="icon-btn icon-btn-danger">
              <TrashIcon />
            </button>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={7}>
            <div className="card-bw" style={{ padding: 12 }}>
              <h4 style={{ fontWeight: 600, marginBottom: 8 }}>Destinations</h4>

              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Endpoint</th>
                    <th style={{ textAlign: "center" }}>Script</th>
                    <th style={{ textAlign: "center" }}>Sent</th>
                    <th style={{ textAlign: "center" }}>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {channel.destinations.map((dest) => (
                    <DestinationRow key={dest.id} destination={dest} />
                  ))}
                </tbody>
              </table>

              <div style={{ display: "flex", gap: 16 }}>
                <ScriptDisplay title="Channel Processing Script" script={channel.processingScript} />
                <ScriptDisplay title="Channel Response Script" script={channel.responseScript} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const ChannelTable: React.FC<ChannelTableProps> = ({ channels, onRefresh, onEdit, onDelete }) => {
  return (
    <div className="card-bw">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Source</th>
            <th style={{ textAlign: "center" }}>Received</th>
            <th style={{ textAlign: "center" }}>Sent</th>
            <th style={{ textAlign: "center" }}>Errors</th>
            <th style={{ textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} onRefresh={onRefresh} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ChannelTable;
