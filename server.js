const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const { print } = require("pdf-to-printer");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const path = require("path");

const db = require("./db");

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

let activeTimers = {};

app.get("/start/:token", (req, res) => {
  const token = req.params.token.toUpperCase();
  let found = false;

  for (let counterName in runningQueue) {
    const tokenObj = runningQueue[counterName].find((t) => t.token === token);
    if (tokenObj) {
      found = true;

      if (activeTimers[token]) {
        return res.status(400).json({ error: "ServiceTime sudah berjalan" });
      }

      let [h, m, s] = tokenObj.serviceTime.split(":").map(Number);
      activeTimers[token] = setInterval(() => {
        s++;
        if (s >= 60) {
          s = 0;
          m++;
        }
        if (m >= 60) {
          m = 0;
          h++;
        }
        tokenObj.serviceTime = `${String(h).padStart(2, "0")}:${String(
          m
        ).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        broadcastQueue();
      }, 1000);

      return res.json({ message: `ServiceTime token ${token} dimulai` });
    }
  }

  if (!found) res.status(404).json({ error: "Token tidak ditemukan" });
});

app.get("/stop/:token", (req, res) => {
  const token = req.params.token.toUpperCase();

  let counterName = null;
  let serviceTime = null;

  for (let cn in runningQueue) {
    const tokenObj = runningQueue[cn].find((t) => t.token === token);
    if (tokenObj) {
      counterName = cn;
      serviceTime = tokenObj.serviceTime;
      break;
    }
  }

  if (!activeTimers[token]) {
    return res.status(404).json({ error: "Token tidak sedang berjalan" });
  }

  clearInterval(activeTimers[token]);
  delete activeTimers[token];

  if (!counterName || !serviceTime) {
    return res.status(404).json({ error: "Data token tidak ditemukan" });
  }

  const sql =
    "INSERT INTO history (token, counter, service_time) VALUES (?, ?, ?)";
  db.query(
    sql,
    [token, counterName.toUpperCase(), serviceTime],
    (err, result) => {
      if (err) {
        console.error("Gagal simpan ke DB:", err);
        return res.status(500).json({ error: "Gagal simpan ke DB" });
      }

      console.log("Data berhasil disimpan:", result);
      return res.json({
        message: `ServiceTime token ${token} dihentikan & disimpan`,
      });
    }
  );
});

app.get("/next/:counter", (req, res) => {
  const counterName = req.params.counter.toLowerCase();

  if (!runningQueue[counterName] || runningQueue[counterName].length === 0) {
    return res.status(400).json({ error: "Tidak ada token di antrian" });
  }

  const currentToken = runningQueue[counterName].shift();

  if (activeTimers[currentToken.token]) {
    clearInterval(activeTimers[currentToken.token]);
    delete activeTimers[currentToken.token];
  }

  broadcastQueue();

  res.json({
    message: `Token ${
      currentToken.token
    } selesai dan dihapus dari counter ${counterName.toUpperCase()}`,
    token: currentToken,
  });
});

wss.on("connection", (ws) => {
  console.log("Monitor connected");
  ws.send(JSON.stringify(runningQueue));
});
