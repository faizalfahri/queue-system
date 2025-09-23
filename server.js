const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const { print } = require("pdf-to-printer");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const counters = [
  { name: "a", desc: "Pendaftaran" },
  { name: "b", desc: "Teller" },
  { name: "c", desc: "Customer Service" },
  { name: "d", desc: "Pembayaran" },
];
let runningQueue = {};
let noToken = {};
counters.forEach((counter) => {
  runningQueue[counter.name] = [];
  noToken[counter.name] = 1;
});

const server = app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
const wss = new WebSocketServer({ server });
function broadcastQueue() {
  const data = JSON.stringify(runningQueue);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

function printgenerator(token, counterName) {
  const counterObj = counters.find((c) => c.name === counterName);
  const counterDesc = counterObj ? counterObj.desc : counterName;

  const pdfPath = path.join(__dirname, `${token}.pdf`);
  const doc = new PDFDocument({ size: [283, 425], margin: 0 });

  doc.pipe(fs.createWriteStream(pdfPath));

  doc.moveDown(10);
  doc.fontSize(16).text("Nomor Antrian", { align: "center" });
  doc.moveDown();
  doc.fontSize(30).text(token, { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Silakan tunggu panggilan pada Loket ${counterDesc}`, {
    align: "center",
  });
  doc.end();

  doc.on("end", async () => {
    try {
      await print(pdfPath, { printer: "Kassen" });
      console.log(`Token ${token} berhasil dicetak`);
      fs.unlinkSync(pdfPath);
    } catch (err) {
      console.error("Gagal print:", err);
    }
  });
}

app.get("/api/take/:counter", (req, res) => {
  const counterName = req.params.counter.toLowerCase();

  if (!runningQueue[counterName]) {
    return res.status(400).json({ error: "Counter tidak ditemukan" });
  }

  const token = `${counterName.toUpperCase()}${String(
    noToken[counterName]
  ).padStart(3, "0")}`;
  noToken[counterName]++;

  const queueData = {
    token: token,
    serviceTime: "00:00:01",
    counter: counterName.toUpperCase(),
  };

  runningQueue[counterName].push(queueData);

  broadcastQueue();
  printgenerator(token, counterName);
  res.json(queueData);
});

wss.on("connection", (ws) => {
  console.log("Monitor connected");
  ws.send(JSON.stringify(runningQueue));
});
