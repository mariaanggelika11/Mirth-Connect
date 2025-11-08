import express from "express";
import bodyParser from "body-parser";
import * as messageService from "../services/message.services.js";
import { processInboundMessage } from "../services/messageProcessor.services.js";

const router = express.Router();

/**
 *  Inbound message endpoint
 *  Menerima data HL7 atau JSON dari external system
 *  dan memprosesnya menggunakan engine messageProcessor.
 */

// Gunakan bodyParser.text() agar bisa menerima HL7 (plain text)
router.post(
  "/inbound/:channelId",
  bodyParser.text({ type: "*/*" }), // tambahkan ini!
  async (req, res) => {
    try {
      const { channelId } = req.params;
      const rawBody = req.body;

      console.log("📩 Received inbound message:", rawBody.substring(0, 100));

      // Kirim ke processor
      const result = await processInboundMessage(Number(channelId), rawBody);

      res.json({ success: true, message: "Message processed successfully", result });
    } catch (err) {
      console.error("❌ Error processing message:", err);
      res.status(500).json({ success: false, message: "Failed to process message" });
    }
  }
);

/**
 *  Get all message logs
 *  Menampilkan log dari tabel Messages
 */
router.get("/", messageService.getMessages);

/**
 *  Get message statistics (untuk Dashboard UI)
 */
router.get("/stats", messageService.getMessageStats);

export default router;
