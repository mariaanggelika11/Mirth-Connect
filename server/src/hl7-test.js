import net from "net";

// HL7 message (gunakan MLLP framing: \x0b = <VT>, \x1c = <FS>, \x0d = <CR>)
const hl7 = "\x0b" + "MSH|^~\\&|HIS|HOSP|LAB|HOSP|202511031430||ADT^A01|1234|P|2.3\r" + "PID|1||P001||DOE^JOHN||19800101|M\r" + "\x1c\r";

const client = new net.Socket();

client.connect(2575, "127.0.0.1", () => {
  console.log(" Connected to HL7 Listener");
  client.write(hl7);
  console.log(" HL7 message sent");
});

client.on("data", (data) => {
  console.log(" Received ACK:", data.toString());
  client.destroy();
});

client.on("error", (err) => {
  console.error(" Connection error:", err);
});

client.on("close", () => {
  console.log(" Connection closed");
});
