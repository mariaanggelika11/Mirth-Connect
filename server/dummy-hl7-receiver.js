import net from "net";

const PORT = 2575; // sama dengan HL7 listener di Mini-Mirth
const HOST = "localhost";

console.log(` Dummy HL7 TCP Receiver listening on tcp://${HOST}:${PORT}`);

const server = net.createServer((socket) => {
  console.log(" [TCP] Incoming HL7 message connection...");

  let rawData = "";

  socket.on("data", (chunk) => {
    const received = chunk.toString();
    rawData += received;

    // tampilkan semua data mentah (apapun formatnya)
    console.log(" [TCP] Raw data received:");
    console.log("---------------------------------------");
    console.log(received);
    console.log("---------------------------------------");

    // jika pesan mengandung blok HL7, tampilkan juga versi “bersih”
    if (received.includes("MSH|")) {
      const cleanMsg = received
        .replace(/\u000b/g, "")
        .replace(/\u001c\r/g, "")
        .replace(/\r/g, "\n")
        .trim();
      console.log(" [TCP] Cleaned HL7 message:");
      console.log("---------------------------------------");
      console.log(cleanMsg);
      console.log("---------------------------------------");
    }

    // kirim ACK standar HL7 (selalu kirim agar Mini-Mirth tidak hang)
    const ack = "\u000bMSH|^~\\&|DummyHL7|Receiver|MiniMirth|LOCAL|" + new Date().toISOString() + "||ACK^A01|1|P|2.3\rMSA|AA|1\r\u001c\r";
    socket.write(ack);
  });

  socket.on("end", () => {
    console.log(" [TCP] Connection closed\n");
  });

  socket.on("error", (err) => {
    console.error(" [TCP] Socket error:", err.message);
  });
});

server.listen(PORT, HOST, () => {
  console.log(" HL7 Dummy Receiver is now active.\n");
});
