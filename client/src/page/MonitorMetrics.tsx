import React, { useState, useEffect } from "react";
import { fetchMonitorStats } from "../services/monitor.api";
import { MonitorStats } from "../types";

//  Komponen kecil untuk 1 kartu metrik
const MetricCard: React.FC<{ title: string; value: number; colorClass: string }> = ({ title, value, colorClass }) => (
  <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 shadow-sm">
    <h3 className="text-sm font-medium text-slate-400">{title}</h3>
    <p className={`text-3xl font-bold mt-1 ${colorClass}`}>{value.toLocaleString()}</p>
  </div>
);

// 🔹 Komponen utama
const MonitorMetrics: React.FC = () => {
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchMonitorStats();
      setStats(data);
    } catch (err) {
      console.error(" Failed to load monitor stats:", err);
      setError("Failed to fetch metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000); // refresh setiap 5 detik
    return () => clearInterval(interval);
  }, []);

  // Skeleton Loading
  if (loading && !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-slate-800/50 p-4 rounded-lg animate-pulse border border-slate-700">
            <div className="h-4 bg-slate-700 rounded w-3/4 mb-2"></div>
            <div className="h-8 bg-slate-700 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return <div className="p-4 bg-slate-800/50 text-red-400 rounded-lg border border-slate-700">⚠️ {error}</div>;
  }

  // Data belum ada
  if (!stats) {
    return <div className="p-4 bg-slate-800/50 text-slate-400 rounded-lg border border-slate-700">No data available yet.</div>;
  }

  // Tampilan utama
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <MetricCard title="Total Received" value={stats.totalReceived} colorClass="text-sky-400" />
      <MetricCard title="Total Sent" value={stats.totalSent} colorClass="text-green-400" />
      <MetricCard title="Total Errors" value={stats.totalErrors} colorClass="text-red-400" />
      <MetricCard title="Channels Running" value={stats.channelsRunning} colorClass="text-green-400" />
      <MetricCard title="Channels Stopped" value={stats.channelsStopped} colorClass="text-slate-400" />
      <MetricCard title="Channels with Errors" value={stats.channelsError} colorClass="text-red-400" />
    </div>
  );
};

export default MonitorMetrics;
