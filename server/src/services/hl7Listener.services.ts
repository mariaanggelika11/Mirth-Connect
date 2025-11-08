import net from "net";
import { getConnection } from "../config/db.js";
import { hl7ToJson } from "../utils/hl7Converer.js";
import { processInboundMessage } from "./messageProcessor.services.js";
import { VM } from "vm2";

console.log("[HL7] hl7Listener.services loaded...");

export const startHl7Listener = async () => {
  console.log("[HL7] Initializing Dynamic HL7 TCP Listener...");

  // cache daftar channel aktif dengan filter_script
  let channelList: { id: number; filter_script?: string }[] = [];

  // refresh channel aktif dari DB
  async function refreshChannelList() {
    try {
      const pool = await getConnection();
      const result = await pool.request().query(`
        SELECT id, filter_script
        FROM Channels
      `);
      channelList = result.recordset || [];
      console.log(
        "[HL7] Channel list refreshed:",
        channelList.map((c) => c.id)
      );
    } catch (err) {
      console.error("[HL7] Failed to refresh channel list:", err);
    }
  }

  await refreshChannelList();
  setInterval(refreshChannelList, 60000);

  // listener TCP
  const server = net.createServer((socket) => {
    console.log("[HL7] Client connected to port 2575");

    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");

      // deteksi akhir MLLP
      if (buffer.includes("\x1c\r")) {
        const rawMessage = buffer
          .replace(/\x0b/, "")
          .replace(/\x1c\r/, "")
          .trim();
        buffer = "";

        console.log("[HL7] Incoming HL7 message:");
        console.log(rawMessage);

        try {
          //  parse HL7 ke JSON
          const jsonData = hl7ToJson(rawMessage);
          console.log("[HL7] Parsed HL7 JSON:", jsonData);

          //  jalankan filter script tiap channel
          let routed = false;
          for (const ch of channelList) {
            if (!ch.filter_script) continue;
            try {
              const vm = new VM({ sandbox: { msg: jsonData } });
              const pass = vm.run(ch.filter_script);
              if (pass) {
                console.log(`[HL7] Message routed to Channel ${ch.id}`);
                await processInboundMessage(ch.id, jsonData);
                routed = true;
              }
            } catch (e) {
              console.error(`[HL7] Error evaluating filter for channel ${ch.id}:`, e);
            }
          }

          // 3️⃣ jika tidak ada channel yang cocok
          if (!routed) {
            console.warn("[HL7] No channel accepted this message.");
            socket.write(`\x0b${buildNack(rawMessage, "No matching channel")}\x1c\r`);
            return;
          }

          // 4️⃣ kirim ACK
          const ack = buildAck(rawMessage);
          socket.write(`\x0b${ack}\x1c\r`);
          console.log("[HL7] ACK sent to sender!");
        } catch (err) {
          console.error("[HL7] Processing error:", err);
          const nack = buildNack(buffer, err instanceof Error ? err.message : "Unknown error");
          socket.write(`\x0b${nack}\x1c\r`);
        }
      }
    });

    socket.on("close", () => console.log("[HL7] Client disconnected"));
    socket.on("error", (err) => console.error("[HL7] Socket error:", err));
  });

  server.listen(2575, "0.0.0.0", () => {
    console.log("[HL7] Dynamic Multi-Channel Listener running on port 2575");
  });
};

// helper ACK/NACK builder
function buildAck(rawMessage: string): string {
  const msh = rawMessage.split("\r")[0];
  const fields = msh.split("|");
  const msgId = fields[9] || "0000";
  return `MSH|^~\\&|MiniMirth|Listener|Sender|Source|${new Date().toISOString()}||ACK^A01|${msgId}|P|2.3\rMSA|AA|${msgId}\r`;
}

function buildNack(rawMessage: string, reason: string): string {
  const msh = rawMessage.split("\r")[0];
  const fields = msh.split("|");
  const msgId = fields[9] || "0000";
  return `MSH|^~\\&|MiniMirth|Listener|Sender|Source|${new Date().toISOString()}||ACK^A01|${msgId}|P|2.3\rMSA|AE|${msgId}|${reason}\r`;
}
