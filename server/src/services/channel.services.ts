import { Request, Response } from "express";
import { getConnection } from "../config/db.js";
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.BASE_URL || "http://localhost:9000";
const INBOUND_BASE = process.env.INBOUND_BASE || "/api/message/inbound/";
const DEFAULT_HL7_PORT = process.env.HL7_PORT || "2575";

/* =========================================================
   GET ALL CHANNELS
   ========================================================= */
/* =========================================================
   GET ALL CHANNELS (FINAL FIXED VERSION)
   ========================================================= */
export const getAllChannels = async (req: Request, res: Response) => {
  try {
    const pool = await getConnection();

    /* =========================================================
       1) Ambil data channel + total RECEIVED (IN) + total OUTBOUND
    ========================================================= */
    const channelQuery = await pool.request().query(`
      SELECT 
        c.id,
        c.name,
        c.status,
        c.source_type,
        c.source_endpoint,
        c.inbound_data_type,
        c.processing_script,
        c.response_script,
        c.created_at,
        c.updated_at,

        -- TOTAL RECEIVED (inbound)
        ISNULL(SUM(CASE WHEN m.direction = 'IN' THEN 1 ELSE 0 END), 0) AS received,

        -- TOTAL OUTBOUND (semua OUT, sent+error)
        ISNULL(SUM(CASE WHEN m.direction = 'OUT' THEN 1 ELSE 0 END), 0) AS sent,

        -- TOTAL ERROR inbound/outbound
        ISNULL(SUM(CASE WHEN m.status = 'OUT-ERROR' THEN 1 ELSE 0 END), 0) AS errors
        
      FROM Channels c
      LEFT JOIN Messages m ON m.channel_id = c.id
      GROUP BY 
        c.id, c.name, c.status, c.source_type, c.source_endpoint, c.inbound_data_type,
        c.processing_script, c.response_script, c.created_at, c.updated_at
      ORDER BY c.created_at DESC;
    `);

    const channels = channelQuery.recordset;

    /* =========================================================
       2) AMBIL SEMUA DESTINATION + HITUNG SENT/ERROR REALTIME
    ========================================================= */
    for (const ch of channels) {
      const destQuery = await pool.request().input("channel_id", ch.id).query(`
        SELECT 
            d.id,
            d.channel_id,
            d.name,
            d.type,
            d.endpoint,
            d.outbound_data_type,
            d.processing_script,
            d.response_script,
            d.template_script,
            ISNULL(d.is_enabled, 1) AS is_enabled,

            -- 🔥 HITUNG SENT REALTIME (OUT-SENT)
            (
                SELECT COUNT(*)
                FROM Messages m
                JOIN MessageDestinationLog mdl ON mdl.message_id = m.id
                WHERE mdl.destination_id = d.id
                  AND m.direction = 'OUT'
                  AND m.status = 'OUT-SENT'
            ) AS sent,

            -- 🔥 HITUNG ERROR REALTIME (OUT-ERROR)
            (
                SELECT COUNT(*)
                FROM Messages m
                JOIN MessageDestinationLog mdl ON mdl.message_id = m.id
                WHERE mdl.destination_id = d.id
                  AND m.direction = 'OUT'
                  AND m.status = 'OUT-ERROR'
            ) AS errors

        FROM Destinations d
        WHERE d.channel_id = @channel_id
        ORDER BY d.id ASC;
      `);

      /* =========================================================
         3) Mapping destinasi untuk frontend
      ========================================================= */
      const destinations = destQuery.recordset.map((d) => ({
        id: d.id,
        channel_id: d.channel_id,
        name: d.name,
        type: d.type,
        endpoint: d.endpoint,
        outboundDataType: d.outbound_data_type,
        sent: d.sent, // ✔ FIXED
        errors: d.errors, // ✔ FIXED
        isEnabled: d.is_enabled,
        processingScript: d.processing_script || "",
        responseScript: d.response_script || "",
        templateScript: d.template_script || "",
      }));

      /* =========================================================
         4) Finalize channel object for frontend
      ========================================================= */
      ch.source = {
        type: ch.source_type,
        endpoint: ch.source_endpoint,
        inboundDataType: ch.inbound_data_type,
      };

      ch.processingScript = ch.processing_script;
      ch.responseScript = ch.response_script;
      ch.destinations = destinations;

      delete ch.source_type;
      delete ch.source_endpoint;
      delete ch.inbound_data_type;
      delete ch.processing_script;
      delete ch.response_script;
    }

    /* =========================================================
       RETURN RESULT
    ========================================================= */
    res.json(channels);
  } catch (err: any) {
    res.status(500).json({
      message: "Failed to fetch channels",
      error: err?.message || err,
    });
  }
};

/* =========================================================
   CREATE CHANNEL
   ========================================================= */
export const createChannel = async (req: Request, res: Response) => {
  const { name, source, destinations, processingScript, responseScript } = req.body;

  try {
    const pool = await getConnection();

    // Insert channel with temporary endpoint
    const insertChannel = await pool
      .request()
      .input("name", name)
      .input("status", "STOPPED")
      .input("source_type", source.type)
      .input("source_endpoint", "") // filled after insert
      .input("inbound_data_type", source.inboundDataType || "HL7V2")
      .input("processing_script", processingScript || "")
      .input("response_script", responseScript || "").query(`
        INSERT INTO Channels 
          (name, status, source_type, source_endpoint, inbound_data_type, 
           processing_script, response_script, created_at, updated_at)
        OUTPUT INSERTED.id AS newId
        VALUES (@name, @status, @source_type, @source_endpoint,
                @inbound_data_type, @processing_script, @response_script,
                GETDATE(), GETDATE());
      `);

    const newChannelId = insertChannel.recordset[0].newId;

    let finalEndpoint = "";

    // AUTO ENDPOINT LOGIC
    if (source.type === "HTTP") {
      finalEndpoint = `${BASE_URL}${INBOUND_BASE}${newChannelId}`;
    } else if (source.type === "HL7") {
      finalEndpoint = `tcp://0.0.0.0:${DEFAULT_HL7_PORT}`;
    }

    // Save endpoint
    await pool.request().input("id", newChannelId).input("source_endpoint", finalEndpoint).query(`
      UPDATE Channels 
      SET source_endpoint = @source_endpoint 
      WHERE id = @id;
    `);

    // Insert destinations
    for (const dest of destinations) {
      await pool
        .request()
        .input("channel_id", newChannelId)
        .input("name", dest.name)
        .input("type", dest.type)
        .input("endpoint", dest.endpoint || "")
        .input("outbound_data_type", dest.outboundDataType || "HL7V2")
        .input("processing_script", dest.processingScript || "")
        .input("response_script", dest.responseScript || "")
        .input("template_script", dest.templateScript || "").query(`
          INSERT INTO Destinations 
            (channel_id, name, type, endpoint, outbound_data_type,
             processing_script, response_script, template_script,
             created_at, updated_at)
          VALUES 
            (@channel_id, @name, @type, @endpoint, @outbound_data_type,
             @processing_script, @response_script, @template_script,
             GETDATE(), GETDATE());
        `);
    }

    res.json({
      message: "Channel created successfully",
      channelId: newChannelId,
      endpoint: finalEndpoint,
    });
  } catch (err: any) {
    res.status(500).json({
      message: "Failed to create channel",
      error: err?.message,
    });
  }
};

/* =========================================================
   UPDATE CHANNEL (FINAL FIXED VERSION WITH DEST DELETE)
   ========================================================= */
export const updateChannel = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, source, destinations, processingScript, responseScript } = req.body;

  try {
    const pool = await getConnection();

    let newEndpoint = "";

    if (source.type === "HTTP") {
      newEndpoint = `${BASE_URL}${INBOUND_BASE}${id}`;
    } else if (source.type === "HL7") {
      newEndpoint = `MLLP:${DEFAULT_HL7_PORT}`;
    }

    /* =========================================================
       1) UPDATE CHANNEL
    ========================================================= */
    await pool
      .request()
      .input("id", id)
      .input("name", name)
      .input("source_type", source.type)
      .input("source_endpoint", newEndpoint)
      .input("inbound_data_type", source.inboundDataType || "HL7V2")
      .input("processing_script", processingScript || "")
      .input("response_script", responseScript || "").query(`
        UPDATE Channels
        SET 
          name = @name,
          source_type = @source_type,
          source_endpoint = @source_endpoint,
          inbound_data_type = @inbound_data_type,
          processing_script = @processing_script,
          response_script = @response_script,
          updated_at = GETDATE()
        WHERE id = @id;
      `);

    /* =========================================================
       2) AMBIL DESTINATION LAMA
    ========================================================= */
    const existingDests = (
      await pool.request().input("channel_id", id).query(`
        SELECT id, name 
        FROM Destinations 
        WHERE channel_id = @channel_id;
      `)
    ).recordset;

    /* =========================================================
       3) DELETE DESTINATION YANG SUDAH DIHAPUS DI UI
    ========================================================= */
    const incomingIds = destinations.filter((d) => d.id).map((d) => d.id);

    const toDelete = existingDests.filter((old) => !incomingIds.includes(old.id));

    for (const del of toDelete) {
      // DELETE LOG
      await pool.request().input("destination_id", del.id).query(`DELETE FROM MessageDestinationLog WHERE destination_id=@destination_id`);

      // DELETE DESTINATION
      await pool.request().input("id", del.id).query(`DELETE FROM Destinations WHERE id=@id`);
    }

    /* =========================================================
       4) INSERT / UPDATE DESTINATION
    ========================================================= */
    for (const dest of destinations) {
      const existing = existingDests.find((d) => d.id === dest.id);

      if (existing) {
        // UPDATE
        await pool
          .request()
          .input("id", existing.id)
          .input("endpoint", dest.endpoint)
          .input("type", dest.type)
          .input("outbound_data_type", dest.outboundDataType || "HL7V2")
          .input("processing_script", dest.processingScript || "")
          .input("response_script", dest.responseScript || "")
          .input("template_script", dest.templateScript || "").query(`
            UPDATE Destinations
            SET 
              endpoint = @endpoint,
              type = @type,
              outbound_data_type = @outbound_data_type,
              processing_script = @processing_script,
              response_script = @response_script,
              template_script = @template_script,
              updated_at = GETDATE()
            WHERE id = @id;
          `);
      } else {
        // INSERT BARU
        await pool
          .request()
          .input("channel_id", id)
          .input("name", dest.name)
          .input("type", dest.type)
          .input("endpoint", dest.endpoint)
          .input("outbound_data_type", dest.outboundDataType || "HL7V2")
          .input("processing_script", dest.processingScript || "")
          .input("response_script", dest.responseScript || "")
          .input("template_script", dest.templateScript || "").query(`
            INSERT INTO Destinations 
              (channel_id, name, type, endpoint, outbound_data_type,
               processing_script, response_script, template_script,
               created_at, updated_at)
            VALUES 
              (@channel_id, @name, @type, @endpoint, @outbound_data_type,
               @processing_script, @response_script, @template_script,
               GETDATE(), GETDATE());
          `);
      }
    }

    res.json({
      message: "Channel updated successfully",
      endpoint: newEndpoint,
    });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to update channel", error: err?.message });
  }
};

/* =========================================================
   DELETE CHANNEL
   ========================================================= */
export const deleteChannel = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const pool = await getConnection();
    const transaction = pool.transaction();

    await transaction.begin();

    const destRes = await transaction.request().input("channel_id", id).query(`SELECT id FROM Destinations WHERE channel_id = @channel_id;`);

    const destinationIds = destRes.recordset.map((d) => d.id);

    // Delete log first
    for (const destId of destinationIds) {
      await transaction.request().input("destination_id", destId).query(`DELETE FROM MessageDestinationLog WHERE destination_id = @destination_id;`);
    }

    await transaction.request().input("channel_id", id).query(`DELETE FROM Messages WHERE channel_id = @channel_id;`);

    await transaction.request().input("channel_id", id).query(`DELETE FROM Destinations WHERE channel_id = @channel_id;`);

    await transaction.request().input("id", id).query(`DELETE FROM Channels WHERE id = @id;`);

    await transaction.commit();

    res.json({ message: "Channel deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete channel", error: String(err) });
  }
};

/* =========================================================
   UPDATE CHANNEL STATUS
   ========================================================= */
export const updateChannelStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const pool = await getConnection();
    const validStatuses = ["RUNNING", "STOPPED", "ERROR"];

    const newStatus = (status || "").toUpperCase();

    if (!validStatuses.includes(newStatus)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    await pool.request().input("id", id).input("status", newStatus).query(`UPDATE Channels SET status=@status, updated_at=GETDATE() WHERE id=@id;`);

    res.json({ message: `Channel ${id} status updated to ${newStatus}` });
  } catch (err) {
    res.status(500).json({ message: "Failed to update channel status" });
  }
};
