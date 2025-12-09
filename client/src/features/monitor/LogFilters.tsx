import React from "react";
import { Channel, LogLevel } from "../../types";
import { Button } from "../../components/ui/Button";

interface LogFiltersProps {
  channels: Channel[];
  filters: {
    channel: number | "ALL";
    level: LogLevel | "ALL";
    search: string;
    isGrouped: boolean;
    isRealtime: boolean;
  };
  onFilterChange: {
    setChannel: (value: number | "ALL") => void;
    setLevel: (value: LogLevel | "ALL") => void;
    setSearch: (value: string) => void;
    setIsGrouped: (value: boolean) => void;
    setIsRealtime: (value: boolean) => void;
  };
  onExport: () => void;
}

const LogFilters: React.FC<LogFiltersProps> = ({ channels, filters, onFilterChange, onExport }) => {
  return (
    <div className="card-bw" style={{ padding: 16, display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select
          className="input-bw"
          value={filters.channel}
          onChange={(e) => {
            const value = e.target.value === "ALL" ? "ALL" : Number(e.target.value);
            onFilterChange.setChannel(value);
          }}
        >
          <option value="ALL">All Channels</option>
          {channels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.name}
            </option>
          ))}
        </select>

        <select className="input-bw" value={filters.level} onChange={(e) => onFilterChange.setLevel(e.target.value as LogLevel | "ALL")}>
          <option value="ALL">All Levels</option>
          <option value="INFO">Info</option>
          <option value="DEBUG">Debug</option>
          <option value="WARN">Warn</option>
          <option value="ERROR">Error</option>
        </select>

        <input type="text" placeholder="Search logs..." className="input-bw" style={{ width: 240 }} value={filters.search} onChange={(e) => onFilterChange.setSearch(e.target.value)} />

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={filters.isGrouped} onChange={(e) => onFilterChange.setIsGrouped(e.target.checked)} />
          Grouped
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={filters.isRealtime} onChange={(e) => onFilterChange.setIsRealtime(e.target.checked)} />
          Realtime
        </label>
      </div>

      <Button onClick={onExport}>Export Logs</Button>
    </div>
  );
};

export default LogFilters;
