import React, { useState, useEffect, useCallback } from "react";
import { fetchChannels } from "../../services/channel.api";
import { fetchLogs } from "../../services/message.api";
import { LogEntry, Channel, LogLevel } from "../../types";
import { RefreshIcon } from "../../components/icons/Icon";
import { Button } from "../../components/ui/Button";
import LogDetailModal from "./LogDetailModal";

const LogLevelIndicator: React.FC<{ level: LogLevel }> = ({ level }) => {
  const map: Record<LogLevel, string> = {
    INFO: "status-pill status-running",
    DEBUG: "status-pill status-stopped",
    WARN: "status-pill status-stopped",
    ERROR: "status-pill status-error",
  };

  return <span className={map[level]}>{level}</span>;
};

const StatusTag: React.FC<{ log: LogEntry }> = ({ log }) => {
  const inbound = log.status ?? "UNKNOWN";
  const dests = log.destinationLogs ?? [];

  const total = dests.length;
  const sent = dests.filter((d) => d.status === "OUT-SENT").length;
  const fails = dests.filter((d) => d.status === "OUT-ERROR").length;

  let label = inbound;

  if (inbound === "IN-ERROR") label = "INBOUND ERROR";
  else if (total === 0) label = "RECEIVED";
  else if (sent === total) label = "SUCCESS";
  else if (sent > 0 && fails > 0) label = "PARTIAL";
  else if (fails === total) label = "FAILED";

  return <span className="status-pill">{label}</span>;
};

const MonitorView: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<string>("ALL");
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const chanId = selectedChannel === "ALL" ? undefined : parseInt(selectedChannel, 10);
      const [logData, chanData] = await Promise.all([fetchLogs(chanId), fetchChannels()]);
      setLogs(logData);
      setChannels(chanData);
    } finally {
      setLoading(false);
    }
  }, [selectedChannel]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const inboundLogs = logs.filter((l) => l.direction === "IN");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="card-bw" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Message Monitor</h2>
          <p style={{ color: "var(--text-soft)", fontSize: 14 }}>Real-time summary of channel message flows</p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <select value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)} className="input-bw" style={{ minWidth: 200 }}>
            <option value="ALL">All Channels</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <Button variant="secondary" onClick={loadData} disabled={loading}>
            <RefreshIcon className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      <div className="card-bw">
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th>Timestamp</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Info</th>
            </tr>
          </thead>

          <tbody>
            {inboundLogs.map((log) => (
              <tr key={log.id} className="table-row" onClick={() => setSelectedLog(log)} style={{ cursor: "pointer" }}>
                <td>
                  <LogLevelIndicator level={log.level} />
                </td>

                <td style={{ fontFamily: "monospace", fontSize: 13 }}>{new Date(log.timestamp).toLocaleString()}</td>

                <td style={{ fontWeight: 600 }}>{log.channelName}</td>

                <td>
                  <StatusTag log={log} />
                </td>

                <td style={{ color: "var(--text-soft)", fontStyle: "italic" }}>
                  {(() => {
                    const dests = log.destinationLogs ?? [];
                    const total = dests.length;
                    const ok = dests.filter((d) => d.status === "OUT-SENT").length;
                    const fail = dests.filter((d) => d.status === "OUT-ERROR").length;

                    if (total === 0) return "Inbound only";
                    if (ok === total) return `${ok}/${total} OK`;
                    if (fail === total) return `${fail}/${total} FAILED`;
                    return `${ok} OK / ${fail} FAIL`;
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedLog && <LogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
};

export default MonitorView;
