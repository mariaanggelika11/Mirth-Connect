import React from "react";
import { Channel, LogLevel } from "../types";

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
    <div className="bg-slate-800 rounded-lg p-4 flex flex-wrap gap-4 justify-between items-center">
      <div className="flex flex-wrap gap-3 items-center">
        {/* Channel Filter */}
        <select
          className="bg-slate-700 text-white p-2 rounded"
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

        {/* Level Filter */}
        <select className="bg-slate-700 text-white p-2 rounded" value={filters.level} onChange={(e) => onFilterChange.setLevel(e.target.value as LogLevel | "ALL")}>
          <option value="ALL">All Levels</option>
          <option value="INFO">Info</option>
          <option value="DEBUG">Debug</option>
          <option value="WARN">Warn</option>
          <option value="ERROR">Error</option>
        </select>

        {/* Search */}
        <input type="text" placeholder="Search logs..." className="bg-slate-700 text-white p-2 rounded w-60" value={filters.search} onChange={(e) => onFilterChange.setSearch(e.target.value)} />

        {/* Checkboxes */}
        <label className="flex items-center text-white gap-2">
          <input type="checkbox" checked={filters.isGrouped} onChange={(e) => onFilterChange.setIsGrouped(e.target.checked)} />
          Grouped
        </label>

        <label className="flex items-center text-white gap-2">
          <input type="checkbox" checked={filters.isRealtime} onChange={(e) => onFilterChange.setIsRealtime(e.target.checked)} />
          Realtime
        </label>
      </div>

      <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded" onClick={onExport}>
        Export Logs
      </button>
    </div>
  );
};

export default LogFilters;
