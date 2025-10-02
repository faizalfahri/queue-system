const jwt = require("jsonwebtoken");
require("dotenv").config();

const SECRET_KEY = process.env.JWT_SECRET;

// Generate token
function generateToken(payload) {
  return jwt.sign(payload, SECRET_KEY, { expiresIn: "1h" }); // set waktu tokennya
}

// Middleware buat verif si tokennya
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "Token tidak ada" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token tidak valid" });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: "Token expired/invalid" });
    req.user = user; // nyimpen data user ke request
    next();
  });
}

module.exports = { generateToken, verifyToken };
