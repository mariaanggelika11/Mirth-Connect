import React, { useState } from "react";
import { LogEntry, LogLevel } from "../types";
import { DownloadIcon, ResendIcon, CodeIcon, ChevronDownIcon } from "../components/icons/Icon";

const LogLevelIndicator: React.FC<{ level: LogLevel }> = ({ level }) => {
  const config = {
    [LogLevel.INFO]: { text: "INFO", color: "bg-sky-500" },
    [LogLevel.WARN]: { text: "WARN", color: "bg-yellow-500" },
    [LogLevel.ERROR]: { text: "ERROR", color: "bg-red-500" },
    [LogLevel.DEBUG]: { text: "DEBUG", color: "bg-slate-500" },
  };
  const { text, color } = config[level];
  return <span className={`px-2 py-1 text-xs font-semibold text-white rounded-full ${color}`}>{text}</span>;
};

interface LogRowProps {
  log: LogEntry;
  onResend: (logId: number) => void;
  isGrouped?: boolean;
}

const LogRow: React.FC<LogRowProps> = ({ log, onResend, isGrouped = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const CodeBlock: React.FC<{ title: string; content: string; lang?: string; color?: string }> = ({ title, content, color = "text-cyan-300" }) => (
    <div>
      <h4 className="font-semibold text-slate-300 mb-2 flex items-center gap-2">
        <CodeIcon /> {title}
      </h4>
      <pre className={`bg-slate-900 p-3 rounded-md text-xs ${color} font-mono overflow-x-auto`}>
        <code>{content}</code>
      </pre>
    </div>
  );

  return (
    <>
      <tr className="bg-slate-800 hover:bg-slate-700/50 transition-colors duration-150 text-sm text-slate-300">
        <td className="p-3">
          <button onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-2">
            <ChevronDownIcon className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
            <LogLevelIndicator level={log.level} />
          </button>
        </td>
        <td className="p-3 font-mono">{new Date(log.timestamp).toLocaleString()}</td>
        {!isGrouped && <td className="p-3">{log.channelName}</td>}
        <td className="p-3">{log.message}</td>
        <td className="p-3 text-right">
          <div className="flex items-center justify-end gap-2">
            {log.level === LogLevel.ERROR && (
              <button onClick={() => onResend(log.id)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md" title="Resend Message">
                <ResendIcon />
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-slate-800/80">
          <td colSpan={isGrouped ? 4 : 5} className="p-0">
            <div className="p-4 bg-slate-900/50">
              {log.originalPayload && log.transformedPayload ? (
                <div className="grid grid-cols-2 gap-4">
                  <CodeBlock title="Original Payload" content={log.originalPayload} />
                  <CodeBlock title="Transformed Payload" content={log.transformedPayload} />
                </div>
              ) : (
                <div className="space-y-4">
                  <CodeBlock title="Message Content" content={log.content || "No content available."} />
                  {log.error && <CodeBlock title="Error Details" content={log.error} color="text-red-300" />}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export default LogRow;
