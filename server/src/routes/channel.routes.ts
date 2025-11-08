import express from "express";
import * as ChannelService from "../services/channel.services.js";
import { updateChannelStatus } from "../services/channel.services.js";
const router = express.Router();

router.get("/", ChannelService.getAllChannels);
router.post("/", ChannelService.createChannel);
router.put("/:id", ChannelService.updateChannel);
router.delete("/:id", ChannelService.deleteChannel);

router.put("/:id/status", updateChannelStatus);
export default router;
``;
