import net from "net";

// MLLP framing constants
const START_BLOCK = "\x0b";
const END_BLOCK = "\x1c";
const CARRIAGE_RETURN = "\x0d";

// Valid HL7 message
const HL7_MESSAGE = "MSH|^~\\&|TEST|LAB|HOSP|HIS|202402021200||ADT^A01|MSG00001|P|2.3\r" + "PID|1||12345||DOE^JOHN\r";

// Frame with MLLP
const framed = START_BLOCK + HL7_MESSAGE + END_BLOCK + CARRIAGE_RETURN;

// Create TCP socket
const client = new net.Socket();

client.connect(2575, "localhost", () => {
  console.log("Connected to MLLP listener");
  console.log("Sending HL7 Message:\n", HL7_MESSAGE);
  client.write(framed);
});

client.on("data", (data) => {
  console.log("\nACK received:");
  console.log(data.toString());
  client.destroy(); // Close connection after ACK
});

client.on("close", () => {
  console.log("Connection closed");
});

client.on("error", (err) => {
  console.error("Socket error:", err);
});
