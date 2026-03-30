const express = require("express");
const multer = require("multer");
const { PDFDocument, rgb } = require("pdf-lib");

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

async function generateFilledPdf(templatePdfBytes, row, rowIndex, options = {}) {
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

  if (options.flatten === true) {
    form.flatten();
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

function parseManualFieldsPayload(payload) {
  const fields = JSON.parse(payload);
  if (!Array.isArray(fields)) {
    throw new Error("Fields payload must be an array.");
  }
  return fields;
}

function toSafeFieldName(value, index) {
  const fallback = `manual_field_${index + 1}`;
  const candidate = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return candidate || fallback;
}

async function createManualFieldsPdf(templatePdfBytes, fieldSpecs) {
  const pdfDoc = await PDFDocument.load(templatePdfBytes);
  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();
  const usedNames = new Set(form.getFields().map((field) => field.getName()));

  for (let idx = 0; idx < fieldSpecs.length; idx += 1) {
    const spec = fieldSpecs[idx] || {};
    const pageIndex = Number(spec.pageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
      continue;
    }

    let fieldName = toSafeFieldName(spec.name, idx);
    let suffix = 1;
    while (usedNames.has(fieldName)) {
      fieldName = `${toSafeFieldName(spec.name, idx)}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(fieldName);

    const x = Number(spec.x);
    const y = Number(spec.y);
    const width = Math.max(48, Number(spec.width) || 160);
    const height = Math.max(18, Number(spec.height) || 24);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    const page = pages[pageIndex];
    const textField = form.createTextField(fieldName);
    textField.addToPage(page, {
      x,
      y,
      width,
      height,
      borderWidth: 0,
      borderColor: undefined,
      backgroundColor: undefined,
      textColor: rgb(0.08, 0.19, 0.31),
      // No underline, no visible widget
    });
    // Make the field invisible (no border, no background, no underline)
    textField.enableScrolling();
    // Optionally, shrink font size to fit (pdf-lib does not support auto font size, but we can set a small default)
    textField.updateAppearances(font => font);
  }

  return pdfDoc.save();
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
        0,
        { flatten: isTruthy(req.body.flatten) }
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

app.post("/api/manual-fields", upload.single("pdf"), async (req, res) => {
  try {
    const pdfFile = req.file;
    if (!pdfFile) {
      return res.status(400).json({ error: "A PDF template file is required." });
    }

    if (!req.body.fields) {
      return res.status(400).json({ error: "Manual field definitions are required." });
    }

    let fields;
    try {
      fields = parseManualFieldsPayload(req.body.fields);
    } catch (error) {
      return res.status(400).json({ error: "Invalid fields payload." });
    }

    if (!fields.length) {
      return res.status(400).json({ error: "At least one field must be added." });
    }

    const nextPdfBytes = await createManualFieldsPdf(pdfFile.buffer, fields);
    return res.send(Buffer.from(nextPdfBytes));
  } catch (error) {
    return res.status(500).json({
      error: "Unable to insert manual fields into PDF. Please try again."
    });
  }
});

app.listen(port, () => {
  console.log(`PDF bulk filler listening on http://localhost:${port}`);
});
