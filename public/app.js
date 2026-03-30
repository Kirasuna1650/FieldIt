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
const installBtn = document.getElementById("installBtn");
const iosInstallHint = document.getElementById("iosInstallHint");
const iosInstallDismissBtn = document.getElementById("iosInstallDismissBtn");
const manualFieldsPanel = document.getElementById("manualFieldsPanel");
const manualFieldInput = document.getElementById("manualFieldInput");
const addManualFieldBtn = document.getElementById("addManualFieldBtn");
const manualFieldList = document.getElementById("manualFieldList");
const buildManualWorksheetBtn = document.getElementById("buildManualWorksheetBtn");
const clearManualFieldsBtn = document.getElementById("clearManualFieldsBtn");
const helpBtn = document.getElementById("helpBtn");
const helpPopover = document.getElementById("helpPopover");
const panelNavSlots = Array.from(document.querySelectorAll(".panel-nav-slot"));
const stepTabs = Array.from(document.querySelectorAll(".step-tab"));
const stepPanels = Array.from(document.querySelectorAll(".step-panel"));
const BULK_MODE_ENABLED = false;
const IOS_INSTALL_HINT_DISMISSED_KEY = "fieldit-ios-install-hint-dismissed";

let detectedFields = [];
let rowCount = 0;
let currentDownloadUrl = "";
let installPromptEvent = null;
let manualFieldNames = [];
let groupedFields = {
  staticFields: [],
  repeating: null
};

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

function normalizeFieldName(name) {
  return String(name || "").trim();
}

function mapFieldNamesToSchema(names) {
  return names.map((name) => ({ name, type: "manual" }));
}

function renderManualFieldList() {
  if (!manualFieldList) {
    return;
  }

  if (!manualFieldNames.length) {
    manualFieldList.innerHTML = "";
    return;
  }

  manualFieldList.innerHTML = manualFieldNames
    .map(
      (name) => `
      <li>
        <span>${name}</span>
        <button type="button" data-manual-remove="${name}">Remove</button>
      </li>
    `
    )
    .join("");
}

function setManualFieldsVisible(visible) {
  if (!manualFieldsPanel) {
    return;
  }
  manualFieldsPanel.hidden = !visible;
}

function isStandaloneMode() {
  const displayModeStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return displayModeStandalone || window.navigator.standalone === true;
}

function isIosSafari() {
  const ua = window.navigator.userAgent || "";
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return isIos && isSafari;
}

function shouldShowIosInstallHint() {
  const wasDismissed =
    window.localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY) === "1";
  return isIosSafari() && !isStandaloneMode() && !installPromptEvent && !wasDismissed;
}

function updateIosInstallHintVisibility() {
  if (!iosInstallHint) {
    return;
  }
  iosInstallHint.hidden = !shouldShowIosInstallHint();
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
  setManualFieldsVisible(false);
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

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const colgroup = document.createElement("colgroup");

  const indexTh = document.createElement("th");
  indexTh.textContent = "#";
  const indexCol = createColWithWidth(56);
  colgroup.appendChild(indexCol);
  headerRow.appendChild(indexTh);

  if (getCurrentMode() === "bulk" && !groupedFields.repeating) {
    const fileTh = document.createElement("th");
    fileTh.textContent = "Output Name";
    const fileCol = createColWithWidth(170);
    colgroup.appendChild(fileCol);
    attachColumnResizer(fileTh, fileCol, 120);
    headerRow.appendChild(fileTh);
  }

  const categories = groupedFields.repeating
    ? groupedFields.repeating.categories
    : fields.map((field) => field.name);

  categories.forEach((category) => {
    const th = document.createElement("th");
    th.textContent = category;
    const dataCol = createColWithWidth(210);
    colgroup.appendChild(dataCol);
    attachColumnResizer(th, dataCol, 110);
    headerRow.appendChild(th);
  });

  if (getCurrentMode() !== "single") {
    const actionTh = document.createElement("th");
    actionTh.textContent = "Actions";
    const actionCol = createColWithWidth(96);
    colgroup.appendChild(actionCol);
    headerRow.appendChild(actionTh);
  }

  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  worksheetTable.innerHTML = "";
  worksheetTable.appendChild(colgroup);
  worksheetTable.appendChild(thead);
  worksheetTable.appendChild(tbody);

  const defaultRows = groupedFields.repeating
    ? groupedFields.repeating.indices.length || 3
    : getCurrentMode() === "bulk"
      ? 3
      : 1;
  addRow(defaultRows);
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

function clearRows() {
  const tbody = worksheetTable.querySelector("tbody");
  if (!tbody) {
    return;
  }
  tbody.innerHTML = "";
  rowCount = 0;
}

function setHelpVisible(isVisible) {
  if (!helpPopover || !helpBtn) {
    return;
  }

  helpPopover.hidden = !isVisible;
  helpBtn.setAttribute("aria-expanded", isVisible ? "true" : "false");
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

  if (getCurrentMode() === "bulk") {
    const rows = [];
    tableRows.forEach((tr) => {
      const rowPayload = { ...staticValues };
      const filenameInput = tr.querySelector("input[data-filename='true']");
      if (filenameInput?.value?.trim()) {
        rowPayload.__filename = filenameInput.value.trim();
      }

      const fieldInputs = tr.querySelectorAll("input[data-field]");
      fieldInputs.forEach((input) => {
        rowPayload[input.dataset.field] = input.value;
      });

      const hasValue = Object.values(rowPayload).some(
        (value) => String(value || "").trim().length > 0
      );
      if (hasValue) {
        rows.push(rowPayload);
      }
    });

    return rows;
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

async function detectFields() {
  const pdf = pdfInput.files?.[0];

  if (!pdf) {
    setStatus("Select a fillable PDF file first.", true);
    return;
  }

  try {
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
      const useManualFields = window.confirm(
        "No fields were found in this PDF. Do you want to insert fields manually?"
      );

      if (useManualFields) {
        setManualFieldsVisible(true);
        setActiveStep("worksheet");
        worksheetContainer.classList.add("empty");
        worksheetContainer.textContent =
          "Add manual field names, then build the worksheet.";
        tableScroll.hidden = true;
        setStatus("Manual field mode enabled. Add fields to continue.");
      }

      return;
    }

    renderWorksheet(detectedFields);
    setStatus(
      `Detected ${detectedFields.length} fields. Categories are now grouped into vertical rows.`
    );
    setActiveStep("worksheet");
  } catch (error) {
    setStatus(error.message || "Could not detect fields.", true);
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
    setActiveStep(tab.dataset.step);
  });
});

if (bulkModeToggle) {
  // Reserved for future bulk-mode implementation.
  // bulkModeToggle.addEventListener("change", () => {
  //   if (!detectedFields.length) {
  //     return;
  //   }
  //   renderWorksheet(detectedFields);
  // });
}

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

setActiveStep("upload");
setHelpVisible(false);

detectFieldsBtn.addEventListener("click", detectFields);
generateBtn.addEventListener("click", generateOutput);

addManualFieldBtn?.addEventListener("click", () => {
  const fieldName = normalizeFieldName(manualFieldInput?.value);
  if (!fieldName) {
    return;
  }

  if (manualFieldNames.includes(fieldName)) {
    setStatus("That manual field already exists.", true);
    return;
  }

  manualFieldNames.push(fieldName);
  if (manualFieldInput) {
    manualFieldInput.value = "";
    manualFieldInput.focus();
  }
  renderManualFieldList();
});

manualFieldInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addManualFieldBtn?.click();
  }
});

manualFieldList?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const removeFieldName = target.dataset.manualRemove;
  if (!removeFieldName) {
    return;
  }

  manualFieldNames = manualFieldNames.filter((name) => name !== removeFieldName);
  renderManualFieldList();
});

buildManualWorksheetBtn?.addEventListener("click", () => {
  if (!manualFieldNames.length) {
    setStatus("Add at least one manual field first.", true);
    return;
  }

  detectedFields = mapFieldNamesToSchema(manualFieldNames);
  renderWorksheet(detectedFields);
  setStatus(`Manual worksheet built with ${manualFieldNames.length} fields.`);
});

clearManualFieldsBtn?.addEventListener("click", () => {
  manualFieldNames = [];
  renderManualFieldList();
  setStatus("Manual fields cleared.");
});

installBtn?.addEventListener("click", async () => {
  if (!installPromptEvent) {
    setStatus("Install prompt is not available on this device/browser.", true);
    return;
  }

  installPromptEvent.prompt();
  const choice = await installPromptEvent.userChoice;
  installPromptEvent = null;
  installBtn.hidden = true;

  if (choice.outcome === "accepted") {
    setStatus("App install started.");
    return;
  }

  setStatus("Install dismissed. You can continue in the browser.");
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPromptEvent = event;
  if (installBtn) {
    installBtn.hidden = false;
  }
  updateIosInstallHintVisibility();
});

window.addEventListener("appinstalled", () => {
  installPromptEvent = null;
  if (installBtn) {
    installBtn.hidden = true;
  }
  if (iosInstallHint) {
    iosInstallHint.hidden = true;
  }
  setStatus("App installed. Launch it from your home screen.");
});

iosInstallDismissBtn?.addEventListener("click", () => {
  window.localStorage.setItem(IOS_INSTALL_HINT_DISMISSED_KEY, "1");
  if (iosInstallHint) {
    iosInstallHint.hidden = true;
  }
});

updateIosInstallHintVisibility();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // App remains functional even if service worker registration fails.
    });
  });
}
