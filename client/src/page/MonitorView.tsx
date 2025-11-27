import React, { useState, useEffect, useCallback } from "react";
import { fetchLogs, fetchChannels } from "../services/api";
import { LogEntry, Channel, LogLevel } from "../types";
import { RefreshIcon } from "../components/icons/Icon";
import { Button } from "../components/shared/Button";
import LogDetailModal from "../page/LogDetailModal";

/* LEVEL ICON */
const LogLevelIndicator: React.FC<{ level: LogLevel }> = ({ level }) => {
  const colors: Record<LogLevel, string> = {
    INFO: "bg-sky-500",
    DEBUG: "bg-gray-500",
    WARN: "bg-yellow-500",
    ERROR: "bg-red-500",
  };

  return <div className={`w-2.5 h-2.5 rounded-full ${colors[level]}`} />;
};

const StatusTag: React.FC<{ log: LogEntry }> = ({ log }) => {
  const inbound = log.status ?? "UNKNOWN";
  const dests = log.destinationLogs ?? [];

  const total = dests.length;
  const sent = dests.filter((d) => d.status === "OUT-SENT").length;
  const fails = dests.filter((d) => d.status === "OUT-ERROR").length;

  let label = "";
  let color = "";

  if (inbound === "IN-ERROR") {
    label = "INBOUND ERROR";
    color = "bg-red-800 text-red-200";
  } else if (total === 0) {
    label = "RECEIVED";
    color = "bg-blue-800 text-blue-200";
  } else if (sent === total) {
    label = "SUCCESS";
    color = "bg-green-700 text-green-100";
  } else if (sent > 0 && fails > 0) {
    label = "PARTIAL";
    color = "bg-yellow-600 text-yellow-100";
  } else if (fails === total) {
    label = "FAILED";
    color = "bg-red-600 text-red-100";
  } else {
    label = inbound;
    color = "bg-gray-700 text-gray-300";
  }

  return <span className={`px-3 py-1 text-xs rounded-full font-bold tracking-wide ${color}`}>{label}</span>;
};

/* MAIN MONITOR */
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
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Message Monitor</h2>
          <p className="text-slate-400 mt-1">Real-time summary of channel message flows.</p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <select value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)} className="w-full sm:w-56 bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white">
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

      {/* TABLE */}
      <div className="overflow-x-auto bg-slate-800/40 rounded-lg border border-slate-700 shadow-lg">
        <table className="min-w-full divide-y divide-slate-700 text-sm">
          <thead className="bg-slate-800">
            <tr>
              <th className="p-4"></th>
              <th className="p-4 text-left text-xs text-slate-400 uppercase">Timestamp</th>
              <th className="p-4 text-left text-xs text-slate-400 uppercase">Channel</th>
              <th className="p-4 text-left text-xs text-slate-400 uppercase">Status</th>
              <th className="p-4 text-left text-xs text-slate-400 uppercase">Info</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-700">
            {inboundLogs.map((log) => (
              <tr key={log.id} className="hover:bg-slate-700/40 cursor-pointer transition" onClick={() => setSelectedLog(log)}>
                <td className="p-4">
                  <LogLevelIndicator level={log.level} />
                </td>

                <td className="p-4 font-mono text-slate-400 whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleString("en-US", {
                    timeZone: "America/New_York",
                  })}
                </td>

                <td className="p-4 text-slate-200 font-semibold">{log.channelName}</td>

                <td className="p-4">
                  <StatusTag log={log} />
                </td>

                <td className="p-4 text-slate-400 italic">
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
