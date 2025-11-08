import axios from "axios";
import net from "net";
import { getConnection } from "../config/db.js";
import { VM } from "vm2";
import { jsonToHl7, hl7ToJson } from "../utils/hl7Converer.js";

/* =========================================================
 * Helper: Deteksi format message (HL7, JSON, XML, TEXT)
 * ========================================================= */
function detectMessageFormat(payload: any): "HL7" | "JSON" | "XML" | "TEXT" {
  if (payload !== null && typeof payload === "object" && !Buffer.isBuffer(payload)) return "JSON";
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (/^MSH\|/.test(trimmed) && trimmed.includes("PID|")) return "HL7";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(trimmed);
        return "JSON";
      } catch {}
    }
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) return "XML";
  }
  return "TEXT";
}

/* =========================================================
 * Helper: Kirim HL7 via TCP
 * ========================================================= */
async function sendTcp(endpoint: string, data: string) {
  const [host, port] = endpoint.replace("tcp://", "").split(":");
  return new Promise<void>((resolve, reject) => {
    const client = new net.Socket();
    client.connect(Number(port), host, () => {
      client.write(data);
      client.end();
      resolve();
    });
    client.on("error", reject);
  });
}

/* =========================================================
 * Helper: Eksekusi script sandbox aman (VM2)
 * ========================================================= */
function runUserScript(script: string, msg: any, extraSandbox: any = {}) {
  const sandbox = { msg, jsonToHl7, hl7ToJson, ...extraSandbox };
  const vm = new VM({ sandbox, timeout: 3000 });
  return vm.run(script);
}

/* =========================================================
 * Helper DB Logging
 * ========================================================= */
async function insertMessage(pool, data) {
  const res = await pool.request().input("channel_id", data.channel_id).input("direction", data.direction).input("message_type", data.message_type).input("original_payload", JSON.stringify(data.payload)).input("status", data.status).query(`
      INSERT INTO Messages (channel_id, direction, message_type, original_payload, status, created_at)
      OUTPUT INSERTED.id AS newId
      VALUES (@channel_id, @direction, @message_type, @original_payload, @status, GETDATE())
    `);
  return res.recordset[0].newId;
}

async function updateMessage(pool, messageId, data, status = "PROCESSED") {
  await pool.request().input("message_id", messageId).input("transformed_payload", JSON.stringify(data)).input("status", status).query(`
      UPDATE Messages
      SET transformed_payload = @transformed_payload, status = @status, updated_at = GETDATE()
      WHERE id = @message_id
    `);
}

async function logDestination(pool, messageId, destId, status, text) {
  await pool.request().input("message_id", messageId).input("destination_id", destId).input("status", status).input("response_text", text).query(`
      INSERT INTO MessageDestinationLog (message_id, destination_id, status, response_text, sent_at)
      VALUES (@message_id, @destination_id, @status, @response_text, GETDATE())
    `);
}

export async function processInboundMessage(channelId: number, payload: any) {
  const pool = await getConnection();

  const channel = (
    await pool.request().input("id", channelId).query(`
        SELECT id, name, status, processing_script, response_script
        FROM Channels WHERE id = @id
      `)
  ).recordset[0];
  if (!channel) throw new Error(`Channel ${channelId} not found`);

  const sourceType = detectMessageFormat(payload);
  console.log(`[PROCESS] Source detected: ${sourceType}`);

  if (channel.status?.toUpperCase() !== "RUNNING") {
    await insertMessage(pool, {
      channel_id: channelId,
      direction: "IN",
      message_type: sourceType,
      payload,
      status: "SKIPPED",
    });
    return { skipped: true, status: channel.status };
  }

  // 1️⃣ Log pesan inbound awal
  const messageId = await insertMessage(pool, {
    channel_id: channelId,
    direction: "IN",
    message_type: sourceType,
    payload,
    status: "IN-PROCESS",
  });
  console.log(`[PROCESS] Message #${messageId} logged as IN-PROCESS`);

  // 2️⃣ Jalankan processing script
  let transformed = payload;
  if (channel.processing_script?.trim()) {
    try {
      transformed = runUserScript(`${channel.processing_script}; transform(msg);`, payload);
      console.log(`[PROCESS] Channel Processing Script executed`);
    } catch (err: any) {
      console.error(`[PROCESS] Error in Channel Processing Script:`, err);
      await updateMessage(pool, messageId, payload, "ERROR");
      return { messageId, error: err.message || String(err), status: "ERROR" };
    }
  }

  // 3️⃣ Update status ke PROCESSED
  await updateMessage(pool, messageId, transformed, "PROCESSED");
  console.log(`[PROCESS] Message #${messageId} updated to PROCESSED`);

  // 4️⃣ Ambil destinasi aktif
  const dests = (
    await pool.request().input("channel_id", channelId).query(`
        SELECT * FROM Destinations 
        WHERE channel_id = @channel_id AND is_enabled = 1
      `)
  ).recordset;

  if (dests.length === 0) {
    console.warn(`[PROCESS] No active destinations for channel ${channel.name}`);
  }

  // 5️⃣ Kirim ke setiap destination
  for (const dest of dests) {
    try {
      let msgForDest = transformed;
      let responseText = "";

      // Jalankan script destinasi / response script channel
      if (channel.response_script?.trim()) {
        msgForDest = runUserScript(`${channel.response_script}`, transformed);
        console.log(`[PROCESS] Channel Response Script executed for ${channel.name}`);
      } else if (dest.processing_script?.trim()) {
        msgForDest = runUserScript(`${dest.processing_script}`, transformed);
        console.log(`[PROCESS] Destination Script executed for ${dest.name}`);
      }

      // Auto konversi HL7 ↔ JSON
      const isHL7Source = sourceType === "HL7";
      const isJSONSource = sourceType === "JSON";
      const isHL7Dest = dest.type === "HL7";
      const isRESTDest = dest.type === "REST";

      if (isHL7Source && isRESTDest && typeof msgForDest === "string" && msgForDest.includes("MSH|")) {
        msgForDest = hl7ToJson(msgForDest);
        console.log(`[PROCESS] Auto-converted HL7 → JSON for ${dest.name}`);
      }

      if (isJSONSource && isHL7Dest && (typeof msgForDest !== "string" || !msgForDest.startsWith("MSH|"))) {
        msgForDest = jsonToHl7(msgForDest);
        console.log(`[PROCESS] Auto-converted JSON → HL7 for ${dest.name}`);
      }

      // Kirim pesan ke destinasi
      if (dest.type === "REST") {
        const response = await axios.post(dest.endpoint, msgForDest, {
          timeout: 8000,
          headers: { "Content-Type": "application/json" },
        });
        responseText = JSON.stringify(response.data);
        console.log(`[PROCESS] Message sent to REST endpoint ${dest.endpoint}`);
      } else if (dest.type === "HL7") {
        await sendTcp(dest.endpoint, msgForDest);
        responseText = "HL7 message sent successfully";
        console.log(`[PROCESS] Message sent to HL7 endpoint ${dest.endpoint}`);
      } else {
        responseText = "Unsupported destination type";
        console.warn(`[PROCESS] Unsupported destination type for ${dest.name}`);
      }

      await logDestination(pool, messageId, dest.id, "SUCCESS", responseText);
      await pool.request().input("id", dest.id).query(`UPDATE Destinations 
                SET total_sent = total_sent + 1, last_sent = GETDATE() 
                WHERE id = @id`);
    } catch (err: any) {
      console.error(`[PROCESS] Error sending to ${dest.endpoint}:`, err.message);
      await logDestination(pool, messageId, dest.id, "ERROR", String(err.message));
      await pool.request().input("id", dest.id).query(`UPDATE Destinations 
                SET total_error = total_error + 1 
                WHERE id = @id`);
      await updateMessage(pool, messageId, transformed, "ERROR");
    }
  }

  // 6️⃣ Update message utama sebagai SENT (OUT-SENT)
  await pool.request().input("message_id", messageId).query(`
      UPDATE Messages
      SET status = 'SENT', updated_at = GETDATE()
      WHERE id = @message_id
    `);

  console.log(`[PROCESS] Message #${messageId} updated to OUT-SENT`);

  // 7️⃣ Tambah log outbound (optional history tracking)
  await insertMessage(pool, {
    channel_id: channelId,
    direction: "OUT",
    message_type: sourceType,
    payload: transformed,
    status: "SENT",
  });

  return { messageId, transformed, skipped: false, status: "SENT" };
}
