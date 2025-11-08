import express from "express";
import { sendToDestinations, getDestinationLog } from "../services/destination.services.js";

const router = express.Router();

router.post("/send", sendToDestinations);
router.get("/log/:messageId", getDestinationLog);

export default router;
