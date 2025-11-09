import axios from "axios";
import net from "net";
import { getConnection } from "../config/db.js";
import { VM } from "vm2";
import { jsonToHl7, hl7ToJson } from "../utils/hl7Converer.js";

function detectMessageFormat(payload: any): "HL7" | "JSON" | "XML" | "TEXT" {
  if (payload && typeof payload === "object" && !Buffer.isBuffer(payload)) return "JSON";
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (/^MSH\|/.test(trimmed)) return "HL7";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "JSON";
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) return "XML";
  }
  return "TEXT";
}

async function sendTcp(endpoint: string, data: string) {
  const clean = endpoint.trim().replace(/\s+/g, "");
  const [host, port] = clean.replace("tcp://", "").split(":");
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

function runUserScript(script: string, msg: any, extraSandbox: any = {}) {
  const sandbox = { msg, jsonToHl7, hl7ToJson, ...extraSandbox };
  const vm = new VM({ sandbox, timeout: 3000 });
  return vm.run(script);
}

async function insertMessage(pool, data) {
  const res = await pool.request().input("channel_id", data.channel_id).input("direction", data.direction).input("message_type", data.message_type).input("original_payload", JSON.stringify(data.payload)).input("status", data.status).query(`
      INSERT INTO Messages (channel_id, direction, message_type, original_payload, status, created_at)
      OUTPUT INSERTED.id AS newId
      VALUES (@channel_id,@direction,@message_type,@original_payload,@status,
              SYSDATETIMEOFFSET() AT TIME ZONE 'SE Asia Standard Time')
    `);
  return res.recordset[0].newId;
}

async function updateMessage(pool, messageId, data, status) {
  await pool.request().input("message_id", messageId).input("transformed_payload", JSON.stringify(data)).input("status", status).query(`
      UPDATE Messages
      SET transformed_payload=@transformed_payload,
          status=@status,
          updated_at=SYSDATETIMEOFFSET() AT TIME ZONE 'SE Asia Standard Time'
      WHERE id=@message_id
    `);
}

async function logDestination(pool, messageId, destId, status, text) {
  await pool.request().input("message_id", messageId).input("destination_id", destId).input("status", status).input("response_text", text).query(`
      INSERT INTO MessageDestinationLog (message_id,destination_id,status,response_text,sent_at)
      VALUES (@message_id,@destination_id,@status,@response_text,
              SYSDATETIMEOFFSET() AT TIME ZONE 'SE Asia Standard Time')
    `);
}

export async function processInboundMessage(channelId: number, payload: any) {
  const pool = await getConnection();

  const channel = (await pool.request().input("id", channelId).query(`SELECT * FROM Channels WHERE id=@id`)).recordset[0];
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

  const messageId = await insertMessage(pool, {
    channel_id: channelId,
    direction: "IN",
    message_type: sourceType,
    payload,
    status: "IN-PROCESS",
  });
  console.log(`[PROCESS] Message #${messageId} logged as IN-PROCESS`);

  let transformed = payload;
  try {
    if (channel.processing_script?.trim()) {
      transformed = runUserScript(`${channel.processing_script}; transform(msg);`, payload);
    }
    await updateMessage(pool, messageId, transformed, "PROCESSED");
    console.log(`[PROCESS] Message #${messageId} updated to PROCESSED`);
  } catch (err: any) {
    console.error(`[PROCESS] Error processing message:`, err);
    await updateMessage(pool, messageId, payload, "ERROR");
    return { messageId, error: err.message, status: "ERROR" };
  }

  const dests = (await pool.request().input("channel_id", channelId).query(`SELECT * FROM Destinations WHERE channel_id=@channel_id AND is_enabled=1`)).recordset;

  if (dests.length === 0) {
    console.warn(`[PROCESS] No active destinations for channel ${channel.name}`);
    await updateMessage(pool, messageId, transformed, "OUT-SENT");
    return { messageId, transformed, status: "OUT-SENT" };
  }

  let allOk = true;
  for (const dest of dests) {
    try {
      let msgForDest = transformed;
      let responseText = "";
      const destType = (dest.type || "").toUpperCase();

      try {
        if (dest.processing_script?.trim()) {
          msgForDest = runUserScript(`${dest.processing_script}`, transformed);
        } else if (channel.response_script?.trim()) {
          msgForDest = runUserScript(`${channel.response_script}`, transformed);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[WARN] Transform script error for ${dest.name}:`, msg);
      }

      const sourceFormat = detectMessageFormat(transformed);

      if (sourceFormat === "HL7" && destType === "REST") {
        msgForDest = hl7ToJson(msgForDest);
      } else if (sourceFormat === "JSON" && destType === "HL7") {
        msgForDest = jsonToHl7(msgForDest);
      }

      if (destType === "REST") {
        let bodyToSend = msgForDest;
        try {
          if (typeof msgForDest === "string") bodyToSend = JSON.parse(msgForDest);
        } catch {
          // ignore
        }

        console.log(`[SEND] → REST ${dest.endpoint}`);
        const resp = await axios.post(dest.endpoint.trim(), bodyToSend, {
          headers: { "Content-Type": "application/json" },
          timeout: 8000,
        });
        responseText = JSON.stringify(resp.data);
      } else if (destType === "HL7") {
        console.log(`[SEND] → HL7 ${dest.endpoint}`);
        await sendTcp(dest.endpoint.trim(), typeof msgForDest === "string" ? msgForDest : jsonToHl7(msgForDest));
        responseText = "HL7 message sent successfully";
      } else if (destType === "FILE") {
        console.log(`[SEND] → FILE output (simulated)`);
        responseText = "File output simulated";
      } else {
        responseText = `Unsupported destination type: ${destType}`;
        console.warn(`[WARN] Unknown destination type ${destType}`);
      }

      await logDestination(pool, messageId, dest.id, "SUCCESS", responseText);
      await pool.request().input("id", dest.id).query(`
          UPDATE Destinations 
          SET total_sent=ISNULL(total_sent,0)+1,
              last_sent=SYSDATETIMEOFFSET() AT TIME ZONE 'SE Asia Standard Time'
          WHERE id=@id
        `);
    } catch (err: any) {
      allOk = false;
      console.error(`[ERROR] Sending to ${dest.endpoint}:`, err.message);
      await logDestination(pool, messageId, dest.id, "ERROR", err.message);
      await pool.request().input("id", dest.id).query(`UPDATE Destinations SET total_error=ISNULL(total_error,0)+1 WHERE id=@id`);
    }
  }

  const finalStatus = allOk ? "OUT-SENT" : "ERROR";
  await updateMessage(pool, messageId, transformed, finalStatus);
  console.log(`[PROCESS] Message #${messageId} final status: ${finalStatus}`);

  return {
    messageId,
    channelId,
    direction: "IN",
    messageType: sourceType,
    transformed,
    status: finalStatus,
    createdAt: new Date().toISOString(),
  };
}
