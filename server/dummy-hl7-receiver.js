/**
 * ==========================================================
 * 🧩 Dummy HL7 Receiver – Simulasi TCP MLLP Listener (Production Style)
 * ==========================================================
 * Jalankan di: tcp://localhost:2575
 * Meniru sistem HL7 nyata:
 * - Menyimpan log pesan masuk
 * - Mengirim ACK dinamis (AA / AE / AR)
 * ==========================================================
 */

import net from "net";

const HOST = "localhost";
const PORT = 2575;
let messageLogs = [];

console.log(`✅ Dummy HL7 Receiver listening on tcp://${HOST}:${PORT}`);

const server = net.createServer((socket) => {
  console.log("\n📩 [TCP] Incoming HL7 message connection...");
  let rawData = "";

  socket.on("data", (chunk) => {
    const data = chunk.toString();
    rawData += data;

    console.log("🧾 [TCP] Raw HL7 Data:");
    console.log("---------------------------------------");
    console.log(data);
    console.log("---------------------------------------");

    // 🔹 Bersihkan kontrol karakter MLLP
    const cleanMsg = data
      .replace(/\u000b/g, "")
      .replace(/\u001c\r?/g, "")
      .replace(/\r/g, "\n")
      .trim();

    console.log("✅ [TCP] Cleaned HL7 Message:");
    console.log("---------------------------------------");
    console.log(cleanMsg);
    console.log("---------------------------------------");

    // 🔹 Simpan log pesan
    const logEntry = {
      message: cleanMsg,
      receivedAt: new Date().toISOString(),
      ackType: "AA",
    };
    messageLogs.push(logEntry);

    // 🔹 Tentukan ACK secara dinamis
    let msaCode = "AA";
    if (cleanMsg.includes("ERROR")) msaCode = "AE";
    else if (cleanMsg.includes("REJECT")) msaCode = "AR";
    logEntry.ackType = msaCode;

    // 🔹 Kirim ACK
    const ack = [
      "\u000b",
      `MSH|^~\\&|DummyHL7|Receiver|MiniMirth|LOCAL|${new Date().toISOString()}||ACK^A01|${Date.now()}|P|2.3\r`,
      `MSA|${msaCode}|${Date.now()}|${msaCode === "AA" ? "Message accepted" : msaCode === "AE" ? "Application error" : "Application reject"}\r`,
      "\u001c\r",
    ].join("");

    socket.write(ack);
    socket.end();
  });

  socket.on("end", () => console.log("🔚 [TCP] Connection closed\n"));
  socket.on("error", (err) => console.error("❌ [TCP] Socket error:", err.message));
});

server.listen(PORT, HOST, () => {
  console.log("🚀 HL7 Dummy Receiver active and ready for ACK tests!\n");
});
