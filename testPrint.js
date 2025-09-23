const { print } = require("pdf-to-printer");
const fs = require("fs");
const PDFDocument = require("pdfkit");

// Buat PDF sementara
const doc = new PDFDocument({ size: [200, 300], margin: 10 });
const filePath = "ticket.pdf";

doc.fontSize(16).text("Nomor Antrian", { align: "center" });
doc.moveDown();
doc.fontSize(30).text("A001", { align: "center", bold: true });
doc.moveDown();
doc.fontSize(12).text("Silakan tunggu panggilan", { align: "center" });
doc.end();

doc.pipe(fs.createWriteStream(filePath)).on("finish", async () => {
  try {
    await print(filePath, { printer: "Kassen" }); // Ganti "Kassen" dengan nama printer di Control Panel
    console.log("Berhasil mencetak tiket!");
  } catch (err) {
    console.error("Gagal print:", err);
  }
});
