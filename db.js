const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "db_queue",
});

db.connect((err) => {
  if (err) {
    console.error("Koneksi MySQL gagal:", err);
    return;
  }
  console.log("Koneksi MySQL berhasil!");
});

module.exports = db;
