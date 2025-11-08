import React, { useState, useEffect, useCallback, useMemo } from "react";
import { fetchChannels, fetchLogs, resendMessage, fetchDestinationLogs } from "../services/api";
import { Channel, LogEntry, LogLevel } from "../types";
import MonitorMetrics from "./MonitorMetrics";
import LogStream from "./LogStream";
import LogFilters from "./LogFilters";

const MonitorView: React.FC = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [channelFilter, setChannelFilter] = useState<number | "ALL">("ALL");
  const [levelFilter, setLevelFilter] = useState<LogLevel | "ALL">("ALL");
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [isGrouped, setIsGrouped] = useState<boolean>(true);
  const [isRealtime, setIsRealtime] = useState<boolean>(true);

  // State untuk modal "View Logs"
  const [selectedMessage, setSelectedMessage] = useState<LogEntry | null>(null);
  const [destinationLogs, setDestinationLogs] = useState<any[]>([]);

  // Muat data log dan channel
  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [channelData, logsData] = await Promise.all([fetchChannels(), fetchLogs(channelFilter === "ALL" ? undefined : Number(channelFilter))]);
      setChannels(channelData);
      setLogs(logsData);
    } catch (err) {
      console.error("Failed to load monitor data:", err);
      setError("Failed to load data from server");
    } finally {
      setLoading(false);
    }
  }, [channelFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Polling realtime (pause saat modal terbuka)
  useEffect(() => {
    if (!isRealtime || selectedMessage) return;
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [isRealtime, selectedMessage, loadData]);

  // Filter log
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => levelFilter === "ALL" || log.level === levelFilter).filter((log) => !searchFilter || log.message.toLowerCase().includes(searchFilter.toLowerCase()) || log.id.toString().includes(searchFilter));
  }, [logs, levelFilter, searchFilter]);

  // Kirim ulang log
  const handleResend = async (logId: number) => {
    try {
      await resendMessage(logId);
      console.log(`Message from log ${logId} resent.`);
    } catch (err) {
      console.error(`Failed to resend message from log ${logId}`, err);
    }
  };

  // Tampilkan modal detail log
  const handleViewLogs = async (message: LogEntry) => {
    try {
      const result = await fetchDestinationLogs(message.id);
      setDestinationLogs(result);
      setSelectedMessage(message);
    } catch (err) {
      console.error("Error fetching destination logs:", err);
    }
  };

  // Tutup modal
  const handleCloseModal = () => {
    setSelectedMessage(null);
    setDestinationLogs([]);
  };

  // Export log ke JSON
  const handleExport = () => {
    const dataStr = JSON.stringify(filteredLogs, null, 2);
    const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);
    const exportFileDefaultName = `logs_${new Date().toISOString()}.json`;
    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();
  };

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-3xl font-bold text-white">System Monitor</h1>
        <p className="text-slate-400 mt-1">View live metrics and message logs from backend.</p>
      </div>

      <MonitorMetrics />

      <LogFilters
        channels={channels}
        filters={{
          channel: channelFilter,
          level: levelFilter,
          search: searchFilter,
          isGrouped,
          isRealtime,
        }}
        onFilterChange={{
          setChannel: setChannelFilter,
          setLevel: setLevelFilter,
          setSearch: setSearchFilter,
          setIsGrouped,
          setIsRealtime,
        }}
        onExport={handleExport}
      />

      <LogStream logs={filteredLogs} loading={loading} error={error} isGrouped={isGrouped} onResend={handleResend} onViewLogs={handleViewLogs} />

      {selectedMessage && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-xl p-6 w-[800px] border border-slate-700 shadow-lg">
            <h2 className="text-xl font-semibold text-white mb-3">Destination Logs for Message #{selectedMessage.id}</h2>

            <table className="w-full text-sm border border-slate-700">
              <thead className="bg-slate-800">
                <tr>
                  <th className="p-2 border border-slate-700">Destination</th>
                  <th className="p-2 border border-slate-700">Status</th>
                  <th className="p-2 border border-slate-700">Response</th>
                  <th className="p-2 border border-slate-700">Sent At</th>
                </tr>
              </thead>
              <tbody>
                {destinationLogs.map((d, i) => (
                  <tr key={i}>
                    <td className="p-2 border border-slate-700">{d.destination_name}</td>
                    <td className={`p-2 border border-slate-700 font-medium ${d.status === "SUCCESS" ? "text-green-500" : "text-red-500"}`}>{d.status}</td>
                    <td className="p-2 border border-slate-700">{d.response_text}</td>
                    <td className="p-2 border border-slate-700">{new Date(d.sent_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="text-right mt-4">
              <button onClick={handleCloseModal} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitorView;
