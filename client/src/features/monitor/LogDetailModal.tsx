import React, { useState } from "react";
import { LogEntry, DestinationLog } from "../../types";
import { Button } from "../../components/ui/Button";
import { HL7Tree } from "../../components/hl7/HL7Tree";

const isHL7 = (data: any) => {
  if (!data || typeof data !== "string") return false;
  return data.trim().startsWith("MSH|");
};

interface LogDetailModalProps {
  log: LogEntry;
  onClose: () => void;
}

const StatusBadge = ({ status }: { status: string }) => {
  const s = (status ?? "UNKNOWN").toUpperCase();

  const map: Record<string, string> = {
    "OUT-SENT": "status-pill status-running",
    "OUT-ERROR": "status-pill status-error",
    SUCCESS: "status-pill status-running",
    FAILED: "status-pill status-error",
    PARTIAL: "status-pill status-stopped",
    RECEIVED: "status-pill status-running",
    "IN-PROCESSED": "status-pill status-running",
    "IN-ERROR": "status-pill status-error",
    UNKNOWN: "status-pill status-stopped",
  };

  return <span className={map[s] ?? map.UNKNOWN}>{s}</span>;
};

const LogDetailModal: React.FC<LogDetailModalProps> = ({ log, onClose }) => {
  const [viewMode, setViewMode] = useState({
    inbound: "pretty" as "pretty" | "raw" | "tree",
    outbound: "pretty" as "pretty" | "raw",
    destination: {} as Record<
      number,
      {
        open: boolean;
        request: "pretty" | "raw";
        outbound: "pretty" | "raw" | "tree";
        response: "pretty" | "raw";
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
      return typeof data === "string"
        ? data
        : JSON.stringify(data, null, 2);
    }
  };

  const safeDate = (val?: string) => {
    if (!val) return "-";
    const parsed = new Date(val);
    return isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
  };

  const RenderPayload = (mode: string, content: any) => {
    if (mode === "tree") {
      return (
        <div className="code-box h-[240px] overflow-auto">
          <HL7Tree hl7={content} />
        </div>
      );
    }

    return (
      <pre className="code-box h-[240px] overflow-auto">
        {mode === "pretty"
          ? formatJSON(content, true)
          : formatJSON(content, false)}
      </pre>
    );
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-50">
      <div className="card-bw w-[1100px] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">
            Message Details #{log.id}
          </h2>
          <button onClick={onClose} className="icon-btn text-xl">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* META */}
          <div className="grid grid-cols-4 gap-6 text-sm">
            <div>
              <div className="font-semibold mb-1">Timestamp</div>
              {safeDate(log.timestamp)}
            </div>
            <div>
              <div className="font-semibold mb-1">Channel</div>
              {log.channelName}
            </div>
            <div>
              <div className="font-semibold mb-1">Status</div>
              <StatusBadge status={log.status ?? "UNKNOWN"} />
            </div>
            <div>
              <div className="font-semibold mb-1">Level</div>
              {log.level}
            </div>
          </div>

          {/* PAYLOAD */}
          <div className="grid grid-cols-2 gap-6">
            {/* INBOUND */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <strong>Inbound Payload</strong>
                <div className="flex gap-2">
                  <Button
                    variant={
                      viewMode.inbound === "pretty"
                        ? "primary"
                        : "secondary"
                    }
                    onClick={() =>
                      setViewMode((v) => ({ ...v, inbound: "pretty" }))
                    }
                  >
                    Pretty
                  </Button>

                  <Button
                    variant={
                      viewMode.inbound === "raw"
                        ? "primary"
                        : "secondary"
                    }
                    onClick={() =>
                      setViewMode((v) => ({ ...v, inbound: "raw" }))
                    }
                  >
                    Raw
                  </Button>

                  {isHL7(log.originalPayload) && (
                    <Button
                      variant={
                        viewMode.inbound === "tree"
                          ? "primary"
                          : "secondary"
                      }
                      onClick={() =>
                        setViewMode((v) => ({ ...v, inbound: "tree" }))
                      }
                    >
                      Tree
                    </Button>
                  )}
                </div>
              </div>

              {RenderPayload(viewMode.inbound, log.originalPayload)}
            </div>

            {/* TRANSFORMED */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <strong>Transformed Payload</strong>
                <div className="flex gap-2">
                  <Button
                    variant={
                      viewMode.outbound === "pretty"
                        ? "primary"
                        : "secondary"
                    }
                    onClick={() =>
                      setViewMode((v) => ({ ...v, outbound: "pretty" }))
                    }
                  >
                    Pretty
                  </Button>

                  <Button
                    variant={
                      viewMode.outbound === "raw"
                        ? "primary"
                        : "secondary"
                    }
                    onClick={() =>
                      setViewMode((v) => ({ ...v, outbound: "raw" }))
                    }
                  >
                    Raw
                  </Button>
                </div>
              </div>

              {RenderPayload(viewMode.outbound, log.transformedPayload)}
            </div>
          </div>

          {/* DESTINATIONS */}
          {(log.destinationLogs?.length ?? 0) > 0 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">Destination Results</h3>

              {log.destinationLogs!.map((dest: DestinationLog, i: number) => {
                const state = viewMode.destination[i] || {
                  open: true,
                  request: "pretty",
                  outbound: "pretty",
                  response: "pretty",
                };

                return (
                  <div key={i} className="card-bw">
                    <div
                      onClick={() => toggleDest(i)}
                      className="flex justify-between items-center px-4 py-3 cursor-pointer border-b"
                    >
                      <strong>
                        {dest.destinationName ?? `Destination #${i + 1}`}
                      </strong>
                      <StatusBadge status={dest.status ?? "OUT-UNKNOWN"} />
                    </div>

                    {state.open && (
                      <div className="p-4 space-y-6">
                        {/* REQUEST */}
                        <div>
                          <strong>Request Data</strong>
                          {RenderPayload(state.request, dest.requestData)}
                        </div>

                        {/* OUTBOUND */}
                        <div>
                          <strong>Outbound Data</strong>
                          <div className="flex gap-2 my-2">
                            <Button
                              variant={
                                state.outbound === "pretty"
                                  ? "primary"
                                  : "secondary"
                              }
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

                            {isHL7(dest.outboundData) && (
                              <Button
                                variant={
                                  state.outbound === "tree"
                                    ? "primary"
                                    : "secondary"
                                }
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
                              variant={
                                state.outbound === "raw"
                                  ? "primary"
                                  : "secondary"
                              }
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

                        {/* RESPONSE */}
                        <div>
                          <strong>Destination Response</strong>
                          {RenderPayload(state.response, dest.responseText)}
                          <div className="text-right text-xs text-[var(--text-soft)] mt-2">
                            Sent At: {safeDate(dest.sentAt)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LogDetailModal;
