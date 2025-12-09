import React, { useState } from "react";
import { LogEntry, DestinationLog } from "../../types";
import { Button } from "../../components/ui/Button";
import { HL7Tree } from "../../components/hl7/HL7Tree";

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
    outbound: "pretty" as "pretty" | "raw" | "tree",
    destination: {} as Record<
      number,
      {
        open: boolean;
        request: "pretty" | "raw" | "tree";
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
      return typeof data === "string" ? data : JSON.stringify(data, null, 2);
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
        <div className="card-bw" style={{ padding: 8, height: 260, overflow: "auto" }}>
          <HL7Tree hl7={typeof content === "string" ? content : JSON.stringify(content)} />
        </div>
      );
    }

    return <pre className="code-box">{mode === "pretty" ? formatJSON(content, true) : formatJSON(content, false)}</pre>;
  };

  return (
    <div className="fixed inset-0" style={{ background: "rgba(0,0,0,0.6)", zIndex: 50 }}>
      <div
        className="card-bw"
        style={{
          width: 950,
          maxHeight: "90vh",
          overflowY: "auto",
          margin: "5vh auto",
          padding: 0,
        }}
      >
        <div
          style={{
            padding: 16,
            borderBottom: "1px solid var(--border-main)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Message Details: #{log.id}</h2>
          <button onClick={onClose} className="icon-btn">
            ×
          </button>
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
          <div className="table">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              <div>
                <strong>Timestamp</strong>
                <br />
                {safeDate(log.timestamp)}
              </div>
              <div>
                <strong>Channel</strong>
                <br />
                {log.channelName}
              </div>
              <div>
                <strong>Status</strong>
                <br />
                <StatusBadge status={log.status ?? "UNKNOWN"} />
              </div>
              <div>
                <strong>Level</strong>
                <br />
                {log.level}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <strong>Inbound Payload</strong>
                <div>
                  <Button variant={viewMode.inbound === "pretty" ? "primary" : "secondary"} onClick={() => setViewMode((v) => ({ ...v, inbound: "pretty" }))}>
                    Pretty
                  </Button>
                  <Button variant={viewMode.inbound === "raw" ? "primary" : "secondary"} onClick={() => setViewMode((v) => ({ ...v, inbound: "raw" }))}>
                    Raw
                  </Button>
                </div>
              </div>
              {RenderPayload(viewMode.inbound, log.originalPayload)}
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <strong>Transformed Payload</strong>
                <div>
                  <Button variant={viewMode.outbound === "pretty" ? "primary" : "secondary"} onClick={() => setViewMode((v) => ({ ...v, outbound: "pretty" }))}>
                    Pretty
                  </Button>
                  {isHL7(log.transformedPayload) && (
                    <Button variant={viewMode.outbound === "tree" ? "primary" : "secondary"} onClick={() => setViewMode((v) => ({ ...v, outbound: "tree" }))}>
                      Tree
                    </Button>
                  )}
                  <Button variant={viewMode.outbound === "raw" ? "primary" : "secondary"} onClick={() => setViewMode((v) => ({ ...v, outbound: "raw" }))}>
                    Raw
                  </Button>
                </div>
              </div>
              {RenderPayload(viewMode.outbound, log.transformedPayload)}
            </div>
          </div>

          {(log.destinationLogs?.length ?? 0) > 0 && (
            <div>
              <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Destination Results</h3>

              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {(log.destinationLogs ?? []).map((dest: DestinationLog, i: number) => {
                  const state = viewMode.destination[i] || {
                    open: true,
                    request: "pretty",
                    outbound: "pretty",
                    response: "pretty",
                  };

                  return (
                    <div key={i} className="card-bw">
                      <div
                        style={{
                          padding: 12,
                          display: "flex",
                          justifyContent: "space-between",
                          cursor: "pointer",
                        }}
                        onClick={() => toggleDest(i)}
                      >
                        <strong>{dest.destinationName ?? `Destination #${i + 1}`}</strong>
                        <StatusBadge status={dest.status ?? "OUT-UNKNOWN"} />
                      </div>

                      {state.open && (
                        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 24 }}>
                          <div>
                            <strong>Request Data</strong>
                            <div>
                              <Button
                                variant={state.request === "pretty" ? "primary" : "secondary"}
                                onClick={() =>
                                  setViewMode((v) => ({
                                    ...v,
                                    destination: { ...v.destination, [i]: { ...state, request: "pretty" } },
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
                                    destination: { ...v.destination, [i]: { ...state, request: "raw" } },
                                  }))
                                }
                              >
                                Raw
                              </Button>
                            </div>
                            {RenderPayload(state.request, dest.requestData)}
                          </div>

                          <div>
                            <strong>Outbound Data</strong>
                            <div>
                              <Button
                                variant={state.outbound === "pretty" ? "primary" : "secondary"}
                                onClick={() =>
                                  setViewMode((v) => ({
                                    ...v,
                                    destination: { ...v.destination, [i]: { ...state, outbound: "pretty" } },
                                  }))
                                }
                              >
                                Pretty
                              </Button>

                              {isHL7(dest.outboundData) && (
                                <Button
                                  variant={state.outbound === "tree" ? "primary" : "secondary"}
                                  onClick={() =>
                                    setViewMode((v) => ({
                                      ...v,
                                      destination: { ...v.destination, [i]: { ...state, outbound: "tree" } },
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
                                    destination: { ...v.destination, [i]: { ...state, outbound: "raw" } },
                                  }))
                                }
                              >
                                Raw
                              </Button>
                            </div>
                            {RenderPayload(state.outbound, dest.outboundData)}
                          </div>

                          <div>
                            <strong>Destination Response</strong>
                            <div>
                              <Button
                                variant={state.response === "pretty" ? "primary" : "secondary"}
                                onClick={() =>
                                  setViewMode((v) => ({
                                    ...v,
                                    destination: { ...v.destination, [i]: { ...state, response: "pretty" } },
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
                                    destination: { ...v.destination, [i]: { ...state, response: "raw" } },
                                  }))
                                }
                              >
                                Raw
                              </Button>
                            </div>

                            {RenderPayload(state.response, dest.responseText)}
                            <div style={{ textAlign: "right", fontSize: 12, color: "var(--text-soft)" }}>Sent At: {safeDate(dest.sentAt)}</div>
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
