import { Request, Response } from "express";
import { getConnection } from "../config/db.js";
import { processInboundMessage } from "./messageProcessor.services.js";
import { VM } from "vm2";

export const handleInboundMessage = async (req: Request, res: Response) => {
  const { channelId } = req.params;
  const payload = req.body;

  try {
    const pool = await getConnection();

    // 1️ Ambil konfigurasi channel dari database (termasuk status)
    const channelQuery = await pool.request().input("id", channelId).query(`
      SELECT id, status, processing_script, response_script
      FROM Channels
      WHERE id = @id
    `);

    const channel = channelQuery.recordset[0];
    if (!channel) {
      return res.status(404).json({ message: `Channel ${channelId} not found` });
    }

    // 2️ Jika status bukan RUNNING, hentikan eksekusi
    if (channel.status?.toUpperCase() !== "RUNNING") {
      console.warn(`Channel ${channelId} is ${channel.status}, skipping message.`);
      return res.status(400).json({
        message: `Channel ${channelId} is currently ${channel.status}. Processing is disabled.`,
      });
    }

    // 3️ Jalankan Processing Script jika tersedia
    let processedPayload = payload;
    if (channel.processing_script && channel.processing_script.trim() !== "") {
      try {
        const sandbox = { msg: payload };
        const vm = new VM({ sandbox, timeout: 2000 });
        processedPayload = vm.run(`${channel.processing_script}; transform(msg);`);
        console.log(`Processing Script executed for Channel ${channelId}`);
      } catch (err) {
        console.error(`Error in Processing Script Channel ${channelId}:`, err);
        processedPayload = payload; // fallback jika error
      }
    }

    // 4️ Jalankan proses utama (simpan message dan kirim ke destinasi)
    const result = await processInboundMessage(Number(channelId), processedPayload);

    // 5️ Jalankan Response Script jika tersedia
    if (channel.response_script && channel.response_script.trim() !== "") {
      try {
        const sandbox = { msg: processedPayload, result };
        const vm = new VM({ sandbox, timeout: 2000 });
        const responseData = vm.run(`${channel.response_script}; respond(msg, result);`);
        console.log(`Response Script executed for Channel ${channelId}`);
        return res.json(responseData);
      } catch (err) {
        console.error(`Error in Response Script Channel ${channelId}:`, err);
        return res.json({
          message: "Message processed successfully (response script failed)",
          result,
        });
      }
    }

    // 6️ Jika tidak ada response_script, kirim default response
    return res.json({
      message: "Message processed successfully",
      result,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error("Failed to process message:", err.message);
      res.status(500).json({ message: err.message });
    } else {
      console.error("Unknown error:", err);
      res.status(500).json({ message: "Failed to process message" });
    }
  }
};

/**
 * GET /api/message?channelId=4
 * Mengambil daftar message log dari tabel Messages (optional filter by channel)
 */
export const getMessages = async (req: Request, res: Response) => {
  const { channelId } = req.query;

  try {
    const pool = await getConnection();
    const result = await pool.request().input("channel_id", channelId || null).query(`
        SELECT 
          m.id,
          m.channel_id,
          c.name AS channel_name,
          m.direction,
          m.message_type,
          m.original_payload,
          m.transformed_payload,
          m.status,
          m.error_detail,
          m.created_at
        FROM Messages m
        LEFT JOIN Channels c ON m.channel_id = c.id
        WHERE (@channel_id IS NULL OR m.channel_id = @channel_id)
        ORDER BY m.created_at DESC
      `);

    res.json(result.recordset);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error("Error fetching messages:", err.message);
      res.status(500).json({ message: err.message });
    } else {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  }
};

/**
 * GET /api/message/stats
 * Menghitung total message sent/received/error untuk monitor dashboard
 */
export const getMessageStats = async (_: Request, res: Response) => {
  try {
    const pool = await getConnection();

    const result = await pool.request().query(`
      SELECT 
        COUNT(*) AS totalMessages,
        SUM(CASE WHEN direction = 'IN' THEN 1 ELSE 0 END) AS totalReceived,
        SUM(CASE WHEN direction = 'OUT' THEN 1 ELSE 0 END) AS totalSent,
        SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) AS totalErrors
      FROM Messages
    `);

    res.json(result.recordset[0]);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(" Error fetching message stats:", err.message);
      res.status(500).json({ message: err.message });
    } else {
      res.status(500).json({ message: "Failed to fetch message stats" });
    }
  }
};
