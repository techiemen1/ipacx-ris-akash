const express = require("express");
const router = express.Router();
const pool = require("../db");

// Get test prices
router.get("/prices", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM test_prices WHERE is_active = true ORDER BY modality, body_part");
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Error fetching prices:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Add a test price
router.post("/prices", async (req, res) => {
  const { modality, body_part, price, gst_percent } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO test_prices (modality, body_part, price, gst_percent) VALUES ($1, $2, $3, $4) RETURNING *",
      [modality, body_part, price, gst_percent]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Error adding price:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Update a test price
router.put("/prices/:id", async (req, res) => {
  const { id } = req.params;
  const { modality, body_part, price, gst_percent, is_active } = req.body;
  try {
    const result = await pool.query(
      "UPDATE test_prices SET modality = $1, body_part = $2, price = $3, gst_percent = $4, is_active = $5, updated_at = NOW() WHERE id = $6 RETURNING *",
      [modality, body_part, price, gst_percent, is_active, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Error updating price:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Delete a test price (soft delete)
router.delete("/prices/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("UPDATE test_prices SET is_active = false, updated_at = NOW() WHERE id = $1", [id]);
    res.json({ success: true, message: "Price deleted successfully" });
  } catch (err) {
    console.error("Error deleting price:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Create an invoice
router.post("/invoice", async (req, res) => {
  const { patient_id, items, discount_amount, payment_method } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let total_amount = 0;
    let tax_amount = 0;
    items.forEach(item => {
      total_amount += parseFloat(item.price);
      tax_amount += (parseFloat(item.price) * (parseFloat(item.gst_percent || 0) / 100));
    });

    const grand_total = total_amount + tax_amount - (parseFloat(discount_amount) || 0);
    const invoice_number = `INV-${Date.now()}`;

    const invoiceResult = await client.query(
      `INSERT INTO invoices (invoice_number, patient_id, total_amount, discount_amount, tax_amount, grand_total, payment_status, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [invoice_number, patient_id, total_amount, discount_amount, tax_amount, grand_total, 'PAID', payment_method]
    );

    const invoiceId = invoiceResult.rows[0].id;

    for (const item of items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_amount, total_amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [invoiceId, item.description, 1, item.price, (item.price * (item.gst_percent || 0) / 100), (item.price * (1 + (item.gst_percent || 0) / 100))]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ success: true, data: invoiceResult.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating invoice:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// Get invoices for a patient
router.get("/invoices/:patient_id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM invoices WHERE patient_id = $1 ORDER BY created_at DESC", [req.params.patient_id]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Error fetching invoices:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

const PDFDocument = require("pdfkit");

// Print Billing Invoice Receipt PDF
router.get("/print/:patient_id", async (req, res) => {
  try {
    const { patient_id } = req.params;
    const patRes = await pool.query(
      "SELECT * FROM patients WHERE uhid::text = $1 OR patient_id::text = $1 LIMIT 1",
      [String(patient_id)]
    );
    const patient = patRes.rows[0] || {};
    const invRes = await pool.query(
      "SELECT * FROM invoices WHERE patient_id::text = $1 ORDER BY created_at DESC LIMIT 1",
      [String(patient_id)]
    );
    const invoice = invRes.rows[0] || {};

    const fullName = [patient.first_name, patient.last_name].filter(Boolean).join(" ") || patient.full_name || "N/A";
    const amount = invoice.total_amount || invoice.grand_total || 1500;
    const method = invoice.payment_method || patient.billing_category || "Self-Pay";
    const status = invoice.payment_status || "PAID";
    const invNumber = invoice.invoice_number || `INV-${Date.now()}`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=billing_receipt_${patient_id}.pdf`);

    const doc = new PDFDocument({ size: "A5", layout: "landscape", margin: 30 });
    doc.pipe(res);

    // Bill Header
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text("iPacx RADIOLOGY & DIAGNOSTIC CENTER", 30, 25);
    doc.font("Helvetica").fontSize(9).fillColor("#475569").text("123 Health Ave, Diagnostic City • Tel: +91 98765 43210", 30, 45);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0284c7").text("OFFICIAL BILLING RECEIPT", 400, 25, { align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(`Invoice No: ${invNumber}`, 400, 45, { align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(`Date: ${new Date().toLocaleDateString()}`, 400, 58, { align: "right" });

    doc.moveTo(30, 75).lineTo(560, 75).strokeColor("#cbd5e1").stroke();

    // Patient Details
    let y = 88;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#334155").text("Patient Name:", 30, y);
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(fullName, 120, y);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#334155").text("MRN / Patient ID:", 330, y);
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(patient_id, 440, y);

    y += 18;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#334155").text("Mobile Number:", 30, y);
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(patient.mobile || "N/A", 120, y);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#334155").text("Age / Gender:", 330, y);
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(`${patient.age || 'N/A'} Yrs / ${patient.gender || 'N/A'}`, 440, y);

    y += 25;
    // Table Header
    doc.rect(30, y, 530, 22).fill("#f1f5f9");
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#1e293b").text("DESCRIPTION / MODALITY STUDY", 40, y + 6);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#1e293b").text("PAYMENT MODE", 330, y + 6);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#1e293b").text("AMOUNT (INR)", 470, y + 6, { align: "right" });

    y += 28;
    const studyDesc = patient.study_type || patient.modality || "Diagnostic Radiology Examination";
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(studyDesc, 40, y);
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(method, 330, y);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(`₹${amount}`, 470, y, { align: "right" });

    y += 35;
    doc.moveTo(30, y).lineTo(560, y).strokeColor("#e2e8f0").stroke();

    y += 12;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#16a34a").text(`STATUS: ${status}`, 30, y);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text(`TOTAL PAID: ₹${amount}`, 400, y, { align: "right" });

    y += 40;
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#94a3b8").text("Thank you for choosing iPacx Radiology. Computer-generated invoice receipt.", 30, y, { align: "center", width: 530 });

    doc.end();
  } catch (err) {
    console.error("Print invoice PDF error:", err.message);
    res.status(500).json({ error: "Failed to generate billing receipt PDF" });
  }
});

module.exports = router;

