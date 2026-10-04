import express from "express";

const app = express();
app.use(express.json());
app.use(express.text());

app.post("/api/inbound/2", (req, res) => {
  console.log(JSON.stringify({event:"TEST_MESSAGE_RECEIVED",timestamp:new Date().toISOString()}));

  res.json({
    status: "SIP MANTAP",

  });
});

app.listen(Number(process.env.TEST_RECEIVER_PORT || 9200), "127.0.0.1", () => console.log("Dummy REST Receiver on port 9200"));
