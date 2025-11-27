import { Request, Response } from "express";
import { getConnection } from "../config/db.js";

/* =========================================================
   GET ALL CHANNELS
   ========================================================= */
export const getAllChannels = async (req: Request, res: Response) => {
  try {
    const pool = await getConnection();

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
        ISNULL(SUM(CASE WHEN m.direction IN ('IN','INBOUND') THEN 1 ELSE 0 END),0) AS received,
        ISNULL(SUM(CASE WHEN m.direction IN ('OUT','OUTBOUND') THEN 1 ELSE 0 END),0) AS sent,
        ISNULL(SUM(CASE WHEN UPPER(m.status)='ERROR' THEN 1 ELSE 0 END),0) AS errors
      FROM Channels c
      LEFT JOIN Messages m ON m.channel_id = c.id
      GROUP BY 
        c.id, c.name, c.status, c.source_type, c.source_endpoint, c.inbound_data_type,
        c.processing_script, c.response_script, c.created_at, c.updated_at
      ORDER BY c.created_at DESC;
    `);

    const channels = channelQuery.recordset;

    for (const ch of channels) {
      const destQuery = await pool.request().input("channel_id", ch.id).query(`
        SELECT 
          id,
          channel_id,
          name,
          type,
          endpoint,
          outbound_data_type,
          processing_script,
          response_script,
          template_script,
          ISNULL(total_sent,0) AS total_sent,
          ISNULL(total_error,0) AS total_error,
          ISNULL(is_enabled,1) AS is_enabled
        FROM Destinations
        WHERE channel_id = @channel_id
        ORDER BY id ASC;
      `);

      const destinations = destQuery.recordset.map((d) => ({
        id: d.id,
        channel_id: d.channel_id,
        name: d.name,
        type: d.type,
        endpoint: d.endpoint,
        outboundDataType: d.outbound_data_type,
        sent: d.total_sent,
        errors: d.total_error,
        isEnabled: d.is_enabled,
        processingScript: d.processing_script || "",
        responseScript: d.response_script || "",
        templateScript: d.template_script || "",
      }));

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

    res.json(channels);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch channels", error: err?.message || err });
  }
};

/* =========================================================
   CREATE CHANNEL
   ========================================================= */
export const createChannel = async (req: Request, res: Response) => {
  const { name, source, destinations, processingScript, responseScript } = req.body;

  try {
    const pool = await getConnection();

    const insertChannel = await pool
      .request()
      .input("name", name)
      .input("status", "Stopped")
      .input("source_type", source.type)
      .input("source_endpoint", source.endpoint)
      .input("inbound_data_type", source.inboundDataType || "HL7V2")
      .input("processing_script", processingScript || "")
      .input("response_script", responseScript || "").query(`
        INSERT INTO Channels 
          (name, status, source_type, source_endpoint, inbound_data_type, processing_script, response_script, created_at, updated_at)
        OUTPUT INSERTED.id AS newId
        VALUES (@name, @status, @source_type, @source_endpoint, @inbound_data_type, @processing_script, @response_script, GETDATE(), GETDATE());
      `);

    const newChannelId = insertChannel.recordset[0].newId;

    for (const dest of destinations) {
      await pool
        .request()
        .input("channel_id", newChannelId)
        .input("name", dest.name)
        .input("type", dest.type)
        .input("endpoint", dest.endpoint)
        .input("outbound_data_type", dest.outboundDataType || "HL7V2")
        .input("processing_script", dest.processingScript || "")
        .input("response_script", dest.responseScript || "")
        .input("template_script", dest.templateScript || "").query(`
          INSERT INTO Destinations 
            (channel_id, name, type, endpoint, outbound_data_type, processing_script, response_script, template_script, created_at, updated_at)
          VALUES 
            (@channel_id, @name, @type, @endpoint, @outbound_data_type, @processing_script, @response_script, @template_script, GETDATE(), GETDATE());
        `);
    }

    res.json({ message: "Channel created successfully", channelId: newChannelId });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to create channel", error: err?.message });
  }
};

/* =========================================================
   UPDATE CHANNEL
   ========================================================= */
export const updateChannel = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, source, destinations, processingScript, responseScript } = req.body;

  try {
    const pool = await getConnection();

    await pool
      .request()
      .input("id", id)
      .input("name", name)
      .input("source_type", source.type)
      .input("source_endpoint", source.endpoint)
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

    const existingDests = (
      await pool.request().input("channel_id", id).query(`
        SELECT id, name FROM Destinations WHERE channel_id = @channel_id;
      `)
    ).recordset;

    for (const dest of destinations) {
      const existing = existingDests.find((d) => d.name === dest.name);

      if (existing) {
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
              (channel_id, name, type, endpoint, outbound_data_type, processing_script, response_script, template_script, created_at, updated_at)
            VALUES 
              (@channel_id, @name, @type, @endpoint, @outbound_data_type, @processing_script, @response_script, @template_script, GETDATE(), GETDATE());
          `);
      }
    }

    res.json({ message: "Channel updated successfully" });
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
