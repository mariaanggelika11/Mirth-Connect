// 🔹 Load environment variables
import dotenv from "dotenv";
dotenv.config();

// 🔹 Import app express
import app from "./app.js";

const PORT = process.env.PORT || 9000;

app.listen(PORT, () => {
  console.log(`Monolith running on http://localhost:${PORT}`);
});
