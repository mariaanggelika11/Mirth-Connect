import { Request, Response } from "express";
import { getConnection } from "../config/db.js";
import axios from "axios";

// =======================
// SEND TO DESTINATIONS
// =======================
export const sendToDestinations = async (req: Request, res: Response) => {
  const { channelId, messageId, payload } = req.body;

  if (!channelId || !payload) {
    return res.status(400).json({ message: "channelId dan payload wajib diisi." });
  }

  try {
    const pool = await getConnection();

    // 1️ Ambil daftar destination aktif
    const result = await pool.request().input("channel_id", channelId).query(`SELECT * FROM Destinations WHERE channel_id = @channel_id AND is_enabled = 1`);

    const destinations = result.recordset;
    if (destinations.length === 0) {
      return res.status(404).json({ message: "Tidak ada destination aktif untuk channel ini." });
    }

    const logs: any[] = [];

    // 2️ Kirim ke setiap destination
    for (const dest of destinations) {
      try {
        const response = await axios.post(dest.endpoint, payload);

        await pool.request().input("message_id", messageId).input("destination_id", dest.id).input("status", "SUCCESS").input("response_text", JSON.stringify(response.data)).query(`
            INSERT INTO MessageDestinationLog (message_id, destination_id, status, response_text)
            VALUES (@message_id, @destination_id, @status, @response_text)
          `);

        await pool.request().input("id", dest.id).query(`UPDATE Destinations SET total_sent = total_sent + 1, last_sent = GETDATE() WHERE id = @id`);

        logs.push({ destination: dest.name, status: "SUCCESS" });
      } catch (err: any) {
        await pool.request().input("message_id", messageId).input("destination_id", dest.id).input("status", "ERROR").input("response_text", err.message).query(`
            INSERT INTO MessageDestinationLog (message_id, destination_id, status, response_text)
            VALUES (@message_id, @destination_id, @status, @response_text)
          `);

        await pool.request().input("id", dest.id).query(`UPDATE Destinations SET total_error = total_error + 1 WHERE id = @id`);

        logs.push({ destination: dest.name, status: "ERROR", error: err.message });
      }
    }

    // 3️ Update status message
    await pool.request().input("message_id", messageId).query(`UPDATE Messages SET status = 'SENT', updated_at = GETDATE() WHERE id = @message_id`);

    return res.json({ message: "Payload sent to all destinations", results: logs });
  } catch (err) {
    console.error("Error sendToDestinations:", err);
    return res.status(500).json({ message: "Internal error", error: String(err) });
  }
};

// =======================
// GET DESTINATION LOG BY MESSAGE ID
// =======================
export const getDestinationLog = async (req: Request, res: Response) => {
  const { messageId } = req.params;

  try {
    const pool = await getConnection();

    const result = await pool.request().input("message_id", messageId).query(`
        SELECT mdl.*, d.name AS destination_name
        FROM MessageDestinationLog mdl
        JOIN Destinations d ON mdl.destination_id = d.id
        WHERE mdl.message_id = @message_id
        ORDER BY mdl.sent_at DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("Error getDestinationLog:", err);
    res.status(500).json({ message: "Error fetching logs", error: err });
  }
};
