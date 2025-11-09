import React, { useState, useEffect } from "react";
import { LogEntry } from "../types";
import { ChevronDownIcon } from "../components/icons/Icon";
import { sendToDestinations } from "../services/api";

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
  const [autoRefresh, setAutoRefresh] = useState<NodeJS.Timeout | null>(null);

  // Buka semua grup otomatis
  useEffect(() => {
    const nextGroups: Record<string, boolean> = {};
    logs.forEach((log) => {
      const name = log.channelName || "Unknown Channel";
      nextGroups[name] = true;
    });
    setOpenGroups(nextGroups);
  }, [logs]);

  // Group berdasarkan channel
  const grouped = logs.reduce((acc, log) => {
    const name = log.channelName || "Unknown Channel";
    (acc[name] = acc[name] || []).push(log);
    return acc;
  }, {} as Record<string, LogEntry[]>);

  // Toggle expand grup
  const toggleGroup = (channelName: string) => {
    setOpenGroups((prev) => ({ ...prev, [channelName]: !prev[channelName] }));
  };

  // Auto-refresh 3 detik
  useEffect(() => {
    if (autoRefresh) clearInterval(autoRefresh);
    const interval = setInterval(() => {
      window.dispatchEvent(new CustomEvent("refreshLogs"));
    }, 3000);
    setAutoRefresh(interval);
    return () => clearInterval(interval);
  }, []);

  // Format waktu lokal (Asia/Jakarta)
  const formatTimestamp = (timestamp: string | Date) => {
    try {
      return new Date(timestamp).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour12: false,
      });
    } catch {
      return String(timestamp);
    }
  };

  // Kirim ulang payload
  const handleSend = async (channelId: number, messageId: number, payload: any) => {
    try {
      const result = await sendToDestinations(channelId, messageId, payload);
      console.log("Sent to destinations:", result);
      alert("Payload berhasil dikirim ke semua destination!");
    } catch (err: any) {
      console.error("Error sending:", err);
      alert(`Gagal mengirim payload ke destination: ${err.message || String(err)}`);
    }
  };

  // Render teks status sederhana
  const renderPlainStatus = (status?: string) => {
    if (!status) return "-";
    if (status.toUpperCase() === "OUT-SENT" || status.toUpperCase() === "SENT") return "SUCCESS";
    if (status.toUpperCase() === "ERROR") return "ERROR";
    if (status.toUpperCase() === "PROCESSED") return "SUCCESS";
    if (status.toUpperCase() === "IN-PROCESS") return "PROCESSING...";
    return status;
  };

  return (
    <div className="space-y-2">
      {Object.entries(grouped).map(([channelName, groupLogs]) => (
        <div key={channelName} className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
          {/* Header grup */}
          <button onClick={() => toggleGroup(channelName)} className="w-full flex justify-between items-center p-3 bg-slate-800 hover:bg-slate-700/50 transition">
            <div className="flex items-center gap-3">
              <ChevronDownIcon className={`w-5 h-5 transition-transform duration-200 ${openGroups[channelName] ? "rotate-180" : ""}`} />
              <h3 className="font-semibold text-white">{channelName}</h3>
              <span className="text-xs px-2 py-1 bg-slate-700 rounded-full">{groupLogs.length} entries</span>
            </div>
          </button>

          {/* Tabel log per channel */}
          {openGroups[channelName] && (
            <table className="min-w-full divide-y divide-slate-700">
              <thead className="bg-slate-800">
                <tr className="text-slate-300 text-sm text-left">
                  <th className="p-3 w-48">Timestamp</th>
                  <th className="p-3">Message</th>
                  <th className="p-3 w-28 text-center">Status</th>
                  <th className="p-3 w-48 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {groupLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-700/40 text-slate-300 text-sm transition">
                    <td className="p-3">{formatTimestamp(log.timestamp)}</td>
                    <td className="p-3 break-all">{log.message}</td>
                    <td className="p-3 text-center">{renderPlainStatus(log.status)}</td>
                    <td className="p-3 flex justify-end gap-2">
                      <button onClick={() => handleSend(log.channelId, log.id, log.originalPayload || {})} className="text-sm bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded">
                        Send
                      </button>
                      <button onClick={() => onViewLogs(log)} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded">
                        View Logs
                      </button>
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
      <div className="text-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500 mx-auto"></div>
        <p className="mt-4 text-slate-400">Loading Logs...</p>
      </div>
    );

  if (error) return <div className="text-center p-8 text-red-400">{error}</div>;
  if (logs.length === 0) return <div className="text-center p-8 text-slate-500">No logs match the current filters.</div>;

  return <GroupedLogs logs={logs} onResend={onResend} onViewLogs={onViewLogs} />;
};

export default LogStream;
