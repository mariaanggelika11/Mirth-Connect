import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { getConnection } from "../config/db.js";

export const AuthService = {
  async login(username: string, password: string) {
    const pool = await getConnection();
    const result = await pool.request().input("username", username).query("SELECT * FROM Users WHERE username = @username");

    const userData = result.recordset[0];
    if (!userData) throw new Error("Invalid credentials");

    const isValidPassword = await bcrypt.compare(password, userData.password_hash);
    if (!isValidPassword) throw new Error("Invalid credentials");

    const secretKey = process.env.JWT_SECRET ?? "default_secret";
    const expiresIn = (process.env.JWT_EXPIRES_IN ?? "1d") as jwt.SignOptions["expiresIn"];

    const token = jwt.sign({ id: userData.id, name: userData.name, role: userData.role }, secretKey, { expiresIn });

    return { token };
  },
};
