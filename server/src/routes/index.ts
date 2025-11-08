import { Router } from "express";
import authRoutes from "./auth.routes.js";

const router = Router();

// API utama
router.use("/auth", authRoutes);

export default router;
