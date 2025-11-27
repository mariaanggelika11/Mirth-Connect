import { Request, Response } from "express";
import { getConnection } from "../config/db.js";
import { processInboundMessage } from "./messageProcessor.services.js";
import { resendMessage as engineResend } from "./messageProcessor.services.js";

/* ==========================================================
   HANDLE INBOUND MESSAGE
========================================================== */
export const handleInboundMessage = async (req: Request, res: Response) => {
  const { channelId } = req.params;
  const contentType = req.headers["content-type"] || "";
  let payload: any = req.body;

  let dataType: "HL7V2" | "JSON" | "UNKNOWN" = "UNKNOWN";

  try {
    // Detect data type
    if (contentType.includes("application/json")) {
      payload = typeof payload === "string" ? JSON.parse(payload) : payload;
      dataType = "JSON";
    } else if (contentType.includes("hl7") || contentType.includes("text/plain") || typeof payload === "string") {
      dataType = "HL7V2";
    }

    const pool = await getConnection();

    // Validate channel
    const channel = (
      await pool.request().input("id", channelId).query(`
        SELECT id, name, status FROM Channels WHERE id=@id
      `)
    ).recordset[0];

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: `Channel ${channelId} not found`,
      });
    }

    if (channel.status?.toUpperCase() !== "RUNNING") {
      return res.status(400).json({
        success: false,
        message: `Channel ${channelId} is currently ${channel.status}`,
      });
    }

    // Process message
    const result = await processInboundMessage(Number(channelId), payload);

    return res.json({
      success: true,
      message: "Message processed successfully",
      dataType,
      result,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to process message",
      errorType: err.name,
      errorMessage: err.message,
      dataType,
    });
  }
};

/* ==========================================================
   GET ALL MESSAGES (INBOUND + DESTINATION LOGS)
========================================================== */
export const getMessages = async (req: Request, res: Response) => {
  const channelId = req.query.channelId ? Number(req.query.channelId) : null;

  try {
    const pool = await getConnection();

    // Fetch all messages
    const rawMessages = (
      await pool.request().input("channel_id", channelId).query(`
        SELECT m.*, c.name AS channel_name
        FROM Messages m
        LEFT JOIN Channels c ON m.channel_id = c.id
        WHERE (@channel_id IS NULL OR m.channel_id = @channel_id)
        ORDER BY m.created_at DESC
      `)
    ).recordset;

    // Fetch destination logs
    const rawLogs = (
      await pool.request().query(`
        SELECT mdl.*, d.name AS destination_name
        FROM MessageDestinationLog mdl
        LEFT JOIN Destinations d ON d.id = mdl.destination_id
      `)
    ).recordset;

    // Group logs by outbound message ID
    const logsByMessage: Record<number, any[]> = {};

    rawLogs.forEach((log) => {
      if (!logsByMessage[log.message_id]) logsByMessage[log.message_id] = [];
      logsByMessage[log.message_id].push({
        destinationName: log.destination_name,
        status: log.status,
        requestData: safeJson(log.request_data),
        outboundData: safeJson(log.outbound_data),
        responseText: log.response_text,
        sentAt: log.sent_at,
      });
    });

    const result: any[] = [];

    // Only inbound messages
    const inboundMessages = rawMessages.filter((m) => m.direction === "IN");

    for (const msg of inboundMessages) {
      const outboundMessages = rawMessages.filter((m) => m.direction === "OUT" && m.inbound_message_id === msg.id);

      const mergedLogs = outboundMessages.flatMap((o) => logsByMessage[o.id] || []);

      result.push({
        id: msg.id,
        timestamp: msg.created_at,
        direction: "IN",
        status: msg.status,
        level: "INFO",

        channelId: msg.channel_id,
        channelName: msg.channel_name,

        originalPayload: safeJson(msg.original_payload),
        transformedPayload: safeJson(msg.transformed_payload),

        destinationLogs: mergedLogs,
      });
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch messages",
      error: err.message,
    });
  }
};

function safeJson(v: any) {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/* ==========================================================
   GET MESSAGE STATS
========================================================== */
export const getMessageStats = async (_: Request, res: Response) => {
  try {
    const pool = await getConnection();
    const result = await pool.request().query(`
      SELECT 
        COUNT(*) AS totalMessages,
        SUM(CASE WHEN direction='IN' THEN 1 ELSE 0 END) AS totalReceived,
        SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END) AS totalSent,
        SUM(CASE WHEN status IN ('IN-ERROR','OUT-ERROR') THEN 1 ELSE 0 END) AS totalErrors
      FROM Messages
    `);

    return res.json(result.recordset[0]);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch stats",
      error: err.message,
    });
  }
};

/* ==========================================================
   RESEND OUTBOUND MESSAGE
========================================================== */
export const resendMessage = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const messageId = Number(id);
    if (isNaN(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID",
      });
    }

    const pool = await getConnection();

    const msg = (
      await pool.request().input("id", messageId).query(`
          SELECT direction, status
          FROM Messages 
          WHERE id=@id
        `)
    ).recordset[0];

    if (!msg)
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });

    if (msg.direction !== "OUT")
      return res.status(400).json({
        success: false,
        message: "Only outbound messages can be resent",
      });

    if (msg.status !== "OUT-ERROR")
      return res.status(400).json({
        success: false,
        message: "Only OUT-ERROR messages can be resent",
      });

    const result = await engineResend(messageId);

    return res.json({
      success: true,
      message: "Message resent successfully",
      result,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to resend message",
      error: err.message,
    });
  }
};
