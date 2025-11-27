import { Request, Response } from "express";
import { getConnection } from "../config/db.js";
import axios from "axios";
import net from "net";
import fs from "fs/promises";
import path from "path";
import { VM } from "vm2";
import { jsonToHl7, hl7ToJson } from "../utils/hl7Converer.js";
import { parseStringPromise, Builder } from "xml2js";

/* =======================================================================
   HELPER: FORMAT ERROR
======================================================================= */
function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/* =======================================================================
   HELPER: DETECT RUNTIME DATA TYPE
======================================================================= */
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
    } catch {}
    return "TEXT";
  }

  return "UNKNOWN";
}

/* =======================================================================
   HELPER: FORMAT CONVERSION
======================================================================= */
async function convertDataFormat(msg: any, fromType: string, toType: string) {
  const f = (fromType || "").toUpperCase();
  const t = (toType || "").toUpperCase();

  if (f === t) return msg;

  try {
    let data = msg;

    if (f === "JSON" && typeof msg === "string") {
      try {
        data = JSON.parse(msg);
      } catch {
        throw new Error("Invalid JSON string during conversion");
      }
    }

    if (f === "HL7V2" && t === "JSON") {
      const hl7 = typeof data === "string" ? data : String(data);
      return hl7ToJson(hl7);
    }

    if (f === "JSON" && t === "HL7V2") {
      const obj = typeof data === "string" ? JSON.parse(data) : data;
      return jsonToHl7(obj);
    }

    if (f === "XML" && t === "JSON") {
      const xml = typeof data === "string" ? data : String(data);
      return await parseStringPromise(xml);
    }

    if (f === "JSON" && t === "XML") {
      const builder = new Builder({ headless: true });
      const obj = typeof data === "string" ? JSON.parse(data) : data;
      return builder.buildObject(obj);
    }

    if (f === "JSON" && t === "TEXT") {
      const obj = typeof data === "string" ? JSON.parse(data) : data;
      return JSON.stringify(obj);
    }

    if (f === "TEXT" && t === "JSON") {
      try {
        return JSON.parse(data);
      } catch {
        return { text: data };
      }
    }
  } catch (err) {
    throw new Error(`ConvertError (${f} to ${t}): ${formatError(err)}`);
  }

  return msg;
}

/* =======================================================================
   HELPER: EXECUTE USER SCRIPTS
======================================================================= */
function executeTransformScript(script: string, context: any) {
  const vm = new VM({ sandbox: context, timeout: 4000 });
  const wrapped = `
    (function () {
      ${script}
      if (typeof msg !== "undefined") return msg;
    })();
  `;
  return vm.run(wrapped);
}

function executeResponseScript(script: string, context: any) {
  const vm = new VM({ sandbox: context, timeout: 3000 });
  const wrapped = `
    (function () {
      ${script}
      if (typeof response !== "undefined") return response;
    })();
  `;
  return vm.run(wrapped);
}

/* =======================================================================
   TRANSPORT: MLLP
======================================================================= */
async function sendMLLP(endpoint: string, hl7Data: string): Promise<string> {
  const clean = endpoint.trim().replace(/\s+/g, "");
  const [host, portStr] = clean.replace("mllp://", "").replace("tcp://", "").split(":");
  const port = Number(portStr || "2575");

  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    const MLLP_START = String.fromCharCode(0x0b);
    const MLLP_END = String.fromCharCode(0x1c);
    const CR = String.fromCharCode(0x0d);

    const wrapped = `${MLLP_START}${hl7Data}${MLLP_END}${CR}`;

    client.connect(port, host, () => {
      client.write(wrapped);
      client.end();
    });

    client.on("error", reject);
    client.on("close", () => resolve("HL7 MLLP message sent successfully"));
  });
}

/* =======================================================================
   TRANSPORT: RAW TCP
======================================================================= */
async function sendRawTCP(endpoint: string, data: any): Promise<string> {
  const clean = endpoint.trim();
  const [host, portStr] = clean.replace("tcp://", "").split(":");
  const port = Number(portStr || "3000");

  const payload = typeof data === "string" ? data : JSON.stringify(data);

  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.connect(port, host, () => {
      client.write(payload);
      client.end();
    });
    client.on("error", reject);
    client.on("close", () => resolve("TCP message sent successfully"));
  });
}

/* =======================================================================
   TRANSPORT: FILE OUTPUT
======================================================================= */
async function sendToFile(filepath: string, data: any): Promise<string> {
  const dir = path.dirname(filepath);
  await fs.mkdir(dir, { recursive: true });

  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  await fs.writeFile(filepath, content, "utf8");

  return "File written successfully";
}

/* =======================================================================
   MAIN FUNCTION: SEND TO DESTINATIONS
======================================================================= */
// export const sendToDestinations = async (req: Request, res: Response) => {
//   const { channelId, messageId, payload } = req.body;

//   if (!channelId || !payload) {
//     return res.status(400).json({ message: "channelId and payload are required" });
//   }

//   try {
//     const pool = await getConnection();

//     const result = await pool.request().input("channel_id", channelId).query(`SELECT * FROM Destinations WHERE channel_id=@channel_id AND is_enabled=1`);

//     const destinations = result.recordset;
//     const logs: any[] = [];

//     for (const dest of destinations) {
//       try {
//         let outbound = payload;

//         // PRE-TRANSFORM (template_script)
//         if (dest.template_script?.trim()) {
//           const vm = new VM({
//             sandbox: { payload, template: dest.template_script },
//             timeout: 2000,
//           });

//           outbound = vm.run(`
//             (function() {
//               ${dest.template_script}
//             })();
//           `);
//         }

//         // TRANSFORM SCRIPT
//         if (dest.processing_script?.trim()) {
//           const ctx = { msg: outbound, hl7ToJson, jsonToHl7 };
//           const result = executeTransformScript(dest.processing_script, ctx);
//           outbound = result ?? ctx.msg;
//         }

//         const runtimeType = detectRuntimeType(outbound);
//         const outboundType = (dest.outbound_data_type || "JSON").toUpperCase();

//         // FORMAT CONVERSION
//         if (runtimeType !== outboundType) {
//           outbound = await convertDataFormat(outbound, runtimeType, outboundType);
//         }

//         let originalResponse = "";
//         let finalResponse = "";

//         // ========================================
//         // TRANSPORT: REST
//         // ========================================
//         if (dest.type === "REST") {
//           const headers = {
//             "Content-Type": outboundType === "HL7V2" ? "text/plain" : outboundType === "XML" ? "application/xml" : "application/json",
//           };

//           const body = typeof outbound === "string" ? outbound : JSON.stringify(outbound);
//           const resp = await axios.post(dest.endpoint.trim(), body, { headers });

//           originalResponse = JSON.stringify(resp.data);
//           finalResponse = originalResponse;
//         }

//         // ========================================
//         // TRANSPORT: MLLP (HL7 TCP)
//         // ========================================
//         else if (dest.type === "MLLP") {
//           const hl7 = typeof outbound === "string" ? outbound : jsonToHl7(outbound);
//           finalResponse = await sendMLLP(dest.endpoint, hl7);
//           originalResponse = finalResponse;
//         }

//         // ========================================
//         // TRANSPORT: TCP RAW
//         // ========================================
//         else if (dest.type === "TCP") {
//           const raw = typeof outbound === "string" ? outbound : JSON.stringify(outbound);
//           finalResponse = await sendRawTCP(dest.endpoint, raw);
//           originalResponse = finalResponse;
//         }

//         // ========================================
//         // TRANSPORT: FILE
//         // ========================================
//         else if (dest.type === "FILE") {
//           const result = await sendToFile(dest.endpoint, outbound);
//           originalResponse = result;
//           finalResponse = result;
//         }

//         // UNKNOWN TRANSPORT
//         else {
//           throw new Error(`Unknown transport type: ${dest.type}`);
//         }

//         // RESPONSE SCRIPT
//         if (dest.response_script?.trim()) {
//           const ctx = { response: originalResponse, msg: outbound };
//           const result = executeResponseScript(dest.response_script, ctx);
//           finalResponse = result ?? ctx.response;
//         }

//         // SAVE SUCCESS LOG
//         await pool.request().input("message_id", messageId).input("destination_id", dest.id).input("status", "SUCCESS").input("response_text", finalResponse).query(`
//             INSERT INTO MessageDestinationLog (message_id, destination_id, status, response_text)
//             VALUES (@message_id, @destination_id, @status, @response_text)
//           `);

//         logs.push({ destination: dest.name, status: "SUCCESS" });
//       } catch (err) {
//         await pool.request().input("message_id", messageId).input("destination_id", dest.id).input("status", "ERROR").input("response_text", formatError(err)).query(`
//             INSERT INTO MessageDestinationLog (message_id, destination_id, status, response_text)
//             VALUES (@message_id, @destination_id, @status, @response_text)
//           `);

//         logs.push({ destination: dest.name, status: "ERROR", error: formatError(err) });
//       }
//     }

//     await pool.request().input("message_id", messageId).query(`UPDATE Messages SET status='SENT', updated_at=GETDATE() WHERE id=@message_id`);

//     res.json({ message: "Payload sent to all destinations", results: logs });
//   } catch (err) {
//     res.status(500).json({ message: "Internal error", error: formatError(err) });
//   }
// };

/* =======================================================================
   GET DESTINATION LOG BY MESSAGE ID
======================================================================= */
export const getDestinationLog = async (req: Request, res: Response) => {
  const { messageId } = req.params;

  const JSON_SAFE = (val: any) => {
    if (!val) return null;
    try {
      return typeof val === "string" ? JSON.parse(val) : val;
    } catch {
      return val;
    }
  };

  try {
    const pool = await getConnection();

    const result = await pool.request().input("message_id", messageId).query(`
        SELECT mdl.*, d.name AS destination_name
        FROM MessageDestinationLog mdl
        JOIN Destinations d ON mdl.destination_id = d.id
        WHERE mdl.message_id = @message_id
        ORDER BY mdl.sent_at DESC
      `);

    const normalized = result.recordset.map((row) => ({
      destinationName: row.destination_name,
      status: row.status,
      responseText: row.response_text,
      sentAt: row.sent_at,

      requestData: JSON_SAFE(row.request_data),
      outboundData: JSON_SAFE(row.outbound_data),
    }));

    res.json(normalized);
  } catch (err) {
    res.status(500).json({ message: "Error fetching logs", error: formatError(err) });
  }
};
