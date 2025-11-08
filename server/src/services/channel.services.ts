import { Request, Response } from "express";
import { getConnection } from "../config/db.js"; //

// =======================
// GET ALL CHANNELS
// =======================
export const getAllChannels = async (req: Request, res: Response) => {
  try {
    const pool = await getConnection();

    // === Ambil semua channel + agregasi Messages ===
    const channelQuery = await pool.request().query(`
      SELECT 
        c.id,
        c.name,
        c.status,
        c.source_type,
        c.source_endpoint,
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
        c.id, c.name, c.status, c.source_type, c.source_endpoint,
        c.processing_script, c.response_script, c.created_at, c.updated_at
      ORDER BY c.created_at DESC;
    `);

    const channels = channelQuery.recordset;

    // === Ambil destinasi untuk setiap channel ===
    for (const ch of channels) {
      const destQuery = await pool.request().input("channel_id", ch.id).query(`
        SELECT 
          id,
          channel_id,
          name,
          type,
          endpoint,
          processing_script,
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
        sent: d.total_sent, // ✅ ambil dari DB
        errors: d.total_error, // ✅ ambil dari DB
        isEnabled: d.is_enabled,
        processingScript: d.processing_script || "",
      }));

      ch.source = {
        type: ch.source_type,
        endpoint: ch.source_endpoint,
      };

      ch.processingScript = ch.processing_script;
      ch.responseScript = ch.response_script;
      ch.destinations = destinations;

      delete ch.source_type;
      delete ch.source_endpoint;
      delete ch.processing_script;
      delete ch.response_script;
    }

    res.json(channels);
  } catch (err: any) {
    console.error("❌ Error getAllChannels:", err?.message || err);
    res.status(500).json({
      message: "Failed to fetch channels",
      error: err?.message || err,
    });
  }
};
// =======================
// CREATE CHANNEL
// =======================
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
      .input("processing_script", processingScript || "")
      .input("response_script", responseScript || "").query(`
        INSERT INTO Channels 
          (name, status, source_type, source_endpoint, processing_script, response_script)
        OUTPUT INSERTED.id AS newId
        VALUES (@name, @status, @source_type, @source_endpoint, @processing_script, @response_script)
      `);

    const newChannelId = insertChannel.recordset[0].newId;

    // Insert destinations
    for (const dest of destinations) {
      await pool
        .request()
        .input("channel_id", newChannelId)
        .input("name", dest.name)
        .input("type", dest.type)
        .input("endpoint", dest.endpoint)
        .input("processing_script", dest.processingScript || "").query(`
          INSERT INTO Destinations (channel_id, name, type, endpoint, processing_script)
          VALUES (@channel_id, @name, @type, @endpoint, @processing_script)
        `);
    }

    res.json({ message: "Channel created successfully" });
  } catch (err) {
    console.error("Error createChannel:", err);
    res.status(500).json({ message: "Failed to create channel" });
  }
};

// =======================
// UPDATE CHANNEL
// =======================
export const updateChannel = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, source, destinations, processingScript, responseScript } = req.body;

  try {
    const pool = await getConnection();

    // Update info channel
    await pool
      .request()
      .input("id", id)
      .input("name", name)
      .input("source_type", source.type)
      .input("source_endpoint", source.endpoint)
      .input("processing_script", processingScript || "")
      .input("response_script", responseScript || "").query(`
        UPDATE Channels
        SET 
          name = @name,
          source_type = @source_type,
          source_endpoint = @source_endpoint,
          processing_script = @processing_script,
          response_script = @response_script,
          updated_at = GETDATE()
        WHERE id = @id
      `);

    // Ambil destinasi lama
    const existingDests = (
      await pool.request().input("channel_id", id).query(`
        SELECT id, name FROM Destinations WHERE channel_id = @channel_id
      `)
    ).recordset;

    // Update atau insert sesuai kondisi
    for (const dest of destinations) {
      const existing = existingDests.find((d) => d.name === dest.name);

      if (existing) {
        // UPDATE jika sudah ada
        await pool
          .request()
          .input("id", existing.id)
          .input("endpoint", dest.endpoint)
          .input("type", dest.type)
          .input("processing_script", dest.processingScript || "").query(`
            UPDATE Destinations
            SET endpoint = @endpoint, type = @type, processing_script = @processing_script, updated_at = GETDATE()
            WHERE id = @id
          `);
      } else {
        // INSERT jika baru
        await pool
          .request()
          .input("channel_id", id)
          .input("name", dest.name)
          .input("type", dest.type)
          .input("endpoint", dest.endpoint)
          .input("processing_script", dest.processingScript || "").query(`
            INSERT INTO Destinations (channel_id, name, type, endpoint, processing_script)
            VALUES (@channel_id, @name, @type, @endpoint, @processing_script)
          `);
      }
    }

    res.json({ message: "Channel updated successfully" });
  } catch (err) {
    console.error("❌ Error updateChannel:", err);
    res.status(500).json({ message: "Failed to update channel" });
  }
};

// =======================
// DELETE CHANNEL
// =======================
// =======================
// HARD DELETE CHANNEL (CASCADE MANUAL)
// =======================
export const deleteChannel = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const pool = await getConnection();

    // Mulai transaksi biar aman kalau ada error
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // 1️⃣ Ambil semua destination id untuk channel ini
      const destRes = await transaction.request().input("channel_id", id).query(`
          SELECT id FROM Destinations WHERE channel_id = @channel_id
        `);

      const destinationIds = destRes.recordset.map((d) => d.id);

      // 2️⃣ Hapus semua log MessageDestinationLog yang terkait dengan destinasi
      for (const destId of destinationIds) {
        await transaction.request().input("destination_id", destId).query(`
            DELETE FROM MessageDestinationLog WHERE destination_id = @destination_id
          `);
      }

      // 3️⃣ Hapus semua messages milik channel ini
      await transaction.request().input("channel_id", id).query(`
          DELETE FROM Messages WHERE channel_id = @channel_id
        `);

      // 4️⃣ Hapus semua destinations milik channel ini
      await transaction.request().input("channel_id", id).query(`
          DELETE FROM Destinations WHERE channel_id = @channel_id
        `);

      // 5️⃣ Hapus channel-nya sendiri
      await transaction.request().input("id", id).query(`
          DELETE FROM Channels WHERE id = @id
        `);

      // 6️⃣ Commit transaksi
      await transaction.commit();

      res.json({ message: `✅ Channel ${id} and all related data deleted successfully` });
    } catch (innerErr) {
      await transaction.rollback();
      console.error("❌ Rollback deleteChannel:", innerErr);
      res.status(500).json({
        message: "Failed to delete channel (transaction rolled back)",
        error: String(innerErr),
      });
    }
  } catch (err) {
    console.error("❌ Error deleteChannel:", err);
    res.status(500).json({ message: "Failed to delete channel", error: String(err) });
  }
};

// =======================
// UPDATE CHANNEL STATUS (RUN/STOP)
// =======================
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

    await pool.request().input("id", id).input("status", newStatus).query(`
        UPDATE Channels
        SET status = @status, updated_at = GETDATE()
        WHERE id = @id
      `);

    res.json({ message: `Channel ${id} status updated to ${newStatus}` });
  } catch (err) {
    console.error("Error updateChannelStatus:", err);
    res.status(500).json({ message: "Failed to update channel status" });
  }
};
