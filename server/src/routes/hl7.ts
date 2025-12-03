import express from "express";
import { parseHL7ToTree } from "../services/hl7Parser.service.js";

const router = express.Router();

router.post("/parse", (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "HL7 message required" });
  }

  try {
    const tree = parseHL7ToTree(message);
    return res.json(tree);
  } catch (err) {
    return res.status(500).json({ error: "Parsing failed" });
  }
});

export default router;
