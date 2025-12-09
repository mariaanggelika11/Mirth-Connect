import React, { useState, useEffect } from "react";
import { LogEntry } from "../../types";
import { ChevronDownIcon } from "../../components/icons/Icon";
import { sendToDestinations } from "../../services/destination.api";
import { Button } from "../../components/ui/Button";

interface LogStreamProps {
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
  isGrouped: boolean;
  onResend: (logId: number) => void;
  onViewLogs: (message: LogEntry) => void;
}

const GroupedLogs: React.FC<{
  logs: LogEntry[];
  onResend: (logId: number) => void;
  onViewLogs: (message: LogEntry) => void;
}> = ({ logs, onResend, onViewLogs }) => {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const nextGroups: Record<string, boolean> = {};
    logs.forEach((log) => {
      const name = log.channelName || "Unknown Channel";
      nextGroups[name] = true;
    });
    setOpenGroups(nextGroups);
  }, [logs]);

  const grouped = logs.reduce((acc, log) => {
    const name = log.channelName || "Unknown Channel";
    (acc[name] = acc[name] || []).push(log);
    return acc;
  }, {} as Record<string, LogEntry[]>);

  const toggleGroup = (channelName: string) => {
    setOpenGroups((prev) => ({ ...prev, [channelName]: !prev[channelName] }));
  };

  const formatTimestamp = (timestamp: string | Date) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return String(timestamp);
    }
  };

  const handleSend = async (channelId: number, messageId: number, payload: any) => {
    try {
      await sendToDestinations(channelId, messageId, payload);
      alert("Payload berhasil dikirim ke semua destination!");
    } catch (err: any) {
      alert(`Gagal mengirim payload: ${err.message || String(err)}`);
    }
  };

  const renderPlainStatus = (status?: string) => {
    if (!status) return "UNKNOWN";
    if (status.toUpperCase() === "OUT-SENT") return "SUCCESS";
    if (status.toUpperCase().includes("ERROR")) return "ERROR";
    return status;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Object.entries(grouped).map(([channelName, groupLogs]) => (
        <div key={channelName} className="card-bw">
          <button
            onClick={() => toggleGroup(channelName)}
            style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "var(--bg-soft)", borderBottom: "1px solid var(--border-main)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ChevronDownIcon className={openGroups[channelName] ? "rotate-180" : ""} />
              <strong>{channelName}</strong>
              <span className="status-pill">{groupLogs.length} entries</span>
            </div>
          </button>

          {openGroups[channelName] && (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Timestamp</th>
                  <th>Message</th>
                  <th style={{ width: 120, textAlign: "center" }}>Status</th>
                  <th style={{ width: 180, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groupLogs.map((log) => (
                  <tr key={log.id} className="table-row">
                    <td>{formatTimestamp(log.timestamp)}</td>
                    <td style={{ wordBreak: "break-all" }}>{log.message}</td>
                    <td style={{ textAlign: "center" }}>{renderPlainStatus(log.status)}</td>
                    <td style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <Button size="sm" onClick={() => handleSend(log.channelId, log.id, log.originalPayload || {})}>
                        Send
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => onViewLogs(log)}>
                        View Logs
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
};

const LogStream: React.FC<LogStreamProps> = ({ logs, loading, error, isGrouped, onResend, onViewLogs }) => {
  if (loading)
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <div className="status-pill">Loading...</div>
      </div>
    );

  if (error)
    return (
      <div className="card-bw" style={{ padding: 24 }}>
        {error}
      </div>
    );
  if (logs.length === 0)
    return (
      <div className="card-bw" style={{ padding: 24 }}>
        No logs match the current filters.
      </div>
    );

  return <GroupedLogs logs={logs} onResend={onResend} onViewLogs={onViewLogs} />;
};

export default LogStream;
