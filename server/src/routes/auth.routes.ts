import { Router } from "express";
import { AuthService } from "../services/auth.services.js";
import { successResponse, errorResponse } from "../utils/response.js";

const router = Router();

router.post("/register", async (req, res) => {
  try {
    const { username, password, name, role } = req.body;
    const result = await AuthService.register(username, password, name, role);

    return res.status(200).json({
      token: result.token,
    });
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await AuthService.login(username, password);

    return res.status(200).json({
      token: result.token,
    });
  } catch (error: any) {
    return res.status(401).json({ message: error.message });
  }
});

export default router;
