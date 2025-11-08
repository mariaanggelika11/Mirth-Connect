import express from "express";
const app = express();
app.use(express.json());

app.post("/api/inbound/1", (req, res) => {
  console.log("📩 Received message from MiniMirth:");
  console.log(req.body);
  res.status(200).json({
    success: true,
    receivedAt: new Date().toISOString(),
    data: req.body,
  });
});

// Jalankan di port berbeda dari MiniMirth
app.listen(9100, () => {
  console.log("✅ Dummy receiver listening on http://localhost:9100/api/inbound/1");
});
