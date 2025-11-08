import sql from "mssql";
import dotenv from "dotenv";
dotenv.config();

const dbConfig: sql.config = {
  user: process.env.SQL_USER || "",
  password: process.env.SQL_PASSWORD || "",
  server: process.env.SQL_SERVER || "",
  database: process.env.SQL_DATABASE || "",
  port: Number(process.env.SQL_PORT) || 1433,
  options: {
    encrypt: process.env.SQL_ENCRYPT === "true",
    trustServerCertificate: process.env.SQL_TRUST_CERT === "true",
  },
};

export async function getConnection() {
  try {
    const pool = await sql.connect(dbConfig);
    return pool;
  } catch (err) {
    console.error(" SQL Connection Error:", err);
    throw err;
  }
}
