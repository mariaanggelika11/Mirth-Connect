import React, { useState } from "react";
import { LogEntry, DestinationLog } from "../types";
import { Button } from "../components/shared/Button";

interface LogDetailModalProps {
  log: LogEntry;
  onClose: () => void;
}

/* ============================
   STATUS BADGE (SAFE TS)
============================ */
const StatusBadge = ({ status }: { status: string }) => {
  const s = (status ?? "UNKNOWN").toUpperCase();

  const map: Record<string, string> = {
    "OUT-SENT": "bg-green-700 text-green-200",
    "OUT-ERROR": "bg-red-700 text-red-200",

    // inbound statuses
    SUCCESS: "bg-green-700 text-green-200",
    FAILED: "bg-red-700 text-red-200",
    PARTIAL: "bg-yellow-600 text-yellow-200",
    RECEIVED: "bg-blue-700 text-blue-200",
    "IN-PROCESSED": "bg-blue-700 text-blue-200",
    "IN-ERROR": "bg-red-700 text-red-200",

    UNKNOWN: "bg-slate-600 text-slate-300",
  };

  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${map[s] ?? map.UNKNOWN}`}>{s}</span>;
};

const LogDetailModal: React.FC<LogDetailModalProps> = ({ log, onClose }) => {
  const [viewMode, setViewMode] = useState({
    inbound: "pretty",
    outbound: "pretty",
    destination: {} as Record<number, { open: boolean; request: "pretty" | "raw"; outbound: "pretty" | "raw"; response: "pretty" | "raw" }>,
  });

  const toggleDest = (i: number) => {
    setViewMode((v) => ({
      ...v,
      destination: {
        ...v.destination,
        [i]: {
          ...(v.destination[i] || {
            open: true,
            request: "pretty",
            outbound: "pretty",
            response: "pretty",
          }),
          open: !(v.destination[i]?.open ?? true),
        },
      },
    }));
  };

  const formatJSON = (data: any, pretty = true) => {
    try {
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      return pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
    } catch {
      return typeof data === "string" ? data : JSON.stringify(data, null, 2);
    }
  };

  const safeDate = (val?: string) => {
    if (!val) return "-";
    const parsed = new Date(val);
    return isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString("en-US", { timeZone: "America/New_York" });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-900 rounded-xl shadow-2xl border border-slate-700 w-[950px] max-h-[90vh] overflow-y-auto">
        {/* HEADER */}
        <div className="flex justify-between items-center p-4 border-b border-slate-700">
          <h2 className="text-xl font-semibold text-white">Message Details: #{log.id}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* SUMMARY */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-slate-300">
            <div>
              <strong>Timestamp:</strong>
              <br />
              {new Date(log.timestamp).toLocaleString("en-US", {
                timeZone: "America/New_York",
              })}
            </div>

            <div>
              <strong>Channel:</strong>
              <br />
              {log.channelName}
            </div>

            <div>
              <strong>Status:</strong>
              <br />
              <StatusBadge status={log.status ?? "UNKNOWN"} />
            </div>

            <div>
              <strong>Level:</strong>
              <br />
              <span className="text-cyan-300">{log.level}</span>
            </div>
          </div>

          {/* PAYLOADS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* INBOUND */}
            <div>
              <div className="flex justify-between mb-2">
                <h3 className="text-slate-200 font-semibold">Inbound Payload</h3>
                <div className="space-x-2">
                  <Button variant={viewMode.inbound === "pretty" ? "primary" : "secondary"} onClick={() => setViewMode((v) => ({ ...v, inbound: "pretty" }))}>
                    Pretty
                  </Button>
                  <Button variant={viewMode.inbound === "raw" ? "primary" : "secondary"} onClick={() => setViewMode((v) => ({ ...v, inbound: "raw" }))}>
                    Raw
                  </Button>
                </div>
              </div>

              <pre className="bg-slate-800 text-cyan-300 text-xs p-4 rounded-md overflow-x-auto">{formatJSON(log.originalPayload, viewMode.inbound === "pretty")}</pre>
            </div>

            {/* OUTBOUND */}
            <div>
              <div className="flex justify-between mb-2">
                <h3 className="text-slate-200 font-semibold">Transformed Payload</h3>
                <div className="space-x-2">
                  <Button variant={viewMode.outbound === "pretty" ? "primary" : "secondary"} onClick={() => setViewMode((v) => ({ ...v, outbound: "pretty" }))}>
                    Pretty
                  </Button>
                  <Button variant={viewMode.outbound === "raw" ? "primary" : "secondary"} onClick={() => setViewMode((v) => ({ ...v, outbound: "raw" }))}>
                    Raw
                  </Button>
                </div>
              </div>

              <pre className="bg-slate-800 text-cyan-300 text-xs p-4 rounded-md overflow-x-auto">{formatJSON(log.transformedPayload, viewMode.outbound === "pretty")}</pre>
            </div>
          </div>

          {/* DESTINATIONS */}
          {(log.destinationLogs?.length ?? 0) > 0 && (
            <div>
              <h3 className="text-slate-200 font-semibold mb-4">Destination Results</h3>

              <div className="space-y-6">
                {(log.destinationLogs ?? []).map((dest: DestinationLog, i: number) => {
                  const state = viewMode.destination[i] || {
                    open: true,
                    request: "pretty",
                    outbound: "pretty",
                    response: "pretty",
                  };

                  return (
                    <div key={i} className="border border-slate-700 rounded-lg bg-slate-800/40">
                      {/* HEADER */}
                      <div className="flex justify-between items-center p-4 hover:bg-slate-700/30 cursor-pointer" onClick={() => toggleDest(i)}>
                        <div>
                          <h4 className="text-slate-100 font-semibold">{dest.destinationName ?? `Destination #${i + 1}`}</h4>
                        </div>

                        <StatusBadge status={dest.status ?? "OUT-UNKNOWN"} />
                      </div>

                      {/* COLLAPSE CONTENT */}
                      {state.open && (
                        <div className="p-4 space-y-6">
                          {/* REQUEST */}
                          <div>
                            <h5 className="text-slate-300 font-medium mb-2">Request Data (Before Destination Transformer)</h5>
                            <pre className="bg-slate-900 text-cyan-300 text-xs p-3 rounded-md overflow-x-auto">{formatJSON(dest.requestData, state.request === "pretty")}</pre>
                          </div>

                          {/* OUTBOUND FINAL */}
                          <div>
                            <h5 className="text-slate-300 font-medium mb-2">Outbound Data (Final Payload)</h5>
                            <pre className="bg-slate-900 text-cyan-300 text-xs p-3 rounded-md overflow-x-auto">{formatJSON(dest.outboundData, state.outbound === "pretty")}</pre>
                          </div>

                          {/* RESPONSE */}
                          <div>
                            <h5 className="text-slate-300 font-medium mb-2">Destination Response</h5>
                            <pre className="bg-slate-900 text-cyan-300 text-xs p-3 rounded-md overflow-x-auto">{formatJSON(dest.responseText, state.response === "pretty")}</pre>
                            <p className="text-right text-xs text-slate-500 mt-2">Sent At: {safeDate(dest.sentAt)}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LogDetailModal;
