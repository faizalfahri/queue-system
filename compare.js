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

      // cek apakah token sudah pernah di-stop sebelumnya
      db.query(
        "SELECT id FROM history WHERE token = ? AND counter_id = ?",
        [upperToken, counterId],
        (err, rows) => {
          if (err) {
            console.error("Gagal cek DB:", err);
            return res.status(500).json({ error: "Gagal cek DB" });
          }

          if (rows.length > 0) {
            // kalau sudah ada di DB, jangan insert lagi
            return res.status(400).json({
              error: `Token ${upperToken} sudah pernah di-stop sebelumnya`,
            });
          }

          // insert data stop baru
          const sql =
            "INSERT INTO history (token, counter_id, service_time) VALUES (?, ?, ?)";
          db.query(sql, [upperToken, counterId, serviceTime], (err, result) => {
            if (err) {
              console.error("Gagal simpan ke DB:", err);
              return res.status(500).json({ error: "Gagal simpan ke DB" });
            }

            // hapus token dari runningQueue setelah stop
            runningQueue[counterName] = runningQueue[counterName].filter(
              (t) => t.token !== upperToken
            );

            console.log(`Token ${upperToken} sudah dihapus dari runningQueue`);
            console.log("Isi runningQueue:", runningQueue);

            return res.json({
              message: `ServiceTime token ${upperToken} dihentikan & disimpan`,
            });
          });
        }
      );
    }
  );
});
