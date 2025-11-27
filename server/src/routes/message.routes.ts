import express from "express";
import bodyParser from "body-parser";
import * as messageService from "../services/message.services.js";

const router = express.Router();

// ============================================================
// INBOUND MESSAGE (HL7 / JSON / XML / TEXT)
// ============================================================
router.post(
  "/inbound/:channelId",
  bodyParser.text({
    type: ["text/*", "application/hl7-v2", "x-application/hl7-v2", "application/octet-stream", "*/*"],
  }),
  messageService.handleInboundMessage
);

// ============================================================
// GET MESSAGES
// ============================================================
router.get("/", messageService.getMessages);

// ============================================================
// GET MESSAGE STATS
// ============================================================
router.get("/stats", messageService.getMessageStats);

// ============================================================
// RESEND MESSAGE
// ============================================================
router.post("/resend/:id", messageService.resendMessage);

export default router;
