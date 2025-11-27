import express from "express";

const app = express();
app.use(express.json());
app.use(express.text());

app.post("/api/inbound/1", (req, res) => {
  console.log("REST RECEIVED PAYLOAD:", req.body);

  res.json({
    status: "OK",
    received: req.body,
  });
});

app.listen(9100, () => console.log("Dummy REST Receiver on port 9100"));
