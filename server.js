const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const cron = require("node-cron");

const { print } = require("pdf-to-printer");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const path = require("path");

const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

// INISIALISASI VARIABEL
let runningQueue = {};
let noToken = {};
let counters = [];
counters.forEach((counter) => {
  runningQueue[counter.name] = [];
  noToken[counter.name] = 1;
});

// RESET ANTRIAN
cron.schedule("0 0 * * *", () => {
  console.log("Melakukan reset antrian tiap 2 menit...");

  db.query("SELECT * FROM counters", (err, results) => {
    if (err) {
      console.error("Gagal ambil data counters:", err);
      return;
    }

    results.forEach((counter) => {
      runningQueue[counter.name.toLowerCase()] = [];
      noToken[counter.name.toLowerCase()] = 1;
    });

    for (let token in activeTimers) {
      clearInterval(activeTimers[token]);
    }
    activeTimers = {};

    broadcastQueue();
    console.log("Antrian berhasil direset:", new Date());
  });
});

// INISIALISASI SERVER
const server = app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

// INISIALISASI WEBSOCKET
const wss = new WebSocketServer({ server });
function broadcastQueue() {
  const data = JSON.stringify(runningQueue);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

// KONEKSI PRINTER
function printgenerator(token, counterName) {
  // Ambil data counter dari DB
  db.query(
    "SELECT `desc` FROM counters WHERE name = ?",
    [counterName.toUpperCase()],
    (err, results) => {
      if (err || results.length === 0) {
        console.error("Counter tidak ditemukan di DB:", err);
        return;
      }

      const counterDesc = results[0].desc; // Ambil deskripsi dari DB

      const pdfPath = path.join(__dirname, `${token}.pdf`);
      const doc = new PDFDocument({ size: [283, 425], margin: 0 });

      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      doc.moveDown(10);
      doc.fontSize(16).text("Nomor Antrian", { align: "center" });
      doc.moveDown();
      doc.fontSize(30).text(token, { align: "center" });
      doc.moveDown();
      doc
        .fontSize(12)
        .text(`Silakan tunggu panggilan pada Loket ${counterDesc}`, {
          align: "center",
        });
      doc.end();

      stream.on("finish", async () => {
        try {
          await print(pdfPath, { printer: "Kassen" });
          console.log(`Token ${token} berhasil dicetak`);
          fs.unlinkSync(pdfPath);
        } catch (err) {
          console.error("Gagal print:", err);
        }
      });
    }
  );
}

// AMBIL TIKET
app.post("/api/take", (req, res) => {
  const { counter } = req.body;

  if (!counter) {
    return res.status(400).json({ error: "Counter harus disertakan" });
  }

  const counterName = counter.toLowerCase();

  if (!runningQueue[counterName]) {
    return res.status(400).json({ error: "Counter tidak ditemukan" });
  }

  db.query(
    "SELECT * FROM counters WHERE name = ?",
    [counterName],
    (err, results) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ error: "Gagal akses database" });
      }

      if (results.length === 0) {
        return res.status(400).json({ error: "Counter tidak ditemukan di DB" });
      }

      const counterData = results[0];

      if (!runningQueue[counterName]) {
        runningQueue[counterName] = [];
        noToken[counterName] = 1;
      }

      // Buat token baru
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
    }
  );
});

let activeTimers = {};

// AMBIL DATA COUNTERS DARI DB
db.query("SELECT * FROM counters", (err, results) => {
  if (err) {
    console.error("Gagal ambil data counters:", err);
    return;
  }

  counters = results;

  results.forEach((counter) => {
    runningQueue[counter.name] = [];
    noToken[counter.name] = 1;
  });

  console.log("Data counters berhasil dimuat dari DB");
});

// MULAI PELAYANAN
app.post("/api/start", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token harus disertakan" });

  const upperToken = token.toUpperCase();
  let found = false;

  for (let counterName in runningQueue) {
    const tokenObj = runningQueue[counterName].find(
      (t) => t.token === upperToken
    );
    if (tokenObj) {
      found = true;

      if (activeTimers[upperToken]) {
        return res.status(400).json({ error: "ServiceTime sudah berjalan" });
      }

      let [h, m, s] = tokenObj.serviceTime.split(":").map(Number);
      activeTimers[upperToken] = setInterval(() => {
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

      return res.json({ message: `ServiceTime token ${upperToken} dimulai` });
    }
  }

  if (!found) res.status(404).json({ error: "Token tidak ditemukan" });
});

// STOP PELAYANAN
app.post("/api/stop", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token harus disertakan" });

  const upperToken = token.toUpperCase();
  let counterName = null;
  let serviceTime = null;

  for (let cn in runningQueue) {
    const tokenObj = runningQueue[cn].find((t) => t.token === upperToken);
    if (tokenObj) {
      counterName = cn;
      serviceTime = tokenObj.serviceTime;
      break;
    }
  }

  if (!activeTimers[upperToken]) {
    return res.status(404).json({ error: "Token tidak sedang berjalan" });
  }

  clearInterval(activeTimers[upperToken]);
  delete activeTimers[upperToken];

  if (!counterName || !serviceTime) {
    return res.status(404).json({ error: "Data token tidak ditemukan" });
  }

  db.query(
    "SELECT id FROM counters WHERE name = ?",
    [counterName],
    (err, results) => {
      if (err || results.length === 0) {
        return res.status(404).json({ error: "Counter tidak ditemukan di DB" });
      }

      const counterId = results[0].id;

      const sql =
        "INSERT INTO history (token, counter_id, service_time) VALUES (?, ?, ?)";
      db.query(sql, [upperToken, counterId, serviceTime], (err, result) => {
        if (err) {
          console.error("Gagal simpan ke DB:", err);
          return res.status(500).json({ error: "Gagal simpan ke DB" });
        }

        console.log("Data berhasil disimpan:", result);
        return res.json({
          message: `ServiceTime token ${upperToken} dihentikan & disimpan`,
        });
      });
    }
  );
});

// PELAYANAN SELANJUTNYA
app.post("/next", (req, res) => {
  const { counter } = req.body;
  if (!counter)
    return res.status(400).json({ error: "Counter harus disertakan" });

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

// MONITOR WEBSOCKET
wss.on("connection", (ws) => {
  console.log("Monitor connected");
  ws.send(JSON.stringify(runningQueue));
});
