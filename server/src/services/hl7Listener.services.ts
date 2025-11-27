import net from "net";
import { getConnection } from "../config/db.js";
import { hl7ToJson } from "../utils/hl7Converer.js";
import { processInboundMessage } from "./messageProcessor.services.js";
import { VM } from "vm2";

console.log("[HL7] hl7Listener.services loaded...");

export const startHl7Listener = async () => {
  console.log("[HL7] Initializing Dynamic HL7 TCP Listener...");

  let channelList: { id: number; filter_script?: string | null }[] = [];

  // ============================================================
  // REFRESH CHANNEL LIST
  // ============================================================
  async function refreshChannelList() {
    try {
      const pool = await getConnection();
      const result = await pool.request().query(`
        SELECT id, filter_script
        FROM Channels
        WHERE status = 'RUNNING'
          AND source_type = 'HL7'
      `);

      channelList = result.recordset || [];
      console.log(
        "[HL7] Active channels:",
        channelList.map((x) => x.id)
      );
    } catch (err) {
      console.error("[HL7] Failed to refresh channel list:", err);
    }
  }

  await refreshChannelList();
  setInterval(refreshChannelList, 60000);

  // ============================================================
  // TCP SERVER (MLLP)
  // ============================================================
  const PORT = Number(process.env.HL7_PORT || 2575);

  const server = net.createServer((socket) => {
    console.log(`[HL7] Client connected on port ${PORT}`);

    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");

      if (buffer.includes("\x1c\r")) {
        const rawMessage = buffer
          .replace(/\x0b/, "") // MLLP start
          .replace(/\x1c\r/, "") // MLLP end
          .trim();

        buffer = "";

        console.log("────────────────────────────────────");
        console.log("[HL7] Incoming HL7 Message:");
        console.log(rawMessage);
        console.log("────────────────────────────────────");

        let json;
        try {
          json = hl7ToJson(rawMessage);
          console.log("[HL7] Parsed → JSON OK");
        } catch (err) {
          console.error("[HL7] Parse error → sending NACK");
          const nackMsg = buildNack(rawMessage, "HL7 parse error");
          socket.write(`\x0b${nackMsg}\x1c\r`);
          return;
        }

        // ============================================================
        // FILTER SCRIPT ROUTING (Mirth-style)
        // ============================================================
        let routed = false;

        for (const ch of channelList) {
          if (!ch.filter_script?.trim()) continue;

          try {
            const vm = new VM({
              sandbox: { msg: json },
              timeout: 2000,
            });

            const pass = vm.run(`
              (function () {
                ${ch.filter_script}
              })();
            `);

            if (pass) {
              console.log(`[HL7] Routed → Channel ${ch.id}`);
              await processInboundMessage(ch.id, rawMessage);
              routed = true;
            }
          } catch (err) {
            console.error(`[HL7] Filter script error for Channel ${ch.id}:`, err);
          }
        }

        if (!routed) {
          console.warn("[HL7] No channel accepted this message");
          const nackMsg = buildNack(rawMessage, "No matching channel");
          socket.write(`\x0b${nackMsg}\x1c\r`);
          return;
        }

        // ============================================================
        // SEND ACK (normal flow)
        // ============================================================
        const ack = buildAck(rawMessage);
        socket.write(`\x0b${ack}\x1c\r`);
        console.log("[HL7] ACK sent ✓");
      }
    });

    socket.on("close", () => console.log("[HL7] Client disconnected"));
    socket.on("error", (err) => console.error("[HL7] Socket error:", err));
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[HL7] HL7 Listener running on port ${PORT}`);
  });
};

function buildAck(raw: string): string {
  const msh = raw.split("\r")[0] || "";
  const p = msh.split("|");
  const msgId = p[9] || "0000";
  const timestamp = new Date().toISOString();

  return `MSH|^~\\&|MiniMirth|Listener|Sender|Source|${timestamp}||ACK^A01|${msgId}|P|2.3\r` + `MSA|AA|${msgId}\r`;
}

function buildNack(raw: string, reason: string): string {
  const msh = raw.split("\r")[0] || "";
  const p = msh.split("|");
  const msgId = p[9] || "0000";
  const timestamp = new Date().toISOString();

  return `MSH|^~\\&|MiniMirth|Listener|Sender|Source|${timestamp}||ACK^A01|${msgId}|P|2.3\r` + `MSA|AE|${msgId}|${reason}\r`;
}
