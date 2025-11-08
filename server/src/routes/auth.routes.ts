import { Router } from "express";
import { AuthService } from "../services/auth.services.js";
import { successResponse, errorResponse } from "../utils/response.js";

const router = Router();

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await AuthService.login(username, password);
    return successResponse(res, result, "Login successful");
  } catch (error: any) {
    return errorResponse(res, error.message, 401);
  }
});

export default router;
