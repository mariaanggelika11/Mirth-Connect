import React, { useState } from "react";
import { Channel, ChannelStatus, Destination, DestinationType } from "../types";
import { updateChannelStatus } from "../services/api";
import { PlayIcon, StopIcon, EditIcon, TrashIcon, ChevronDownIcon, CodeIcon } from "../components/icons/Icon";

interface ChannelTableProps {
  channels: Channel[];
  onRefresh: () => void;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
}

const StatusIndicator: React.FC<{ status?: ChannelStatus | string }> = ({ status }) => {
  const baseClasses = "w-3 h-3 rounded-full";

  // ✅ Normalisasi string status agar tetap konsisten
  const normalizedStatus = (status || "").toString().trim().toUpperCase();

  // ✅ Tetapkan warna dan label berdasar status normalisasi
  const statusConfig = {
    RUNNING: {
      classes: "bg-green-500 animate-pulse",
      text: "Running",
      textColor: "text-green-400",
    },
    STOPPED: {
      classes: "bg-slate-500",
      text: "Stopped",
      textColor: "text-slate-400",
    },
    ERROR: {
      classes: "bg-red-500",
      text: "Error",
      textColor: "text-red-400",
    },
  };

  // ✅ fallback aman jika backend kirim string aneh/null
  const config = statusConfig[normalizedStatus as keyof typeof statusConfig] || {
    classes: "bg-gray-600",
    text: "Stopped",
    textColor: "text-gray-400",
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`${baseClasses} ${config.classes}`} />
      <span className={config.textColor}>{config.text}</span>
    </div>
  );
};

const ScriptDisplay: React.FC<{ title: string; script?: string; className?: string }> = ({ title, script, className }) => {
  if (!script) return null;
  return (
    <div className={`mt-4 ${className}`}>
      <h5 className="font-semibold text-slate-300 mb-2 flex items-center gap-2">
        <CodeIcon /> {title}
      </h5>
      <pre className="bg-slate-900 p-3 rounded-md text-xs text-cyan-300 font-mono overflow-x-auto">
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
        <td className="p-2">{destination.name}</td>
        <td className="p-2">
          <span className={`px-2 py-1 rounded-full text-xs ${destination.type === DestinationType.HL7 ? "bg-sky-900 text-sky-300" : "bg-fuchsia-900 text-fuchsia-300"}`}>{destination.type}</span>
        </td>
        <td className="p-2 font-mono">{destination.endpoint}</td>
        <td className="p-2 text-center">
          {destination.processingScript ? (
            <button onClick={() => setIsScriptVisible(!isScriptVisible)} className="text-cyan-400 hover:text-cyan-300 text-xs inline-flex items-center gap-1">
              <CodeIcon className="w-4 h-4" /> View
            </button>
          ) : (
            <span className="text-slate-500 text-xs">-</span>
          )}
        </td>
        {/* fix: fallback ke 0 kalau undefined */}
        <td className="p-2 text-center text-green-400">{(destination.sent ?? 0).toLocaleString()}</td>
        <td className="p-2 text-center text-red-400">{(destination.errors ?? 0).toLocaleString()}</td>
      </tr>

      {isScriptVisible && destination.processingScript && (
        <tr className="bg-slate-800/50">
          <td colSpan={6} className="p-0">
            <ScriptDisplay title={`${destination.name} - Script`} script={destination.processingScript} className="m-2" />
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
    } catch (error) {
      console.error(`Failed to update status for channel ${channel.id}`, error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <>
      <tr className="bg-slate-800 hover:bg-slate-700/50 transition-colors duration-150">
        <td className="p-4 whitespace-nowrap">
          <button onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-2 text-white font-semibold">
            <ChevronDownIcon className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
            {channel.name}
          </button>
          <div className="text-xs text-slate-400 ml-7">{channel.id}</div>
        </td>
        <td className="p-4 whitespace-nowrap">
          <StatusIndicator status={channel.status} />
        </td>
        <td className="p-4 whitespace-nowrap text-slate-300 font-mono text-sm">{channel.source.endpoint}</td>
        {/* fix: gunakan ?? 0 agar aman */}
        <td className="p-4 whitespace-nowrap text-center text-slate-300">{(channel.received ?? 0).toLocaleString()}</td>
        {/*  Hitung total sent dari semua destinations */}
        <td className="p-4 whitespace-nowrap text-center text-green-400">{channel.destinations ? channel.destinations.reduce((total, dest) => total + (dest.sent ?? 0), 0).toLocaleString() : 0}</td>

        {/* Hitung total errors dari semua destinations */}
        <td className="p-4 whitespace-nowrap text-center text-red-400">{channel.destinations ? channel.destinations.reduce((total, dest) => total + (dest.errors ?? 0), 0).toLocaleString() : 0}</td>

        <td className="p-4 whitespace-nowrap text-right">
          <div className="flex items-center justify-end gap-2">
            {channel.status?.toString().toUpperCase() === "STOPPED" || channel.status?.toString().toUpperCase() === "ERROR" ? (
              <button onClick={() => handleStatusChange(ChannelStatus.RUNNING)} disabled={isUpdating} className="p-2 text-green-400 hover:bg-green-900/50 rounded-md disabled:opacity-50 disabled:cursor-wait">
                <PlayIcon />
              </button>
            ) : (
              <button onClick={() => handleStatusChange(ChannelStatus.STOPPED)} disabled={isUpdating} className="p-2 text-yellow-400 hover:bg-yellow-900/50 rounded-md disabled:opacity-50 disabled:cursor-wait">
                <StopIcon />
              </button>
            )}
            <button onClick={() => onEdit(channel)} className="p-2 text-blue-400 hover:bg-blue-900/50 rounded-md">
              <EditIcon />
            </button>
            <button onClick={() => onDelete(channel)} className="p-2 text-red-400 hover:bg-red-900/50 rounded-md">
              <TrashIcon />
            </button>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-slate-800/80">
          <td colSpan={7} className="p-0">
            <div className="p-4 bg-slate-900/50">
              <h4 className="font-semibold text-slate-200 mb-2">Destinations</h4>
              <table className="min-w-full text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="text-left p-2 font-medium">Name</th>
                    <th className="text-left p-2 font-medium">Type</th>
                    <th className="text-left p-2 font-medium">Endpoint</th>
                    <th className="text-center p-2 font-medium">Script</th>
                    <th className="text-center p-2 font-medium">Sent</th>
                    <th className="text-center p-2 font-medium">Errors</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300 divide-y divide-slate-700/50">
                  {channel.destinations.map((dest) => (
                    <DestinationRow key={dest.id} destination={dest} />
                  ))}
                </tbody>
              </table>

              <div className="flex gap-4">
                <ScriptDisplay title="Channel Processing Script" script={channel.processingScript} className="flex-1" />
                <ScriptDisplay title="Channel Response Script" script={channel.responseScript} className="flex-1" />
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
    <div className="overflow-x-auto bg-slate-800/50 rounded-lg border border-slate-700">
      <table className="min-w-full divide-y divide-slate-700">
        <thead className="bg-slate-800">
          <tr>
            <th className="p-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Name</th>
            <th className="p-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
            <th className="p-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Source</th>
            <th className="p-4 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">Received</th>
            <th className="p-4 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">Sent</th>
            <th className="p-4 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">Errors</th>
            <th className="p-4 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {channels.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} onRefresh={onRefresh} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ChannelTable;
