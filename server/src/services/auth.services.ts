import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { getConnection } from "../config/db.js";

export const AuthService = {
  async register(username: string, password: string, name: string, role: string = "user") {
    const pool = await getConnection();

    // cek username sudah ada atau belum
    const existing = await pool.request().input("username", username).query("SELECT id FROM Users WHERE username = @username");

    if (existing.recordset.length > 0) {
      throw new Error("Username already exists");
    }

    // hash password
    const saltRounds = 10;
    const hashed = await bcrypt.hash(password, saltRounds);

    // insert user baru
    const insertResult = await pool.request().input("username", username).input("password_hash", hashed).input("name", name).input("role", role).query(`
        INSERT INTO Users (username, password_hash, name, role)
        OUTPUT INSERTED.id
        VALUES (@username, @password_hash, @name, @role)
      `);

    const userId = insertResult.recordset[0].id;

    // buat token untuk user baru
    const secretKey = process.env.JWT_SECRET ?? "default_secret";
    const expiresIn = (process.env.JWT_EXPIRES_IN ?? "1d") as jwt.SignOptions["expiresIn"];

    const token = jwt.sign({ id: userId, name, role }, secretKey, { expiresIn });

    return { id: userId, token };
  },

  // login tetap sama
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

//note :

// transform(msg)

// prepare(msg)

// handleResponse(msg)
