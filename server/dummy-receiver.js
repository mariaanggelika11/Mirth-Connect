import express from "express";
import { getConnection } from "./dist/config/db.js";

// =============================
//  POSTGRESQL CONFIG
// =============================


let pool;

// =============================
//  INIT DB CONNECTION
// =============================
async function connectDB() {
  try {
    pool = await getConnection();
    console.log("✅ PostgreSQL Connected");
  } catch (err) {
    console.error("SQL_CONNECTION_FAILED");
    process.exit(1);
  }
}

await connectDB();

// =============================
//  EXPRESS SERVER
// =============================
const app = express();
app.use(express.json());
app.use(express.text());

// ==================================================
//  GENERIC INBOUND ENDPOINT (MIRTH-LIKE)
// ==================================================
app.post("/api/inbound/1", async (req, res) => {
  try {
    const channelId = Number(req.headers["x-channel-id"]);
    const destinationId = Number(req.headers["x-destination-id"]);

    if (!channelId || !destinationId) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing x-channel-id or x-destination-id header",
      });
    }

    console.log("📥 INBOUND RECEIVED");
    console.log("Channel ID     :", channelId);
    console.log("Destination ID :", destinationId);


    await pool.request().input("channel_id", channelId).input("destination_id", destinationId).input("payload_raw", JSON.stringify(req.body)).query(`
        INSERT INTO "InboundMessages"
          (channel_id, destination_id, payload_raw, received_at)
        VALUES
          (@channel_id, @destination_id, @payload_raw, CURRENT_TIMESTAMP)
      `);

    res.json({
      status: "OK",
      saved: true,
    });
  } catch (err) {
    console.error("DB_INSERT_FAILED");

    res.status(500).json({
      status: "ERROR",
      message: "Failed to store message",
    });
  }
});

// =============================
//  RUN SERVER
// =============================
app.listen(Number(process.env.TEST_RECEIVER_PORT || 9100), "127.0.0.1", () => console.log("🚀 Dummy REST Receiver running on port 9100"));
