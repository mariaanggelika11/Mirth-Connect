import React, { useState } from "react";
import { LogEntry, LogLevel } from "../types";
import { ResendIcon, CodeIcon, ChevronDownIcon } from "../components/icons/Icon";

const LogLevelIndicator: React.FC<{ level: LogLevel }> = ({ level }) => {
  const config = {
    [LogLevel.INFO]: { text: "INFO", color: "bg-sky-500" },
    [LogLevel.WARN]: { text: "WARN", color: "bg-yellow-500" },
    [LogLevel.ERROR]: { text: "ERROR", color: "bg-red-500" },
    [LogLevel.DEBUG]: { text: "DEBUG", color: "bg-slate-500" },
  };
  const { text, color } = config[level] || { text: "INFO", color: "bg-sky-500" };
  return <span className={`px-2 py-1 text-xs font-semibold text-white rounded-full ${color}`}>{text}</span>;
};

interface LogRowProps {
  log: LogEntry;
  onResend: (logId: number) => void;
  isGrouped?: boolean;
}

const LogRow: React.FC<LogRowProps> = ({ log, onResend, isGrouped = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const CodeBlock: React.FC<{ title: string; content: any }> = ({ title, content }) => {
    let formatted = "";
    try {
      formatted = typeof content === "string" ? JSON.stringify(JSON.parse(content), null, 2) : JSON.stringify(content, null, 2);
    } catch {
      formatted = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    }
    return (
      <div>
        <h4 className="font-semibold text-slate-300 mb-2 flex items-center gap-2">
          <CodeIcon /> {title}
        </h4>
        <pre className="bg-slate-900 p-3 rounded-md text-xs text-cyan-300 font-mono overflow-x-auto">
          <code>{formatted}</code>
        </pre>
      </div>
    );
  };

  const formatTimestamp = (ts: string | Date) => new Date(ts).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });

  const renderPlainStatus = (status: string) => {
    if (!status) return "-";
    if (status.toUpperCase() === "OUT-SENT" || status.toUpperCase() === "SENT") return "SUCCESS";
    if (status.toUpperCase() === "ERROR") return "ERROR";
    if (status.toUpperCase() === "PROCESSED") return "SUCCESS";
    if (status.toUpperCase() === "IN-PROCESS") return "PROCESSING...";
    return status;
  };

  return (
    <>
      <tr className="bg-slate-800 hover:bg-slate-700/50 text-sm text-slate-300">
        <td className="p-3">
          <button onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-2">
            <ChevronDownIcon className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
            <LogLevelIndicator level={log.level} />
          </button>
        </td>
        <td className="p-3 font-mono">{formatTimestamp(log.timestamp)}</td>
        {!isGrouped && <td className="p-3">{log.channelName}</td>}
        <td className="p-3 break-all">
          {log.message}
          {log.status && <div className="mt-1 text-xs">{renderPlainStatus(log.status)}</div>}
        </td>
        <td className="p-3 text-right">
          {log.level === LogLevel.ERROR && (
            <button onClick={() => onResend(log.id)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md" title="Resend Message">
              <ResendIcon />
            </button>
          )}
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-slate-800/80">
          <td colSpan={isGrouped ? 4 : 5} className="p-0">
            <div className="p-4 bg-slate-900/50">
              {log.originalPayload || log.transformedPayload ? (
                <div className="grid grid-cols-2 gap-4">
                  {log.originalPayload && <CodeBlock title="Original Payload" content={log.originalPayload} />}
                  {log.transformedPayload && <CodeBlock title="Transformed Payload" content={log.transformedPayload} />}
                </div>
              ) : (
                <CodeBlock title="Message Content" content={log.content || "No content available."} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export default LogRow;
