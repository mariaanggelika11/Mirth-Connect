import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { errorHandler } from "./middleware/errorHandler.js";
import { authenticate } from "./middleware/auth.js";
import authRoutes from "./routes/auth.routes.js"; 
import channelRoutes from "./routes/channel.routes.js";
import destinationRoutes from "./routes/destination.routes.js";
import messageRoutes from "./routes/message.routes.js";
import { startHl7Listener } from "./services/hl7Listener.services.js";
import hl7Routes from "./routes/hl7.js";

dotenv.config();
const app = express();

app.use("/api/auth", express.json(), authRoutes);
app.use("/api/channel", authenticate, express.json(), channelRoutes);
app.use("/api/destination", authenticate, express.json(), destinationRoutes);
app.use("/api/message", authenticate, messageRoutes);
app.use("/api/hl7", authenticate, express.json(), hl7Routes);
// === CORS ===
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());

// === FRONTEND BUILD SERVE ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientPath = path.resolve(__dirname, "../public");
app.use(express.static(clientPath));
app.get("*", (_, res) => res.sendFile(path.join(clientPath, "index.html")));

// ERROR HANDLER
app.use(errorHandler);

// START HL7 LISTENER
startHl7Listener();

export default app;
