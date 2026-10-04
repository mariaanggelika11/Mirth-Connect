import React, { useState, useEffect } from 'react';
import { fetchMonitorStats } from '../../services/monitor.api';
import { MonitorStats } from '../../types';

/* ============================
   METRIC CARD
============================ */
const MetricCard: React.FC<{ title: string; value: number }> = ({ title, value }) => (
  <div className="card-bw p-4">
    <h3 className="text-sm text-soft">{title}</h3>
    <p className="text-3xl font-bold mt-1 text-main">{value.toLocaleString()}</p>
  </div>
);

/* ============================
   MAIN COMPONENT
============================ */
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
    } catch {
      setStats(null);
      setError('Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  /* ============================
     LOADING STATE
  ============================ */
  if (loading && !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card-bw p-4 animate-pulse">
            <div
              style={{
                height: 16,
                background: 'var(--bg-soft)',
                borderRadius: 6,
                width: '70%',
                marginBottom: 10,
              }}
            />
            <div
              style={{ height: 28, background: 'var(--bg-soft)', borderRadius: 6, width: '40%' }}
            />
          </div>
        ))}
      </div>
    );
  }

  /* ============================
     ERROR STATE
  ============================ */
  if (error) {
    return (
      <div className="card-bw p-4" style={{ color: 'var(--danger)' }}>
        ⚠️ {error}
      </div>
    );
  }

  /* ============================
     EMPTY STATE
  ============================ */
  if (!stats) {
    return <div className="card-bw p-4 text-soft">No data available yet.</div>;
  }

  /* ============================
     MAIN VIEW
  ============================ */
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <MetricCard title="Total Received" value={stats.totalReceived} />
      <MetricCard title="Total Sent" value={stats.totalSent} />
      <MetricCard title="Total Errors" value={stats.totalErrors} />
      <MetricCard title="Channels Running" value={stats.channelsRunning} />
      <MetricCard title="Channels Stopped" value={stats.channelsStopped} />
      <MetricCard title="Channels with Errors" value={stats.channelsError} />
    </div>
  );
};

export default MonitorMetrics;
