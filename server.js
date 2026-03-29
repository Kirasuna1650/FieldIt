const express = require("express");
const multer = require("multer");
const { PDFDocument } = require("pdf-lib");

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

app.use(express.static("public"));
app.use(express.json());

function safeFilename(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  return raw
    .replace(/[<>:\"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim() || fallback;
}

function isTruthy(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "on", "checked"].includes(normalized);
}

function getFieldType(field) {
  return field.constructor?.name || "UnknownField";
}

async function readPdfFieldNames(pdfBytes) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  return form.getFields().map((field) => ({
    name: field.getName(),
    type: getFieldType(field)
  }));
}

function setPdfFieldValue(field, value) {
  const type = getFieldType(field);
  const stringValue = String(value ?? "");

  if (type === "PDFTextField") {
    field.setText(stringValue);
    return;
  }

  if (type === "PDFCheckBox") {
    if (isTruthy(stringValue)) {
      field.check();
    } else {
      field.uncheck();
    }
    return;
  }

  if (type === "PDFRadioGroup") {
    if (stringValue) {
      field.select(stringValue);
    }
    return;
  }

  if (type === "PDFDropdown" || type === "PDFOptionList") {
    if (stringValue) {
      field.select(stringValue);
    }
    return;
  }
}

async function generateFilledPdf(templatePdfBytes, row, rowIndex) {
  const pdfDoc = await PDFDocument.load(templatePdfBytes);
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  for (const field of fields) {
    const fieldName = field.getName();
    const value = row[fieldName];

    if (value === undefined || value === null) {
      continue;
    }

    try {
      setPdfFieldValue(field, value);
    } catch (error) {
      // Ignore incompatible values for individual fields to keep bulk generation running.
    }
  }

  const pdfBytes = await pdfDoc.save();
  const fallbackName = `record-${rowIndex + 1}`;
  const primaryKey = row.__filename || row._filename || row.fileName || "";
  const filename = `${safeFilename(primaryKey, fallbackName)}.pdf`;

  return { filename, pdfBytes };
}

function parseRowsPayload(payload) {
  const rows = JSON.parse(payload);
  if (!Array.isArray(rows)) {
    throw new Error("Rows payload must be an array.");
  }
  return rows;
}

function rowHasAnyInput(row) {
  const keys = Object.keys(row || {});
  return keys.some((key) => String(row[key] ?? "").trim().length > 0);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/fields", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "PDF file is required." });
    }

    const fields = await readPdfFieldNames(req.file.buffer);
    return res.json({ fields });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to read PDF fields. Ensure the file is a fillable PDF form."
    });
  }
});

app.post(
  "/api/generate",
  upload.single("pdf"),
  async (req, res) => {
    try {
      const pdfFile = req.file;

      if (!pdfFile) {
        return res.status(400).json({
          error: "A PDF template file is required."
        });
      }

      if (!req.body.rows) {
        return res.status(400).json({
          error: "Worksheet rows are required."
        });
      }

      let rows;
      try {
        rows = parseRowsPayload(req.body.rows);
      } catch (error) {
        return res.status(400).json({ error: "Invalid rows payload." });
      }

      const filteredRows = rows.filter((row) => rowHasAnyInput(row));
      if (filteredRows.length === 0) {
        return res.status(400).json({
          error: "Worksheet has no data rows."
        });
      }

      const { filename, pdfBytes } = await generateFilledPdf(
        pdfFile.buffer,
        filteredRows[0],
        0
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      return res.send(Buffer.from(pdfBytes));
    } catch (error) {
      return res.status(500).json({
        error:
          "Generation failed. Check PDF field compatibility and worksheet values, then retry."
      });
    }
  }
);

app.listen(port, () => {
  console.log(`PDF bulk filler listening on http://localhost:${port}`);
});
