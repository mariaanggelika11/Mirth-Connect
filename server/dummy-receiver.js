import express from "express";
import sql from "mssql";

// =============================
//  SQL SERVER CONFIG
// =============================
const dbConfig = {
  user: "sa",
  password: "PasswordBaru123",
  database: "EksternalDatabase",
  server: "localhost",
  port: 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

let pool;

// =============================
//  INIT DB CONNECTION
// =============================
async function connectDB() {
  try {
    pool = await sql.connect(dbConfig);
    console.log("✅ SQL Server Connected");
  } catch (err) {
    console.error("❌ SQL Connection Error:", err);
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
    console.log("Payload        :", req.body);

    await pool.request().input("channel_id", channelId).input("destination_id", destinationId).input("payload_raw", JSON.stringify(req.body)).query(`
        INSERT INTO InboundMessages
          (channel_id, destination_id, payload_raw, received_at)
        VALUES
          (@channel_id, @destination_id, @payload_raw, GETDATE())
      `);

    res.json({
      status: "OK",
      saved: true,
    });
  } catch (err) {
    console.error("❌ DB INSERT ERROR:", err);

    res.status(500).json({
      status: "ERROR",
      message: err.message,
    });
  }
});

// =============================
//  RUN SERVER
// =============================
app.listen(9100, () => console.log("🚀 Dummy REST Receiver running on port 9100"));
