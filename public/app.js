// --- Live PDF Preview ---
const worksheetPreviewPanel = document.getElementById("worksheetPreviewPanel");
const worksheetPreviewCanvas = document.getElementById("worksheetPreviewCanvas");
let worksheetPreviewPdfUrl = null;

async function updateWorksheetPreview() {
  if (!worksheetPreviewPanel || !worksheetPreviewCanvas) return;
  const pdf = pdfInput.files?.[0];
  if (!pdf) {
    worksheetPreviewPanel.hidden = true;
    return;
  }
  // Collect current worksheet row (first record)
  const table = worksheetTable;
  if (!table) return;
  const tbody = table.querySelector("tbody");
  if (!tbody) return;
  const rowData = {};
  // For each row (category), get the value from the first column (record 0)
  Array.from(tbody.children).forEach((tr) => {
    const label = tr.firstChild?.textContent;
    const input = tr.children[1]?.querySelector("input");
    if (label && input) {
      rowData[label] = input.value;
    }
  });
  // Send to backend for preview
  worksheetPreviewPanel.hidden = false;
  worksheetPreviewCanvas.style.opacity = 0.5;
  try {
    const fd = new FormData();
    fd.append("pdf", pdf);
    fd.append("row", JSON.stringify(rowData));
    const resp = await fetch("/api/preview", { method: "POST", body: fd });
    if (!resp.ok) throw new Error("Preview failed");
    const blob = await resp.blob();
    if (worksheetPreviewPdfUrl) URL.revokeObjectURL(worksheetPreviewPdfUrl);
    worksheetPreviewPdfUrl = URL.createObjectURL(blob);
    // Render first page as image using PDF.js
    if (window.pdfjsLib) {
      const pdfDoc = await window.pdfjsLib.getDocument({ url: worksheetPreviewPdfUrl }).promise;
      const page = await pdfDoc.getPage(1);
      const scale = 1.1;
      const viewport = page.getViewport({ scale });
      worksheetPreviewCanvas.width = viewport.width;
      worksheetPreviewCanvas.height = viewport.height;
      const ctx = worksheetPreviewCanvas.getContext("2d", { alpha: false });
      await page.render({ canvasContext: ctx, viewport }).promise;
      worksheetPreviewCanvas.style.opacity = 1;
    }
  } catch (e) {
    worksheetPreviewPanel.hidden = true;
  }
}
const pdfInput = document.getElementById("pdfFile");
const detectFieldsBtn = document.getElementById("detectFieldsBtn");
const generateBtn = document.getElementById("generateBtn");
const worksheetActionsEl = document.querySelector(".worksheet-actions");
const worksheetContainer = document.getElementById("worksheetContainer");
const worksheetTable = document.getElementById("worksheetTable");
const tableScroll = document.getElementById("tableScroll");
const sheetFieldsContainer = document.getElementById("sheetFieldsContainer");
const bulkModeToggle = document.getElementById("bulkModeToggle");
const bulkModeNote = document.getElementById("bulkModeNote");
const outputNameInput = document.getElementById("outputFileName");
const statusEl = document.getElementById("status");
const downloadLink = document.getElementById("downloadLink");
const helpBtn = document.getElementById("helpBtn");
const helpPopover = document.getElementById("helpPopover");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingMessage = document.getElementById("loadingMessage");
const fieldRenameModal = document.getElementById("fieldRenameModal");
const fieldRenameInput = document.getElementById("fieldRenameInput");
const fieldRenameCancelBtn = document.getElementById("fieldRenameCancelBtn");
const fieldRenameSaveBtn = document.getElementById("fieldRenameSaveBtn");

const editorStepTab = document.getElementById("editorStepTab");
const editorFieldPrefix = document.getElementById("editorFieldPrefix");
const editorFieldWidth = document.getElementById("editorFieldWidth");
const editorFieldHeight = document.getElementById("editorFieldHeight");
const editorCanvas = document.getElementById("editorCanvas");
const editorClickLayer = document.getElementById("editorClickLayer");
const editorFieldList = document.getElementById("editorFieldList");
const applyManualFieldsBtn = document.getElementById("applyManualFieldsBtn");
const clearEditorFieldsBtn = document.getElementById("clearEditorFieldsBtn");
const downloadCurrentPdfBtn = document.getElementById("downloadCurrentPdfBtn");

const stepTabs = Array.from(document.querySelectorAll(".step-tab"));
const stepPanels = Array.from(document.querySelectorAll(".step-panel"));

const BULK_MODE_ENABLED = false;
const DRAG_MOVE_THRESHOLD = 6;

let detectedFields = [];
let rowCount = 0;
let currentDownloadUrl = "";
let loadingCounter = 0;
let groupedFields = {
  staticFields: [],
  repeating: null
};

const editorState = {
  pdfFile: null,
  pdfDoc: null,
  pageIndex: 0,
  scale: 1.4,
  viewport: null,
  placedFields: [],
  nextFieldIndex: 1,
  dragState: null,
  draftMarkerEl: null,
  pendingRenameFieldId: null
};

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
}

function createColWithWidth(widthPx) {
  const col = document.createElement("col");
  col.style.width = `${widthPx}px`;
  return col;
}

function attachColumnResizer(th, col, minWidth = 90) {
  const resizer = document.createElement("span");
  resizer.className = "col-resizer";
  th.appendChild(resizer);

  resizer.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = th.getBoundingClientRect().width;

    const handleMouseMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(minWidth, startWidth + delta);
      col.style.width = `${nextWidth}px`;
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.classList.remove("is-col-resizing");
    };

    document.body.classList.add("is-col-resizing");
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  });
}

function setActiveStep(stepName) {
  stepTabs.forEach((tab) => {
    const isActive = tab.dataset.step === stepName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  stepPanels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== stepName;
  });

  const activePanel = stepPanels.find((panel) => panel.dataset.panel === stepName);
  const navSlot = activePanel?.querySelector(".panel-nav-slot");
  if (navSlot && !navSlot.contains(stepTabs[0])) {
    navSlot.appendChild(document.querySelector(".workflow-tabs"));
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function showLoading(message) {
  loadingCounter += 1;

  if (loadingMessage && message) {
    loadingMessage.textContent = message;
  }

  if (loadingOverlay) {
    loadingOverlay.hidden = false;
  }
}

function hideLoading() {
  loadingCounter = Math.max(0, loadingCounter - 1);
  if (loadingCounter > 0) {
    return;
  }

  if (loadingOverlay) {
    loadingOverlay.hidden = true;
  }
}

function setEditorVisible(visible) {
  if (!editorStepTab) {
    return;
  }

  editorStepTab.hidden = !visible;
  if (!visible && editorStepTab.classList.contains("is-active")) {
    setActiveStep("upload");
  }
}

function sortByName(items) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function parseRepeatingField(name) {
  const match = name.match(/^(.+?)_(\d+)_(.+)$/);
  if (!match) {
    return null;
  }

  return {
    group: match[1],
    index: Number(match[2]),
    category: match[3],
    original: name
  };
}

function splitFieldGroups(fields) {
  const parsed = fields
    .map((field) => ({ field, parsed: parseRepeatingField(field.name) }))
    .filter((entry) => entry.parsed);

  if (!parsed.length) {
    return { staticFields: [], repeating: null };
  }

  const groups = new Map();
  parsed.forEach((entry) => {
    const current = groups.get(entry.parsed.group) || [];
    current.push(entry);
    groups.set(entry.parsed.group, current);
  });

  const strongestGroup = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )[0];

  if (!strongestGroup || strongestGroup[1].length < 4) {
    return { staticFields: [], repeating: null };
  }

  const [groupName, groupEntries] = strongestGroup;
  const categories = [...new Set(groupEntries.map((entry) => entry.parsed.category))].sort();
  const indices = [...new Set(groupEntries.map((entry) => entry.parsed.index))].sort((a, b) => a - b);

  const repeatingFieldNames = new Set(groupEntries.map((entry) => entry.field.name));
  const staticFields = sortByName(fields.filter((field) => !repeatingFieldNames.has(field.name)));

  return {
    staticFields,
    repeating: {
      groupName,
      categories,
      indices
    }
  };
}

function renderStaticFields(fields) {
  if (!fields.length) {
    sheetFieldsContainer.innerHTML = "";
    sheetFieldsContainer.hidden = true;
    return;
  }

  sheetFieldsContainer.hidden = false;
  const rows = fields
    .map(
      (field) => `
      <div class="sheet-row">
        <label for="field-${field.name}">${field.name}</label>
        <input id="field-${field.name}" type="text" data-sheet-field="${field.name}" placeholder="${field.type}" />
      </div>
    `
    )
    .join("");

  sheetFieldsContainer.innerHTML = `
    <h3 class="subheading">Sheet Fields</h3>
    <div class="sheet-fields-grid">${rows}</div>
  `;
}

function renderWorksheet(fields) {
  if (!fields.length) {
    tableScroll.hidden = true;
    worksheetContainer.classList.add("empty");
    worksheetContainer.textContent = "No fillable fields found in this PDF.";
    sheetFieldsContainer.hidden = true;
    return;
  }

  groupedFields = splitFieldGroups(fields);
  renderStaticFields(groupedFields.staticFields);

  if (bulkModeToggle) {
    bulkModeToggle.disabled = true;
  }
  if (bulkModeNote) {
    bulkModeNote.textContent = "Bulk mode is disabled for now.";
  }

  if (worksheetActionsEl) {
    worksheetActionsEl.hidden = true;
  }
  generateBtn.textContent = "Generate Filled PDF";

  rowCount = 0;
  worksheetContainer.classList.remove("empty");
  worksheetContainer.textContent = "";
  tableScroll.hidden = false;

  // Vertical layout: categories as rows, records as columns
  const colgroup = document.createElement("colgroup");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  // First column: field/category name
  const nameCol = createColWithWidth(160);
  colgroup.appendChild(nameCol);

  // Add columns for each record (row of data)
  const recordCount = worksheetTable._recordCount || 1;
  for (let i = 0; i < recordCount; i++) {
    colgroup.appendChild(createColWithWidth(210));
  }

  // Header row: blank cell + record numbers
  const headerRow = document.createElement("tr");
  const blankTh = document.createElement("th");
  blankTh.textContent = "#";
  headerRow.appendChild(blankTh);
  for (let i = 0; i < recordCount; i++) {
    const th = document.createElement("th");
    th.textContent = String(i + 1);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  // Get all categories/fields
  const categories = groupedFields.repeating
    ? groupedFields.repeating.categories
    : fields.map((field) => field.name);

  // For each category, create a row
  categories.forEach((category) => {
    const tr = document.createElement("tr");
    const labelTd = document.createElement("td");
    labelTd.textContent = category;
    tr.appendChild(labelTd);
    for (let i = 0; i < recordCount; i++) {
      const td = document.createElement("td");
      td.appendChild(createCellInput("", category + "__" + i));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  worksheetTable.innerHTML = "";
  worksheetTable.appendChild(colgroup);
  worksheetTable.appendChild(thead);
  worksheetTable.appendChild(tbody);
  worksheetTable._recordCount = recordCount;

  // Attach input listeners for live preview
  Array.from(tbody.querySelectorAll("input")).forEach((input) => {
    input.addEventListener("input", () => {
      updateWorksheetPreview();
    });
  });
  // Initial preview
  updateWorksheetPreview();
}

function createCellInput(placeholder, fieldName = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  if (fieldName) {
    input.dataset.field = fieldName;
  }
  return input;
}

function addRow(count = 1) {
  const tbody = worksheetTable.querySelector("tbody");
  if (!tbody || !detectedFields.length) {
    setStatus("Build worksheet first by uploading a fillable PDF.", true);
    return;
  }

  for (let i = 0; i < count; i += 1) {
    rowCount += 1;
    const tr = document.createElement("tr");

    const indexTd = document.createElement("td");
    indexTd.textContent = String(rowCount);
    tr.appendChild(indexTd);

    if (getCurrentMode() === "bulk" && !groupedFields.repeating) {
      const filenameTd = document.createElement("td");
      const filenameInput = createCellInput(`record-${rowCount}`);
      filenameInput.dataset.filename = "true";
      filenameTd.appendChild(filenameInput);
      tr.appendChild(filenameTd);
    }

    const categories = groupedFields.repeating
      ? groupedFields.repeating.categories
      : detectedFields.map((field) => field.name);

    categories.forEach((category) => {
      const td = document.createElement("td");
      td.appendChild(createCellInput("", category));
      tr.appendChild(td);
    });

    if (getCurrentMode() !== "single") {
      const actionsTd = document.createElement("td");
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn row-remove";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        tr.remove();
        renumberRows();
      });
      actionsTd.appendChild(removeButton);
      tr.appendChild(actionsTd);
    }

    tbody.appendChild(tr);
  }
}

function renumberRows() {
  const rows = worksheetTable.querySelectorAll("tbody tr");
  rowCount = 0;
  rows.forEach((tr) => {
    rowCount += 1;
    tr.firstChild.textContent = String(rowCount);
  });
}

function setHelpVisible(isVisible) {
  if (!helpPopover || !helpBtn) {
    return;
  }

  helpPopover.hidden = !isVisible;
  helpBtn.setAttribute("aria-expanded", isVisible ? "true" : "false");
}

function isBulkModeEnabled() {
  return BULK_MODE_ENABLED && Boolean(bulkModeToggle?.checked);
}

function supportsBulkMode() {
  return BULK_MODE_ENABLED && !groupedFields.repeating;
}

function getCurrentMode() {
  return supportsBulkMode() && isBulkModeEnabled() ? "bulk" : "single";
}

function collectRows() {
  const staticValues = {};

  const staticInputs = document.querySelectorAll("input[data-sheet-field]");
  staticInputs.forEach((input) => {
    staticValues[input.dataset.sheetField] = input.value;
  });

  const tableRows = worksheetTable.querySelectorAll("tbody tr");

  if (groupedFields.repeating) {
    const rowPayload = { ...staticValues };
    const filename = outputNameInput.value.trim();
    if (filename) {
      rowPayload.__filename = filename;
    }

    tableRows.forEach((tr, idx) => {
      const fieldInputs = tr.querySelectorAll("input[data-field]");
      fieldInputs.forEach((input) => {
        const category = input.dataset.field;
        const fieldName = `${groupedFields.repeating.groupName}_${idx + 1}_${category}`;
        rowPayload[fieldName] = input.value;
      });
    });

    const hasValue = Object.values(rowPayload).some(
      (value) => String(value || "").trim().length > 0
    );

    return hasValue ? [rowPayload] : [];
  }

  const firstRow = tableRows[0];
  if (!firstRow) {
    return [];
  }

  const rowPayload = { ...staticValues };
  const filename = outputNameInput.value.trim();
  if (filename) {
    rowPayload.__filename = filename;
  }

  const fieldInputs = firstRow.querySelectorAll("input[data-field]");
  fieldInputs.forEach((input) => {
    rowPayload[input.dataset.field] = input.value;
  });

  const hasValue = Object.values(rowPayload).some(
    (value) => String(value || "").trim().length > 0
  );

  return hasValue ? [rowPayload] : [];
}

function normalizePrefix(prefix) {
  const cleaned = String(prefix || "")
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "manual_field";
}

function sanitizeFieldName(name) {
  return String(name || "")
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getUniqueFieldName(rawName, fieldIdToExclude) {
  const baseName = sanitizeFieldName(rawName);
  if (!baseName) {
    return "";
  }

  const existing = new Set(
    editorState.placedFields
      .filter((field) => field.id !== fieldIdToExclude)
      .map((field) => field.name)
  );

  if (!existing.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (existing.has(`${baseName}_${suffix}`)) {
    suffix += 1;
  }

  return `${baseName}_${suffix}`;
}

function openFieldRenameModal(field) {
  if (!fieldRenameModal || !fieldRenameInput) {
    return;
  }

  editorState.pendingRenameFieldId = field.id;
  fieldRenameInput.value = field.name;
  fieldRenameModal.hidden = false;
  fieldRenameInput.focus();
  fieldRenameInput.select();
}

function closeFieldRenameModal() {
  if (fieldRenameModal) {
    fieldRenameModal.hidden = true;
  }
  editorState.pendingRenameFieldId = null;
}

function saveFieldRename() {
  const fieldId = editorState.pendingRenameFieldId;
  if (!fieldId) {
    closeFieldRenameModal();
    return;
  }

  const idx = editorState.placedFields.findIndex((field) => field.id === fieldId);
  if (idx === -1) {
    closeFieldRenameModal();
    return;
  }

  const uniqueName = getUniqueFieldName(fieldRenameInput?.value, fieldId);
  if (!uniqueName) {
    setStatus("Field name must include letters, numbers, or underscores.", true);
    fieldRenameInput?.focus();
    return;
  }

  editorState.placedFields[idx].name = uniqueName;
  redrawEditorMarkers();
  setStatus(`Field name saved as ${uniqueName}.`);
  closeFieldRenameModal();
}

function buildEditorFieldName() {
  const prefix = normalizePrefix(editorFieldPrefix?.value);
  const name = `${prefix}_${editorState.nextFieldIndex}`;
  editorState.nextFieldIndex += 1;
  return name;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getEditorPointerPoint(event) {
  const rect = editorClickLayer.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, editorCanvas.width);
  const y = clamp(event.clientY - rect.top, 0, editorCanvas.height);
  return { x, y };
}

function getDefaultPdfFieldSize() {
  const width = Math.max(48, Number(editorFieldWidth?.value) || 160);
  const height = Math.max(18, Number(editorFieldHeight?.value) || 24);
  return { width, height };
}

function getDefaultScreenRect(anchorX, anchorY) {
  const defaultSize = getDefaultPdfFieldSize();
  return {
    left: anchorX,
    top: anchorY,
    width: defaultSize.width * editorState.scale,
    height: defaultSize.height * editorState.scale
  };
}

function normalizeScreenRect(rect) {
  const maxWidth = editorCanvas.width;
  const maxHeight = editorCanvas.height;

  const left = clamp(rect.left, 0, maxWidth);
  const top = clamp(rect.top, 0, maxHeight);
  const right = clamp(left + rect.width, left + 1, maxWidth);
  const bottom = clamp(top + rect.height, top + 1, maxHeight);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

function createPlacedFieldFromScreenRect(rect) {
  const normalized = normalizeScreenRect(rect);

  return {
    id: `${Date.now()}_${Math.random()}`,
    name: buildEditorFieldName(),
    screenX: normalized.left,
    screenY: normalized.top,
    screenWidth: normalized.width,
    screenHeight: normalized.height,
    pdfX: normalized.left / editorState.scale,
    pdfY: (editorCanvas.height - normalized.top - normalized.height) / editorState.scale,
    pdfWidth: normalized.width / editorState.scale,
    pdfHeight: normalized.height / editorState.scale
  };
}

function ensureDraftMarker() {
  if (!editorClickLayer) {
    return;
  }

  if (editorState.draftMarkerEl && !editorState.draftMarkerEl.isConnected) {
    editorState.draftMarkerEl = null;
  }

  if (editorState.draftMarkerEl) {
    return;
  }

  const marker = document.createElement("div");
  marker.className = "editor-marker editor-marker-draft";
  marker.hidden = true;
  editorClickLayer.appendChild(marker);
  editorState.draftMarkerEl = marker;
}

function showDraftMarker(rect) {
  ensureDraftMarker();
  if (!editorState.draftMarkerEl) {
    return;
  }

  const normalized = normalizeScreenRect(rect);
  const marker = editorState.draftMarkerEl;
  marker.hidden = false;
  marker.style.left = `${normalized.left}px`;
  marker.style.top = `${normalized.top}px`;
  marker.style.width = `${normalized.width}px`;
  marker.style.height = `${normalized.height}px`;

  const pdfWidth = Math.max(1, Math.round(normalized.width / editorState.scale));
  const pdfHeight = Math.max(1, Math.round(normalized.height / editorState.scale));
  marker.setAttribute("data-size", `${pdfWidth} x ${pdfHeight}`);
}

function hideDraftMarker() {
  if (editorState.draftMarkerEl) {
    editorState.draftMarkerEl.hidden = true;
  }
}

function getDragRect(dragState) {
  const deltaX = dragState.currentX - dragState.startX;
  const deltaY = dragState.currentY - dragState.startY;

  if (!dragState.moved) {
    return getDefaultScreenRect(dragState.startX, dragState.startY);
  }

  return {
    left: Math.min(dragState.startX, dragState.currentX),
    top: Math.min(dragState.startY, dragState.currentY),
    width: Math.max(24, Math.abs(deltaX)),
    height: Math.max(14, Math.abs(deltaY))
  };
}

function redrawEditorMarkers() {
  if (!editorClickLayer || !editorState.viewport) {
    return;
  }

  editorClickLayer.innerHTML = "";

  editorState.placedFields.forEach((field) => {
    const marker = document.createElement("div");
    marker.className = "editor-marker";
    marker.style.left = `${field.screenX}px`;
    marker.style.top = `${field.screenY}px`;
    marker.style.width = `${field.screenWidth}px`;
    marker.style.height = `${field.screenHeight}px`;

    const label = document.createElement("span");
    label.className = "editor-marker-label";
    label.textContent = field.name;
    marker.appendChild(label);
    editorClickLayer.appendChild(marker);
  });

  if (!editorFieldList) {
    return;
  }

  editorFieldList.innerHTML = editorState.placedFields
    .map(
      (field) => `
      <li>
        <span>${field.name}</span>
        <button type="button" data-editor-remove="${field.id}">Remove</button>
      </li>
    `
    )
    .join("");
}

async function renderEditorPdf(file) {
  if (!window.pdfjsLib) {
    throw new Error("PDF rendering is unavailable in this browser. Use external editor fallback.");
  }

  const bytes = await file.arrayBuffer();
  const loadingTask = window.pdfjsLib.getDocument({ data: bytes });
  editorState.pdfDoc = await loadingTask.promise;
  const page = await editorState.pdfDoc.getPage(1);
  editorState.viewport = page.getViewport({ scale: editorState.scale });

  const ctx = editorCanvas.getContext("2d", { alpha: false });
  editorCanvas.width = Math.floor(editorState.viewport.width);
  editorCanvas.height = Math.floor(editorState.viewport.height);

  editorClickLayer.style.width = `${editorCanvas.width}px`;
  editorClickLayer.style.height = `${editorCanvas.height}px`;

  await page.render({ canvasContext: ctx, viewport: editorState.viewport }).promise;
}

async function startManualEditor(pdfFile) {
  editorState.pdfFile = pdfFile;
  editorState.placedFields = [];
  editorState.nextFieldIndex = 1;
  editorState.dragState = null;
  redrawEditorMarkers();
  hideDraftMarker();
  setEditorVisible(true);

  try {
    setStatus("Opening field editor...");
    await renderEditorPdf(pdfFile);
    setActiveStep("editor");
    setStatus("Tap to place default-sized fields, or click/tap and drag to draw field boxes.");
  } catch (error) {
    setEditorVisible(false);
    setStatus(
      "Interactive editor unavailable. Download the PDF, add fields in an external editor, then upload again.",
      true
    );
  }
}

async function detectFields(allowManualPrompt = true) {
  const pdf = pdfInput.files?.[0];

  if (!pdf) {
    setStatus("Select a fillable PDF file first.", true);
    return;
  }

  try {
    showLoading("Uploading PDF and scanning fields...");
    setStatus("Reading PDF fields and building worksheet...");

    const fd = new FormData();
    fd.append("pdf", pdf);

    const response = await fetch("/api/fields", {
      method: "POST",
      body: fd
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Field detection failed.");
    }

    detectedFields = data.fields || [];
    if (!detectedFields.length) {
      setStatus("No fillable fields found.", true);

      if (allowManualPrompt) {
        const wantsManualInsertion = window.confirm(
          "No fields found. Do you want to add fields manually using the visual editor?"
        );

        if (wantsManualInsertion) {
          await startManualEditor(pdf);
          return;
        }
      }

      setStatus(
        "No fields found. Download the PDF, add fields in an external PDF editor, then upload again.",
        true
      );
      return;
    }

    setEditorVisible(false);
    renderWorksheet(detectedFields);
    setStatus(
      `Detected ${detectedFields.length} fields. Categories are now grouped into vertical rows.`
    );
    setActiveStep("worksheet");
  } catch (error) {
    setStatus(error.message || "Could not detect fields.", true);
  } finally {
    hideLoading();
  }
}

async function applyManualFields() {
  if (!editorState.pdfFile) {
    setStatus("Upload a PDF first.", true);
    return;
  }

  if (!editorState.placedFields.length) {
    setStatus("Place at least one field before applying.", true);
    return;
  }

  try {
    showLoading("Applying manual fields to uploaded PDF...");
    setStatus("Applying manual fields to PDF...");
    const fd = new FormData();
    fd.append("pdf", editorState.pdfFile);
    fd.append(
      "fields",
      JSON.stringify(
        editorState.placedFields.map((field) => ({
          name: field.name,
          pageIndex: 0,
          x: field.pdfX,
          y: field.pdfY,
          width: field.pdfWidth,
          height: field.pdfHeight
        }))
      )
    );

    const response = await fetch("/api/manual-fields", {
      method: "POST",
      body: fd
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: "Manual field apply failed." }));
      throw new Error(data.error || "Manual field apply failed.");
    }

    const blob = await response.blob();
    const sourceName = editorState.pdfFile.name.replace(/\.pdf$/i, "");
    const nextFile = new File([blob], `${sourceName}-manual.pdf`, {
      type: "application/pdf"
    });

    const transfer = new DataTransfer();
    transfer.items.add(nextFile);
    pdfInput.files = transfer.files;

    editorState.pdfFile = nextFile;
    setStatus("Manual fields applied. Re-detecting fields...");
    await detectFields(false);
  } catch (error) {
    setStatus(error.message || "Could not apply manual fields.", true);
  } finally {
    hideLoading();
  }
}

async function generateOutput() {
  const pdf = pdfInput.files?.[0];

  if (!pdf) {
    setStatus("Select a fillable PDF file first.", true);
    return;
  }

  const rows = collectRows();
  if (!rows.length) {
    setStatus(
      getCurrentMode() === "bulk"
        ? "Enter at least one worksheet row before generating."
        : "Enter values in the worksheet before generating.",
      true
    );
    return;
  }

  try {
    setStatus("Generating filled PDF...");
    downloadLink.hidden = true;

    if (currentDownloadUrl) {
      URL.revokeObjectURL(currentDownloadUrl);
      currentDownloadUrl = "";
    }

    const fd = new FormData();
    fd.append("pdf", pdf);
    fd.append("rows", JSON.stringify(rows));

    const response = await fetch("/api/generate", {
      method: "POST",
      body: fd
    });

    if (!response.ok) {
      const errorBody = await response.json();
      throw new Error(errorBody.error || "Generation failed.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    currentDownloadUrl = url;

    downloadLink.href = url;
    downloadLink.download = "filled-form.pdf";
    downloadLink.textContent = "Download Filled PDF";
    downloadLink.hidden = false;
    setStatus("Done. Download your filled PDF.");
    setActiveStep("generate");
  } catch (error) {
    setStatus(error.message || "Could not generate files.", true);
  }
}

stepTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.hidden) {
      return;
    }
    setActiveStep(tab.dataset.step);
  });
});

helpBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  setHelpVisible(helpPopover.hidden);
});

helpPopover?.addEventListener("click", (event) => {
  event.stopPropagation();
});

document.addEventListener("click", () => {
  setHelpVisible(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setHelpVisible(false);
  }
});

pdfInput?.addEventListener("change", () => {
  setEditorVisible(false);
  editorState.pdfFile = pdfInput.files?.[0] || null;
  editorState.placedFields = [];
  editorState.nextFieldIndex = 1;
  editorState.dragState = null;
  hideDraftMarker();
  if (editorFieldList) {
    editorFieldList.innerHTML = "";
  }
});

editorClickLayer?.addEventListener("pointerdown", (event) => {
  if (!editorState.viewport || !editorState.pdfFile || event.button > 0) {
    return;
  }

  const point = getEditorPointerPoint(event);

  editorState.dragState = {
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    currentX: point.x,
    currentY: point.y,
    moved: false
  };

  editorClickLayer.setPointerCapture(event.pointerId);
  showDraftMarker(getDefaultScreenRect(point.x, point.y));
  event.preventDefault();
});

editorClickLayer?.addEventListener("pointermove", (event) => {
  const dragState = editorState.dragState;
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  const point = getEditorPointerPoint(event);
  dragState.currentX = point.x;
  dragState.currentY = point.y;

  const movedX = Math.abs(dragState.currentX - dragState.startX);
  const movedY = Math.abs(dragState.currentY - dragState.startY);
  dragState.moved = movedX > DRAG_MOVE_THRESHOLD || movedY > DRAG_MOVE_THRESHOLD;

  showDraftMarker(getDragRect(dragState));
  event.preventDefault();
});

editorClickLayer?.addEventListener("pointerup", (event) => {
  const dragState = editorState.dragState;
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  const field = createPlacedFieldFromScreenRect(getDragRect(dragState));
  editorState.placedFields.push(field);
  editorState.dragState = null;
  hideDraftMarker();
  redrawEditorMarkers();
  openFieldRenameModal(field);

  if (editorClickLayer.hasPointerCapture(event.pointerId)) {
    editorClickLayer.releasePointerCapture(event.pointerId);
  }
  event.preventDefault();
});

editorClickLayer?.addEventListener("pointercancel", (event) => {
  const dragState = editorState.dragState;
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  editorState.dragState = null;
  hideDraftMarker();
  if (editorClickLayer.hasPointerCapture(event.pointerId)) {
    editorClickLayer.releasePointerCapture(event.pointerId);
  }
});

editorClickLayer?.addEventListener("lostpointercapture", () => {
  if (editorState.dragState) {
    editorState.dragState = null;
    hideDraftMarker();
  }
});

editorFieldList?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const id = target.dataset.editorRemove;
  if (!id) {
    return;
  }

  editorState.placedFields = editorState.placedFields.filter((field) => field.id !== id);
  redrawEditorMarkers();
});

fieldRenameSaveBtn?.addEventListener("click", saveFieldRename);

fieldRenameCancelBtn?.addEventListener("click", closeFieldRenameModal);

fieldRenameInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveFieldRename();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeFieldRenameModal();
  }
});

applyManualFieldsBtn?.addEventListener("click", applyManualFields);

clearEditorFieldsBtn?.addEventListener("click", () => {
  editorState.placedFields = [];
  redrawEditorMarkers();
  setStatus("Placed fields cleared.");
});

downloadCurrentPdfBtn?.addEventListener("click", () => {
  const pdf = editorState.pdfFile || pdfInput.files?.[0];
  if (!pdf) {
    setStatus("Upload a PDF first.", true);
    return;
  }

  const url = URL.createObjectURL(pdf);
  const link = document.createElement("a");
  link.href = url;
  link.download = pdf.name || "template.pdf";
  link.click();
  URL.revokeObjectURL(url);

  setStatus("PDF downloaded. Add fields in your editor, then upload it again.");
});

setActiveStep("upload");
setHelpVisible(false);
setEditorVisible(false);

detectFieldsBtn.addEventListener("click", () => detectFields(true));
generateBtn.addEventListener("click", generateOutput);
