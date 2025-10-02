const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const cron = require("node-cron");

const { print } = require("pdf-to-printer");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const path = require("path");

const bcrypt = require("bcrypt");
const db = require("./db");
const jwt = require("jsonwebtoken");
const { generateToken, verifyToken } = require("./auth");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// INISIALISASI VARIABEL
let runningQueue = {};
let noToken = {};
const SECRET_KEY = process.env.JWT_SECRET;

// REGISTER
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username dan password wajib diisi" });
  }

  try {
    db.query(
      "SELECT * FROM users WHERE username = ?",
      [username],
      async (err, results) => {
        if (err) return res.status(500).json({ error: "DB error" });
        if (results.length > 0) {
          return res.status(400).json({ error: "Username sudah dipakai" });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        db.query(
          "INSERT INTO users (username, password) VALUES (?, ?)",
          [username, hashedPassword],
          (err, result) => {
            if (err)
              return res.status(500).json({ error: "Gagal simpan user" });
            res.json({ message: "User berhasil didaftarkan!" });
          }
        );
      }
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username & password wajib diisi" });
  }

  db.query(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, results) => {
      if (err) return res.status(500).json({ error: "DB error" });
      if (results.length === 0) {
        return res.status(401).json({ error: "User tidak ditemukan" });
      }

      const user = results[0];
      const validPassword = await bcrypt.compare(password, user.password);

      if (!validPassword) {
        return res.status(401).json({ error: "Password salah" });
      }

      const token = generateToken(
        { id: user.id, username: user.username },
        SECRET_KEY,
        { expiresIn: "1h" }
      );
      res.json({ message: "Login berhasil", token });
    }
  );
});

// endpoint verif token
app.post("/api/protected", verifyToken, (req, res) => {
  res.json({
    message: "Akses berhasil via POST!",
    user: req.user,
    data: req.body,
  });
});

// RESET ANTRIAN
cron.schedule("0 0 * * *", () => {
  console.log("Melakukan reset antrian tiap jam 00:00...");

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
const server = app.listen(process.env.PORT, () => {
  console.log(`Server running on ${process.env.PORT}`);
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

  const counterName = counter.toUpperCase();

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
  let counterName = null;
  let tokenObj = null;

  // Cari token di runningQueue
  for (let cn in runningQueue) {
    const t = runningQueue[cn].find((t) => t.token === upperToken);
    if (t) {
      counterName = cn;
      tokenObj = t;
      break;
    }
  }

  // Kalau token gada di runningQueue
  if (!counterName || !tokenObj) {
    return res
      .status(404)
      .json({ error: "Token tidak ditemukan di runningQueue" });
  }

  // Kalau timer sudah berjalan
  if (activeTimers[upperToken]) {
    return res.status(400).json({ error: "ServiceTime sudah berjalan" });
  }

  // Cek ke DB apakah token sudah pernah di-stop
  db.query(
    "SELECT id FROM counters WHERE name = ?",
    [counterName],
    (err, results) => {
      if (err || results.length === 0) {
        return res.status(404).json({ error: "Counter tidak ditemukan di DB" });
      }

      const counterId = results[0].id;
      db.query(
        "SELECT id FROM history WHERE token = ? AND counter_id = ?",
        [upperToken, counterId],
        (err, rows) => {
          if (err) {
            console.error("Gagal cek DB:", err);
            return res.status(500).json({ error: "Gagal cek DB" });
          }

          if (rows.length > 0) {
            return res.status(400).json({
              error: `Token ${upperToken} sudah pernah di-stop sebelumnya`,
            });
          }

          // Start timer kalau semua validasi lolos
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

          return res.json({
            message: `ServiceTime token ${upperToken} dimulai`,
          });
        }
      );
    }
  );
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

        runningQueue[counterName] = runningQueue[counterName].filter(
          (t) => t.token !== upperToken
        );

        console.log("Data berhasil disimpan:", result);
        return res.json({
          message: `ServiceTime token ${upperToken} dihentikan & disimpan`,
        });
      });
    }
  );
});

// PELAYANAN SELANJUTNYA
app.post("/api/next", (req, res) => {
  const { counter } = req.body;
  if (!counter)
    return res.status(400).json({ error: "Counter harus disertakan" });

  const counterName = counter.toUpperCase();

  if (!runningQueue[counterName] || runningQueue[counterName].length === 0) {
    return res.status(400).json({ error: "Tidak ada token di antrian" });
  }

  const currentToken = runningQueue[counterName][0];

  if (activeTimers[currentToken.token]) {
    clearInterval(activeTimers[currentToken.token]);
    delete activeTimers[currentToken.token];
  }

  console.log("Isi runningQueue:", runningQueue);
  console.log("CounterName:", counterName);

  // ini buat ngambil counter_id dari si db nya
  db.query(
    "SELECT id FROM counters WHERE name = ?",
    [counterName],
    (err, results) => {
      if (err || results.length === 0) {
        return res.status(404).json({ error: "Counter tidak ditemukan di DB" });
      }

      const counterId = results[0].id;
      const today = new Date().toISOString().split("T")[0];

      // buat ngecek token hari ini
      db.query(
        "SELECT id FROM history WHERE token = ? AND counter_id = ? AND DATE(created_at) = ?",
        [currentToken.token, counterId, today],
        (err, rows) => {
          if (err) {
            console.error("DB error:", err);
            return res.status(500).json({ error: "Gagal cek history" });
          }

          if (rows.length > 0) {
            runningQueue[counterName].shift();
            console.log(`Token ${currentToken.token} sudah dilayani hari ini`);
            console.log("Isi runningQueue:", runningQueue);
          } else {
            const tokenDipindah = runningQueue[counterName].shift();
            runningQueue[counterName].push(tokenDipindah);
            console.log(
              `Token ${currentToken.token} dipindahkan ke belakang queue`
            );
            console.log("Isi runningQueue:", runningQueue);
          }
          broadcastQueue();
          return res.json({
            message: `Next diproses untuk ${currentToken.token}`,
          });
        }
      );
    }
  );
});

// MONITOR WEBSOCKET
wss.on("connection", (ws) => {
  console.log("Monitor connected");
  ws.send(JSON.stringify(runningQueue));
});
