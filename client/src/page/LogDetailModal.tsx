import React, { useState } from "react";
import { LogEntry, DestinationLog } from "../types";
import { Button } from "../components/shared/Button";
import { HL7Tree } from "../components/shared/HL7Tree";

// =============== HELPERS ===============
const isHL7 = (data: any) => {
  if (!data) return false;
  if (typeof data !== "string") return false;
  return data.trim().startsWith("MSH|");
};

interface LogDetailModalProps {
  log: LogEntry;
  onClose: () => void;
}

const StatusBadge = ({ status }: { status: string }) => {
  const s = (status ?? "UNKNOWN").toUpperCase();

  const map: Record<string, string> = {
    "OUT-SENT": "bg-green-700 text-green-200",
    "OUT-ERROR": "bg-red-700 text-red-200",

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
    inbound: "pretty" as "pretty" | "raw" | "tree",
    outbound: "pretty" as "pretty" | "raw" | "tree",
    destination: {} as Record<
      number,
      {
        open: boolean;
        request: "pretty" | "raw" | "tree";
        outbound: "pretty" | "raw" | "tree";
        response: "pretty" | "raw" | "tree";
      }
    >,
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

  // ============================================
  // RENDER PAYLOAD VIEWER
  // ============================================
  const RenderPayload = (mode: string, content: any) => {
    if (mode === "tree") {
      return (
        <div className="bg-slate-800 p-2 rounded-md h-64 overflow-auto border border-slate-700">
          <HL7Tree hl7={typeof content === "string" ? content : JSON.stringify(content)} />
        </div>
      );
    }

    return <pre className="bg-slate-800 text-cyan-300 text-xs p-4 rounded-md overflow-x-auto">{mode === "pretty" ? formatJSON(content, true) : formatJSON(content, false)}</pre>;
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
              {safeDate(log.timestamp)}
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
            {/* INBOUND (TREE REMOVED) */}
            <div>
              <div className="flex justify-between mb-2">
                <h3 className="text-slate-200 font-semibold">Inbound Payload</h3>
                <div className="space-x-2">
                  {/* Pretty */}
                  <Button onClick={() => setViewMode((v) => ({ ...v, inbound: "pretty" }))} variant={viewMode.inbound === "pretty" ? "primary" : "secondary"}>
                    Pretty
                  </Button>

                  {/* Raw */}
                  <Button onClick={() => setViewMode((v) => ({ ...v, inbound: "raw" }))} variant={viewMode.inbound === "raw" ? "primary" : "secondary"}>
                    Raw
                  </Button>
                </div>
              </div>

              {RenderPayload(viewMode.inbound, log.originalPayload)}
            </div>

            {/* TRANSFORMED PAYLOAD — TREE ONLY IF HL7 */}
            <div>
              <div className="flex justify-between mb-2">
                <h3 className="text-slate-200 font-semibold">Transformed Payload</h3>

                <div className="space-x-2">
                  <Button onClick={() => setViewMode((v) => ({ ...v, outbound: "pretty" }))} variant={viewMode.outbound === "pretty" ? "primary" : "secondary"}>
                    Pretty
                  </Button>
                  {/* TREE ONLY IF HL7 */} {/* NEW */}
                  {isHL7(log.transformedPayload) && (
                    <Button onClick={() => setViewMode((v) => ({ ...v, outbound: "tree" }))} variant={viewMode.outbound === "tree" ? "primary" : "secondary"}>
                      Tree
                    </Button>
                  )}
                  <Button onClick={() => setViewMode((v) => ({ ...v, outbound: "raw" }))} variant={viewMode.outbound === "raw" ? "primary" : "secondary"}>
                    Raw
                  </Button>
                </div>
              </div>

              {RenderPayload(viewMode.outbound, log.transformedPayload)}
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
                        <h4 className="text-slate-100 font-semibold">{dest.destinationName ?? `Destination #${i + 1}`}</h4>
                        <StatusBadge status={dest.status ?? "OUT-UNKNOWN"} />
                      </div>

                      {state.open && (
                        <div className="p-4 space-y-6">
                          {/* REQUEST DATA (NO TREE) */}
                          <div>
                            <h5 className="text-slate-300 font-medium mb-2">Request Data</h5>

                            <div className="space-x-2 mb-2">
                              <Button
                                variant={state.request === "pretty" ? "primary" : "secondary"}
                                onClick={() =>
                                  setViewMode((v) => ({
                                    ...v,
                                    destination: {
                                      ...v.destination,
                                      [i]: { ...state, request: "pretty" },
                                    },
                                  }))
                                }
                              >
                                Pretty
                              </Button>

                              <Button
                                variant={state.request === "raw" ? "primary" : "secondary"}
                                onClick={() =>
                                  setViewMode((v) => ({
                                    ...v,
                                    destination: {
                                      ...v.destination,
                                      [i]: { ...state, request: "raw" },
                                    },
                                  }))
                                }
                              >
                                Raw
                              </Button>
                            </div>

                            {RenderPayload(state.request, dest.requestData)}
                          </div>

                          {/* OUTBOUND DATA — TREE ONLY IF HL7 */}
                          <div>
                            <h5 className="text-slate-300 font-medium mb-2">Outbound Data</h5>

                            <div className="space-x-2 mb-2">
                              <Button
                                variant={state.outbound === "pretty" ? "primary" : "secondary"}
                                onClick={() =>
                                  setViewMode((v) => ({
                                    ...v,
                                    destination: {
                                      ...v.destination,
                                      [i]: { ...state, outbound: "pretty" },
                                    },
                                  }))
                                }
                              >
                                Pretty
                              </Button>
                              {/* TREE ONLY IF OUTBOUND HL7 */} {/* NEW */}
                              {isHL7(dest.outboundData) && (
                                <Button
                                  variant={state.outbound === "tree" ? "primary" : "secondary"}
                                  onClick={() =>
                                    setViewMode((v) => ({
                                      ...v,
                                      destination: {
                                        ...v.destination,
                                        [i]: { ...state, outbound: "tree" },
                                      },
                                    }))
                                  }
                                >
                                  Tree
                                </Button>
                              )}
                              <Button
                                variant={state.outbound === "raw" ? "primary" : "secondary"}
                                onClick={() =>
                                  setViewMode((v) => ({
                                    ...v,
                                    destination: {
                                      ...v.destination,
                                      [i]: { ...state, outbound: "raw" },
                                    },
                                  }))
                                }
                              >
                                Raw
                              </Button>
                            </div>

                            {RenderPayload(state.outbound, dest.outboundData)}
                          </div>

                          {/* RESPONSE (NO TREE) */}
                          <div>
                            <h5 className="text-slate-300 font-medium mb-2">Destination Response</h5>

                            <div className="space-x-2 mb-2">
                              <Button
                                variant={state.response === "pretty" ? "primary" : "secondary"}
                                onClick={() =>
                                  setViewMode((v) => ({
                                    ...v,
                                    destination: {
                                      ...v.destination,
                                      [i]: { ...state, response: "pretty" },
                                    },
                                  }))
                                }
                              >
                                Pretty
                              </Button>

                              <Button
                                variant={state.response === "raw" ? "primary" : "secondary"}
                                onClick={() =>
                                  setViewMode((v) => ({
                                    ...v,
                                    destination: {
                                      ...v.destination,
                                      [i]: { ...state, response: "raw" },
                                    },
                                  }))
                                }
                              >
                                Raw
                              </Button>
                            </div>

                            {RenderPayload(state.response, dest.responseText)}

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
