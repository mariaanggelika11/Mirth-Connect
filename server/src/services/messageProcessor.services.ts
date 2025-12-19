import axios from "axios";
import net from "net";
import { getConnection } from "../config/db.js";
import { VM } from "vm2";
import { jsonToHl7, hl7ToJson } from "../utils/hl7Converer.js";
import { parseStringPromise, Builder } from "xml2js";

/* =====================================================================
   HELPER: FORMAT ERROR
===================================================================== */
function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/* =====================================================================
   HELPER: RUNTIME TYPE DETECTION
===================================================================== */
function detectRuntimeType(msg: any): string {
  if (msg === null || msg === undefined) return "UNKNOWN";

  if (typeof msg === "object") return "JSON";

  if (typeof msg === "string") {
    const t = msg.trim();
    if (t.startsWith("MSH|")) return "HL7V2";
    if (t.startsWith("<")) return "XML";
    try {
      const temp = JSON.parse(msg);
      if (typeof temp === "object") return "JSON";
    } catch {
      /* ignore */
    }
    return "TEXT";
  }

  return "UNKNOWN";
}

function executeTemplateScript(templateScript: string, msg: any) {
  const context = { msg, hl7ToJson, jsonToHl7 };

  const vm = new VM({
    sandbox: context,
    timeout: 3000,
  });

  const wrapped = `
    (function () {
      ${templateScript}
      return typeof msg !== "undefined" ? msg : undefined;
    })();
  `;

  try {
    return vm.run(wrapped);
  } catch (err) {
    throw new Error("TemplateScriptError: " + formatError(err) + "\n--- TEMPLATE SCRIPT ---\n" + templateScript + "\n--- END SCRIPT ---");
  }
}

/* =====================================================================
   HELPER: EXECUTE USER SCRIPTS (Mirth-like)
   - Dipakai untuk:
     * Source Transformer (channel.processing_script)
     * Destination Transformer (dest.processing_script)
     * Template (dest.template_script)
===================================================================== */
function executeTransformScript(script: string, baseMsg: any) {
  const context = { msg: baseMsg, hl7ToJson, jsonToHl7 };
  const vm = new VM({ sandbox: context, timeout: 3000 });

  const wrapped = `
    (function () {
      ${script}
      return typeof msg !== "undefined" ? msg : undefined;
    })();
  `;

  try {
    return vm.run(wrapped);
  } catch (err) {
    throw new Error("TransformScriptError: " + formatError(err) + "\n--- TRANSFORM SCRIPT ---\n" + script + "\n--- END SCRIPT ---");
  }
}

/* =====================================================================
   HELPER: RESPONSE SCRIPT (per Destination)
   - Digunakan untuk mengubah teks response:
     contoh REST JSON  → "YEY SUKSES"
     contoh HL7       → "ACK RECEIVED: Message delivered. ✓"
===================================================================== */
function executeResponseScript(script: string, baseMsg: any, baseResponse: any) {
  const context = { msg: baseMsg, response: baseResponse, hl7ToJson, jsonToHl7 };
  const vm = new VM({ sandbox: context, timeout: 3000 });

  const wrapped = `
    (function () {
      ${script}
      return typeof response !== "undefined" ? response : undefined;
    })();
  `;

  try {
    return vm.run(wrapped);
  } catch (err) {
    throw new Error("ResponseScriptError: " + formatError(err) + "\n--- RESPONSE SCRIPT ---\n" + script + "\n--- END SCRIPT ---");
  }
}

/* =====================================================================
   TRANSPORT: HL7 / TCP (RAW / MLLP-like sederhana)
===================================================================== */
async function sendTcp(endpoint: string, data: string): Promise<string> {
  const clean = endpoint.trim().replace(/\s+/g, "");
  const [host, port] = clean.replace("tcp://", "").split(":");

  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let ack = "";

    const START = String.fromCharCode(0x0b);
    const END = String.fromCharCode(0x1c) + String.fromCharCode(0x0d);

    client.connect(Number(port), host, () => {
      client.write(START + data + END); // MLLP frame
    });

    client.on("data", (chunk) => {
      ack += chunk.toString();
    });

    client.on("end", () => {
      if (!ack) {
        return reject(new Error("HL7Error: No ACK received from HL7 server"));
      }
      if (!ack.includes("MSA|AA")) {
        return reject(new Error("HL7Error: Negative ACK received → " + ack));
      }
      resolve(ack);
    });

    client.on("error", (err) => {
      reject(new Error("HL7Error: " + err.message));
    });

    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error("HL7Error: Timeout waiting for HL7 server"));
    });
  });
}

/* =====================================================================
   DB HELPERS – INBOUND & OUTBOUND MESSAGE
===================================================================== */

type InboundStatus = "IN-PROCESS" | "IN-PROCESSED" | "IN-ERROR";
type OutboundStatus = "OUT-SENT" | "OUT-ERROR";

interface InsertOutboundParams {
  channelId: number;
  messageType: string;
  requestData: any;
  outboundData: any;
  status: OutboundStatus;
  inboundId: number | null;
}

/* INBOUND = 1 record per receive */
async function insertInboundMessage(pool: any, params: { channelId: number; messageType: string; payload: any }) {
  const res = await pool.request().input("channel_id", params.channelId).input("direction", "IN").input("message_type", params.messageType).input("original_payload", JSON.stringify(params.payload)).input("status", "IN-PROCESS").query(`
      INSERT INTO Messages (
        channel_id, direction, message_type,
        original_payload, status, created_at
      )
      OUTPUT INSERTED.id AS newId
      VALUES (
        @channel_id, @direction, @message_type,
        @original_payload, @status,
        SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time'
      )
    `);

  return res.recordset[0].newId as number;
}

async function updateInboundMessage(pool: any, messageId: number, transformed: any, status: InboundStatus) {
  await pool.request().input("message_id", messageId).input("transformed_payload", JSON.stringify(transformed)).input("status", status).query(`
      UPDATE Messages
      SET transformed_payload = @transformed_payload,
          status = @status,
          updated_at = SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time'
      WHERE id = @message_id
    `);
}

/* OUTBOUND = 1 record per destination, dengan inbound_message_id */
async function insertOutboundMessage(pool: any, params: InsertOutboundParams) {
  const res = await pool
    .request()
    .input("channel_id", params.channelId)
    .input("direction", "OUT")
    .input("message_type", params.messageType)
    .input("original_payload", JSON.stringify(params.requestData))
    .input("transformed_payload", JSON.stringify(params.outboundData))
    .input("status", params.status)
    .input("inbound_id", params.inboundId).query(`
      INSERT INTO Messages (
         channel_id, direction, message_type,
         original_payload, transformed_payload, status,
         inbound_message_id, created_at
      )
      OUTPUT INSERTED.id AS newId
      VALUES (
         @channel_id, @direction, @message_type,
         @original_payload, @transformed_payload, @status,
         @inbound_id,
         SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time'
      )
    `);

  return res.recordset[0].newId as number;
}

/* Destination Log – message_id = OUT message */
async function logDestination(pool: any, outboundMessageId: number, destId: number, status: OutboundStatus, responseText: string, requestData: any, outboundData: any) {
  await pool
    .request()
    .input("message_id", outboundMessageId)
    .input("destination_id", destId)
    .input("status", status)
    .input("response_text", responseText)
    .input("request_data", JSON.stringify(requestData || null))
    .input("outbound_data", JSON.stringify(outboundData || null)).query(`
      INSERT INTO MessageDestinationLog
        (message_id, destination_id, status, response_text, request_data, outbound_data, sent_at)
      VALUES
        (@message_id, @destination_id, @status, @response_text, @request_data, @outbound_data,
         SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time')
    `);
}

/* =====================================================================
   MAIN ENGINE – MIRTH ACCURATE FLOW
   - 1 IN message
   - N OUT message (per destination)
===================================================================== */
export async function processInboundMessage(channelId: number, payload: any) {
  const pool = await getConnection();

  const channel = (
    await pool.request().input("id", channelId).query(`
        SELECT * FROM Channels WHERE id=@id
      `)
  ).recordset[0];

  if (!channel) throw new Error(`Channel ${channelId} not found`);

  const inboundType = (channel.inbound_data_type || "HL7V2").toUpperCase();

  // ======================================================
  // 1) INSERT INBOUND (IN-PROCESS)
  // ======================================================
  const inboundMessageId = await insertInboundMessage(pool, {
    channelId,
    messageType: inboundType,
    payload,
  });

  let transformed: any = payload;

  // ======================================================
  // 2) SOURCE TRANSFORMER
  // ======================================================
  try {
    if (channel.processing_script?.trim()) {
      transformed = executeTransformScript(channel.processing_script, payload);
    }

    await updateInboundMessage(pool, inboundMessageId, transformed, "IN-PROCESSED");
  } catch (err) {
    const msg = formatError(err);
    await updateInboundMessage(pool, inboundMessageId, payload, "IN-ERROR");

    return {
      success: false,
      inboundMessageId,
      error: msg,
      status: "IN-ERROR" as InboundStatus,
    };
  }

  // ======================================================
  // 3) LOOP DESTINATION
  // ======================================================

  const dests = (
    await pool.request().input("channel_id", channelId).query(`
      SELECT * FROM Destinations 
      WHERE channel_id=@channel_id AND ISNULL(is_enabled,1)=1
    `)
  ).recordset;

  const outboundResults: any[] = [];

  // Clone hasil SOURCE TRANSFORM sekali saja
  const sourceResult = JSON.parse(JSON.stringify(transformed));

  for (const dest of dests) {
    // pesan untuk tujuan ini (di-clone supaya transform tidak mempengaruhi channel lain)
    let msgForDest = JSON.parse(JSON.stringify(sourceResult));

    // sebelum transform = hasil source transform (INI YANG BENAR)
    let beforeDestTransform = JSON.parse(JSON.stringify(sourceResult));

    let finalStatus: OutboundStatus = "OUT-SENT";
    let originalResponse = "";
    let responseText = "";

    try {
      const outboundType = (dest.outbound_data_type || "JSON").toUpperCase();
      const destType = (dest.type || "").toUpperCase();

      // -----------------------------------------------
      // 3.a DESTINATION TRANSFORM
      // -----------------------------------------------
      if (dest.processing_script?.trim()) {
        msgForDest = executeTransformScript(dest.processing_script, msgForDest);
      }

      // -----------------------------------------------
      // 3.b TEMPLATE SCRIPT
      // -----------------------------------------------
      if (dest.template_script?.trim()) {
        msgForDest = executeTemplateScript(dest.template_script, msgForDest);
      }

      // -----------------------------------------------
      // 3.c FORMAT HANDLING
      // -----------------------------------------------
      const runtimeType = detectRuntimeType(msgForDest);

      if (outboundType === "JSON") {
        if (typeof msgForDest === "string") {
          try {
            msgForDest = JSON.parse(msgForDest);
          } catch {
            msgForDest = { raw: msgForDest };
          }
        }
      } else if (outboundType === "XML") {
        const builder = new Builder({ headless: true });
        msgForDest = builder.buildObject(typeof msgForDest === "string" ? { raw: msgForDest } : msgForDest);
      } else if (outboundType === "HL7V2") {
        if (runtimeType !== "HL7V2") {
          msgForDest = typeof msgForDest === "string" ? msgForDest : JSON.stringify(msgForDest);
        }
      }

      // -----------------------------------------------
      // 3.d SEND TO DESTINATION
      // -----------------------------------------------
      // if (destType === "REST") {
      //   const headers = {
      //     "Content-Type": outboundType === "HL7V2" ? "text/plain" : outboundType === "XML" ? "application/xml" : "application/json",
      //     "x-channel-id": String(channelId),
      //     "x-destination-id": String(dest.id),
      //   };

      //   const body = typeof msgForDest === "string" ? msgForDest : JSON.stringify(msgForDest);

      //   const resp = await axios.post(dest.endpoint.trim(), body, {
      //     headers,
      //     timeout: 8000,
      //   });

      //   originalResponse = JSON.stringify(resp.data);
      //   responseText = originalResponse;
      // } else if (destType === "HL7" || destType === "MLLP") {
      //   const hl7Payload = typeof msgForDest === "string" ? msgForDest : jsonToHl7(msgForDest);
      //   const ack = await sendTcp(dest.endpoint.trim(), hl7Payload);

      //   originalResponse = ack;
      //   responseText = ack;
      // } else if (destType === "TCP" || destType === "RAW") {
      //   const raw = typeof msgForDest === "string" ? msgForDest : JSON.stringify(msgForDest);
      //   await sendTcp(dest.endpoint.trim(), raw);

      //   originalResponse = "TCP message sent successfully";
      //   responseText = originalResponse;
      // } else {
      //   throw new Error(`Unknown destination type: ${destType}`);
      // }

      // -----------------------------------------------
      // 3.d SEND TO DESTINATION (WITH FULL DEBUG)
      // -----------------------------------------------
      if (destType === "REST") {
        console.log("======================================");
        console.log("[DESTINATION REST] START");
        console.log("Channel ID        :", channelId);
        console.log("Destination ID    :", dest.id);
        console.log("Destination Name  :", dest.name);
        console.log("Endpoint (raw)    :", JSON.stringify(dest.endpoint));
        console.log("Endpoint (trim)   :", JSON.stringify(dest.endpoint.trim()));
        console.log("Outbound Type     :", outboundType);
        console.log("msgForDest type   :", typeof msgForDest);

        const headers = {
          "Content-Type": outboundType === "HL7V2" ? "text/plain" : outboundType === "XML" ? "application/xml" : "application/json",
          "x-channel-id": String(channelId),
          "x-destination-id": String(dest.id),
        };

        console.log("Request Headers   :", headers);

        const body = typeof msgForDest === "string" ? msgForDest : JSON.stringify(msgForDest);

        console.log("Request Body Type :", typeof body);
        console.log("Request Body Peek:", typeof body === "string" ? body.substring(0, 200) : body);

        try {
          console.log("[AXIOS] Sending request...");
          const resp = await axios.post(dest.endpoint.trim(), body, {
            headers,
            timeout: 8000,
            validateStatus: () => true, // ⬅️ penting: supaya 4xx/5xx tidak throw
          });

          console.log("[AXIOS] Response Status :", resp.status);
          console.log("[AXIOS] Response Headers:", resp.headers);
          console.log("[AXIOS] Response Data   :", resp.data);

          originalResponse = JSON.stringify(resp.data);
          responseText = originalResponse;

          // anggap sukses hanya jika status < 400
          if (resp.status >= 400) {
            throw new Error(`REST destination returned HTTP ${resp.status}: ${originalResponse}`);
          }
        } catch (axiosErr: any) {
          console.error("[AXIOS ERROR]");
          console.error("Message :", axiosErr.message);

          if (axiosErr.code) {
            console.error("Code    :", axiosErr.code);
          }

          if (axiosErr.response) {
            console.error("Status  :", axiosErr.response.status);
            console.error("Headers :", axiosErr.response.headers);
            console.error("Data    :", axiosErr.response.data);
          }

          throw axiosErr; // ⬅️ biar masuk ke catch besar
        }

        console.log("[DESTINATION REST] END");
        console.log("======================================");
      } else if (destType === "HL7" || destType === "MLLP") {
        console.log("[DESTINATION HL7/MLLP] Sending HL7");

        const hl7Payload = typeof msgForDest === "string" ? msgForDest : jsonToHl7(msgForDest);

        console.log("HL7 Payload Peek:", hl7Payload.substring(0, 200));

        const ack = await sendTcp(dest.endpoint.trim(), hl7Payload);

        console.log("HL7 ACK:", ack);

        originalResponse = ack;
        responseText = ack;
      } else if (destType === "TCP" || destType === "RAW") {
        console.log("[DESTINATION TCP/RAW] Sending RAW");

        const raw = typeof msgForDest === "string" ? msgForDest : JSON.stringify(msgForDest);

        console.log("RAW Payload Peek:", raw.substring(0, 200));

        await sendTcp(dest.endpoint.trim(), raw);

        originalResponse = "TCP message sent successfully";
        responseText = originalResponse;
      } else {
        throw new Error(`Unknown destination type: ${destType}`);
      }

      // -----------------------------------------------
      // 3.e RESPONSE SCRIPT
      // -----------------------------------------------
      if (dest.response_script?.trim()) {
        responseText = executeResponseScript(dest.response_script, msgForDest, originalResponse);
      }

      finalStatus = "OUT-SENT";
    } catch (err) {
      finalStatus = "OUT-ERROR";
      responseText = formatError(err);
    }

    // -----------------------------------------------
    // 3.f SAVE OUTBOUND MESSAGE
    // -----------------------------------------------
    const outboundMessageId = await insertOutboundMessage(pool, {
      channelId,
      messageType: dest.outbound_data_type || inboundType,
      requestData: beforeDestTransform, // <- FIX UTAMA
      outboundData: msgForDest,
      status: finalStatus,
      inboundId: inboundMessageId,
    });

    await logDestination(pool, outboundMessageId, dest.id, finalStatus, responseText, beforeDestTransform, msgForDest);

    outboundResults.push({
      destinationId: dest.id,
      destinationName: dest.name,
      outboundMessageId,
      status: finalStatus,
      response: responseText,
    });
  }

  // ======================================================
  // 4) FINAL INBOUND STATUS (REAL MIRTH-LIKE)
  // ======================================================
  const total = outboundResults.length;
  const sent = outboundResults.filter((o) => o.status === "OUT-SENT").length;
  const fails = outboundResults.filter((o) => o.status === "OUT-ERROR").length;

  let finalInboundStatus: InboundStatus | string = "IN-PROCESSED";

  // No destination → inbound only
  if (total === 0) {
    finalInboundStatus = "RECEIVED";
  }
  // Semua sukses → SUCCESS
  else if (sent === total) {
    finalInboundStatus = "SUCCESS";
  }
  // Partial → PARTIAL
  else if (sent > 0 && fails > 0) {
    finalInboundStatus = "PARTIAL";
  }
  // Semua gagal → FAILED
  else if (fails === total) {
    finalInboundStatus = "FAILED";
  }

  // Simpan ke DB
  await pool.request().input("id", inboundMessageId).input("status", finalInboundStatus).query(`
    UPDATE Messages
    SET status = @status,
        updated_at = SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time'
    WHERE id=@id
  `);

  // ======================================================
  // 5) RETURN RESULT
  // ======================================================
  return {
    success: true,
    inboundMessageId,
    channelId,
    direction: "IN",
    messageType: inboundType,
    inboundStatus: finalInboundStatus,
    outboundResults,
  };
}

/* =====================================================================
   RESEND – HANYA UNTUK OUTBOUND MESSAGE (OUT-ERROR)
   - Insert OUT baru, tidak menyentuh IN, tetap refer inbound_message_id
===================================================================== */
export async function resendMessage(oldOutboundMessageId: number) {
  const pool = await getConnection();

  // Ambil OUT lama
  const oldMsg = (await pool.request().input("id", oldOutboundMessageId).query(`SELECT * FROM Messages WHERE id=@id`)).recordset[0];

  if (!oldMsg) throw new Error("Message not found");
  if (oldMsg.direction !== "OUT") throw new Error("Only outbound messages can be resent");
  if (oldMsg.status !== "OUT-ERROR") throw new Error("Only OUT-ERROR messages can be resent");

  const channelId = oldMsg.channel_id;
  const inboundId: number | null = oldMsg.inbound_message_id ?? null;

  // Ambil 1 log untuk tahu destination_id
  const destLog = (
    await pool.request().input("message_id", oldOutboundMessageId).query(`
        SELECT TOP 1 destination_id 
        FROM MessageDestinationLog 
        WHERE message_id=@message_id
      `)
  ).recordset[0];

  if (!destLog) throw new Error("Destination log not found for this outbound message");

  const destinationId = destLog.destination_id;

  // Ambil definisi channel & destination
  const channel = (await pool.request().input("id", channelId).query(`SELECT * FROM Channels WHERE id=@id`)).recordset[0];

  if (!channel) throw new Error("Channel not found");

  const dest = (await pool.request().input("id", destinationId).query(`SELECT * FROM Destinations WHERE id=@id`)).recordset[0];

  if (!dest) throw new Error("Destination not found");

  // requestData = original_payload dari OUT lama (JSON string)
  const requestData = JSON.parse(oldMsg.original_payload);
  let msgForDest: any = requestData;
  const outboundType = (dest.outbound_data_type || "JSON").toUpperCase();
  const destType = (dest.type || "").toUpperCase();

  let finalStatus: OutboundStatus = "OUT-SENT";
  let originalResponse = "";
  let responseText = "";

  try {
    // Re-run destination processing + template
    if (dest.processing_script?.trim()) {
      msgForDest = executeTemplateScript(dest.template_script, msgForDest);
    }

    const hasTemplate = !!dest.template_script?.trim();
    if (hasTemplate) {
      msgForDest = executeTemplateScript(dest.template_script, msgForDest);
    }

    const runtimeType = detectRuntimeType(msgForDest);
    if (!hasTemplate) {
      if (outboundType === "HL7V2") {
        if (runtimeType !== "HL7V2") {
          msgForDest = typeof msgForDest === "string" ? msgForDest : JSON.stringify(msgForDest);
        }
      } else if (outboundType === "JSON") {
        if (typeof msgForDest === "string") {
          try {
            msgForDest = JSON.parse(msgForDest);
          } catch {
            msgForDest = { raw: msgForDest };
          }
        }
      } else if (outboundType === "XML") {
        const builder = new Builder({ headless: true });
        msgForDest = builder.buildObject(typeof msgForDest === "string" ? { raw: msgForDest } : msgForDest);
      } else {
        msgForDest = typeof msgForDest === "string" ? msgForDest : JSON.stringify(msgForDest);
      }
    }

    // Kirim lagi
    if (destType === "REST") {
      const headers = {
        "Content-Type": outboundType === "HL7V2" ? "text/plain" : outboundType === "XML" ? "application/xml" : "application/json",
      };

      const body = typeof msgForDest === "string" ? msgForDest : JSON.stringify(msgForDest);

      const resp = await axios.post(dest.endpoint.trim(), body, { headers });
      originalResponse = JSON.stringify(resp.data);
      responseText = originalResponse;
    } else if (destType === "HL7" || destType === "MLLP") {
      const hl7Payload = typeof msgForDest === "string" ? msgForDest : jsonToHl7(msgForDest);
      const ack = await sendTcp(dest.endpoint.trim(), hl7Payload);

      originalResponse = ack;
      responseText = ack;
    } else if (destType === "TCP" || destType === "RAW") {
      const raw = typeof msgForDest === "string" ? msgForDest : JSON.stringify(msgForDest);
      await sendTcp(dest.endpoint.trim(), raw);
      originalResponse = "TCP message sent successfully";
      responseText = originalResponse;
    } else {
      throw new Error(`Unknown destination type: ${destType}`);
    }

    if (dest.response_script?.trim()) {
      responseText = executeResponseScript(dest.response_script, msgForDest, originalResponse);
    }

    finalStatus = "OUT-SENT";
  } catch (err) {
    finalStatus = "OUT-ERROR";
    responseText = formatError(err);
  }

  const newOutboundId = await insertOutboundMessage(pool, {
    channelId,
    messageType: dest.outbound_data_type || channel.inbound_data_type || "JSON",
    requestData,
    outboundData: msgForDest,
    status: finalStatus,
    inboundId, // 🔗 tetap refer ke inbound yang sama
  });

  await logDestination(pool, newOutboundId, destinationId, finalStatus, responseText, requestData, msgForDest);

  return {
    messageId: newOutboundId,
    status: finalStatus,
  };
}
