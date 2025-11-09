import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import router from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import channelRoutes from "./routes/channel.routes.js";
import destinationRoutes from "./routes/destination.routes.js";
import messageRoutes from "./routes/message.routes.js";
import { startHl7Listener } from "./services/hl7Listener.services.js";

dotenv.config();
const app = express();

// === Middleware JSON parser (kecuali HL7 inbound) ===
app.use((req, res, next) => {
  // Cek apakah full URL mengandung inbound route
  if (req.originalUrl.includes("/api/message/inbound")) {
    return next(); // lewati express.json()
  }
  express.json()(req, res, next);
});

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());

// === API ROUTES ===
app.use("/api", router);
app.use("/api/channel", channelRoutes);
app.use("/api/destination", destinationRoutes);
app.use("/api/message", messageRoutes);

// === Dummy receiver for testing ===
app.post("/api/test-destination", (req, res) => {
  console.log(" LIS menerima data:", req.body);
  res.json({ received: true });
});

// === FRONTEND BUILD SERVE ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientPath = path.resolve(__dirname, "../public");
app.use(express.static(clientPath));
app.get("*", (_, res) => res.sendFile(path.join(clientPath, "index.html")));

// === ERROR HANDLER (last) ===
app.use(errorHandler);

startHl7Listener();

export default app;
