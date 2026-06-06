import {
  FormulaEngine,
  cellId,
  compareCellIds,
  expandRange,
  parseCellId,
  rangeLabel
} from "./formulaEngine.js";

const ROWS = 40;
const COLS = 16;
const STORAGE_KEY = "spreadsheet:v1";
const SAVED_SHEETS_KEY = "spreadsheet:savedSheets:v1";
const CURRENT_SHEET_NAME_KEY = "spreadsheet:currentSheetName:v1";

const sheet = document.querySelector("#sheet");
const addressBox = document.querySelector("#addressBox");
const formulaBar = document.querySelector("#formulaBar");
const statusCell = document.querySelector("#statusCell");
const statusSheet = document.querySelector("#statusSheet");
const statusValue = document.querySelector("#statusValue");
const newSheet = document.querySelector("#newSheet");
const saveSheet = document.querySelector("#saveSheet");
const saveSheetAs = document.querySelector("#saveSheetAs");
const savedSheetSelect = document.querySelector("#savedSheetSelect");
const loadSheet = document.querySelector("#loadSheet");
const deleteSavedSheet = document.querySelector("#deleteSavedSheet");

const engine = new FormulaEngine(loadCells());
const gridIds = createGridIds();
let evaluation = engine.evaluateCells(gridIds);
let selectedCell = "A1";
let selectionStart = "A1";
let selectionEnd = "A1";
let isSelecting = false;
let currentSheetName = loadCurrentSheetName();

buildGrid();
refreshSavedSheetSelect();
render();

document.addEventListener("pointerup", () => {
  isSelecting = false;
});

document.addEventListener("click", (event) => {
  document.querySelectorAll(".menu[open]").forEach((menu) => {
    if (!menu.contains(event.target)) {
      menu.removeAttribute("open");
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.querySelectorAll(".menu[open]").forEach((menu) => {
      menu.removeAttribute("open");
    });
  }
});

addressBox.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  const parsed = parseCellId(addressBox.value);

  if (!parsed || parsed.row >= ROWS || parsed.col >= COLS) {
    addressBox.value = currentSelectionLabel();
    return;
  }

  selectCell(parsed.id, { focus: true });
});

formulaBar.addEventListener("input", () => {
  updateCell(selectedCell, formulaBar.value);
  const activeCellInput = getCellInput(selectedCell);
  if (document.activeElement === activeCellInput) {
    activeCellInput.value = formulaBar.value;
  }
});

formulaBar.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    getCellInput(selectedCell)?.focus();
  }
});

document.querySelectorAll("[data-insert-function]").forEach((button) => {
  button.addEventListener("click", () => {
    insertFunction(button.dataset.insertFunction, button.dataset.functionTemplate);
    button.closest(".menu")?.removeAttribute("open");
  });
});

document.querySelectorAll(".menu").forEach((menu) => {
  menu.addEventListener("toggle", () => {
    if (!menu.open) {
      return;
    }

    document.querySelectorAll(".menu[open]").forEach((openMenu) => {
      if (openMenu !== menu) {
        openMenu.removeAttribute("open");
      }
    });
  });
});

newSheet.addEventListener("click", () => {
  if (!window.confirm("Start a blank sheet? Unsaved changes in the current sheet will be cleared.")) {
    return;
  }

  currentSheetName = "";
  window.localStorage.removeItem(CURRENT_SHEET_NAME_KEY);
  engine.setCells({});
  saveCells();
  resetSelection();
  render();
  closeMenus();
});

saveSheet.addEventListener("click", () => {
  const targetName = currentSheetName || promptForSheetName("Save sheet as", suggestedSheetName());
  if (!targetName) {
    return;
  }

  saveNamedSheet(targetName, { confirmOverwrite: !currentSheetName });
  closeMenus();
});

saveSheetAs.addEventListener("click", () => {
  const targetName = promptForSheetName("Save sheet as", currentSheetName || suggestedSheetName());
  if (!targetName) {
    return;
  }

  saveNamedSheet(targetName, { confirmOverwrite: true });
  closeMenus();
});

loadSheet.addEventListener("click", () => {
  loadNamedSheet(savedSheetSelect.value);
});

deleteSavedSheet.addEventListener("click", () => {
  deleteNamedSheet(savedSheetSelect.value);
});

function buildGrid() {
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "corner-header";
  headerRow.append(corner);

  for (let col = 0; col < COLS; col += 1) {
    const header = document.createElement("th");
    header.className = "column-header";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "header-button";
    button.textContent = cellId(0, col).replace(/\d+$/, "");
    button.addEventListener("click", () => selectRange(cellId(0, col), cellId(ROWS - 1, col)));
    header.append(button);
    headerRow.append(header);
  }

  thead.append(headerRow);

  const tbody = document.createElement("tbody");
  for (let row = 0; row < ROWS; row += 1) {
    const tableRow = document.createElement("tr");
    const rowHeader = document.createElement("th");
    rowHeader.className = "row-header";
    const rowButton = document.createElement("button");
    rowButton.type = "button";
    rowButton.className = "header-button";
    rowButton.textContent = String(row + 1);
    rowButton.addEventListener("click", () => selectRange(cellId(row, 0), cellId(row, COLS - 1)));
    rowHeader.append(rowButton);
    tableRow.append(rowHeader);

    for (let col = 0; col < COLS; col += 1) {
      const id = cellId(row, col);
      const cell = document.createElement("td");
      const input = document.createElement("input");
      input.className = "cell-input";
      input.dataset.cell = id;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.addEventListener("pointerdown", (event) => {
        const anchor = event.shiftKey ? selectionStart : id;
        isSelecting = true;
        selectRange(anchor, id, { focus: true });
      });
      input.addEventListener("pointerover", () => {
        if (isSelecting) {
          selectRange(selectionStart, id);
        }
      });
      input.addEventListener("focus", () => {
        selectedCell = id;
        formulaBar.value = engine.getRaw(id);
        input.value = engine.getRaw(id);
        render();
      });
      input.addEventListener("input", () => {
        updateCell(id, input.value);
      });
      input.addEventListener("keydown", (event) => handleCellKeydown(event, id));
      cell.append(input);
      tableRow.append(cell);
    }

    tbody.append(tableRow);
  }

  sheet.replaceChildren(thead, tbody);
}

function updateCell(id, value) {
  engine.setCell(id, value);
  saveCells();
  render();
}

function render() {
  evaluation = engine.evaluateCells(gridIds);
  const selectedMeta = evaluation.cells[selectedCell];
  const dependencies = new Set(selectedMeta?.dependencies ?? []);
  const dependents = new Set(evaluation.dependents[selectedCell] ?? []);
  const selectedRange = new Set(getSelectedRangeCells());
  const activeElement = document.activeElement;

  for (const id of gridIds) {
    const input = getCellInput(id);
    const meta = evaluation.cells[id];
    const isActive = activeElement === input;

    if (!isActive) {
      input.value = meta.display;
    }

    input.classList.toggle("selected", id === selectedCell);
    input.classList.toggle("range", selectedRange.has(id));
    input.classList.toggle("dependency", dependencies.has(id));
    input.classList.toggle("dependent", dependents.has(id));
    input.classList.toggle("formula", meta.raw.trim().startsWith("="));
    input.classList.toggle("error", meta.value.type === "error");
    input.title = meta.raw.trim().startsWith("=") ? `${meta.raw} = ${meta.display}` : meta.raw;
  }

  addressBox.value = currentSelectionLabel();
  formulaBar.value = activeElement === formulaBar ? formulaBar.value : engine.getRaw(selectedCell);
  statusSheet.textContent = currentSheetName || "Unsaved sheet";
  statusCell.textContent = selectedCell;
  statusValue.textContent = statusText(selectedMeta);
  syncFileMenuState();
  updateHeaderState(selectedRange);
}

function handleCellKeydown(event, id) {
  if (event.key === "Enter") {
    event.preventDefault();
    moveSelection(id, 1, 0);
  }

  if (event.key === "Tab") {
    event.preventDefault();
    moveSelection(id, 0, event.shiftKey ? -1 : 1);
  }
}

function moveSelection(id, rowDelta, colDelta) {
  const parsed = parseCellId(id);
  const row = clamp(parsed.row + rowDelta, 0, ROWS - 1);
  const col = clamp(parsed.col + colDelta, 0, COLS - 1);
  selectCell(cellId(row, col), { focus: true });
}

function selectCell(id, options = {}) {
  selectedCell = id;
  selectionStart = id;
  selectionEnd = id;
  render();

  if (options.focus) {
    getCellInput(id)?.focus();
  }
}

function selectRange(start, end, options = {}) {
  selectionStart = start;
  selectionEnd = end;
  selectedCell = end;
  render();

  if (options.focus) {
    getCellInput(end)?.focus();
  }
}

function insertFunction(name, template = `${name}()`) {
  const formula = `=${fillFunctionTemplate(template)}`;
  const destination = suggestedFormulaDestination();

  selectedCell = destination;
  selectionStart = destination;
  selectionEnd = destination;
  engine.setCell(destination, formula);
  saveCells();
  formulaBar.value = formula;
  render();
  getCellInput(destination)?.focus();
}

function fillFunctionTemplate(template) {
  return template.replaceAll("{range}", currentSelectionLabel()).replaceAll("{cell}", selectedCell);
}

function currentSelectionLabel() {
  return rangeLabel(selectionStart, selectionEnd);
}

function getSelectedRangeCells() {
  return expandRange(selectionStart, selectionEnd).filter(isVisibleCell);
}

function suggestedFormulaDestination() {
  const start = parseCellId(selectionStart);
  const end = parseCellId(selectionEnd);
  const firstRow = Math.min(start.row, end.row);
  const lastRow = Math.max(start.row, end.row);
  const firstCol = Math.min(start.col, end.col);
  const lastCol = Math.max(start.col, end.col);
  const width = lastCol - firstCol + 1;
  const height = lastRow - firstRow + 1;

  if (width >= height && lastCol + 1 < COLS) {
    return cellId(firstRow, lastCol + 1);
  }

  if (lastRow + 1 < ROWS) {
    return cellId(lastRow + 1, firstCol);
  }

  if (lastCol + 1 < COLS) {
    return cellId(firstRow, lastCol + 1);
  }

  return selectedCell;
}

function updateHeaderState(selectedRange) {
  document.querySelectorAll(".column-header .header-button").forEach((button, index) => {
    const columnCells = Array.from({ length: ROWS }, (_, row) => cellId(row, index));
    button.classList.toggle("active", columnCells.every((id) => selectedRange.has(id)));
  });

  document.querySelectorAll(".row-header .header-button").forEach((button, index) => {
    const rowCells = Array.from({ length: COLS }, (_, col) => cellId(index, col));
    button.classList.toggle("active", rowCells.every((id) => selectedRange.has(id)));
  });
}

function statusText(meta) {
  if (!meta || meta.display === "") {
    return "";
  }

  if (meta.raw.trim().startsWith("=")) {
    return meta.display;
  }

  return meta.raw;
}

function createGridIds() {
  const ids = [];

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      ids.push(cellId(row, col));
    }
  }

  return ids;
}

function getCellInput(id) {
  return sheet.querySelector(`[data-cell="${id}"]`);
}

function isVisibleCell(id) {
  const parsed = parseCellId(id);
  return parsed && parsed.row >= 0 && parsed.row < ROWS && parsed.col >= 0 && parsed.col < COLS;
}

function loadCells() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return Object.fromEntries(
      Object.entries(stored).filter(([id, value]) => parseCellId(id) && String(value) !== "")
    );
  } catch {
    return {};
  }
}

function saveCells() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(serializeCells())
  );
}

function loadCurrentSheetName() {
  const name = window.localStorage.getItem(CURRENT_SHEET_NAME_KEY) ?? "";
  return loadSavedSheets()[name] ? name : "";
}

function loadSavedSheets() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SAVED_SHEETS_KEY) ?? "{}");
    const sheets = stored.sheets && typeof stored.sheets === "object" ? stored.sheets : {};
    return Object.fromEntries(
      Object.entries(sheets)
        .map(([name, sheetRecord]) => {
          const normalizedName = normalizeSheetName(sheetRecord?.name ?? name);
          if (!normalizedName) {
            return null;
          }

          return [
            normalizedName,
            {
              name: normalizedName,
              cells: sanitizeCells(sheetRecord?.cells ?? {}),
              updatedAt: typeof sheetRecord?.updatedAt === "string" ? sheetRecord.updatedAt : ""
            }
          ];
        })
        .filter(Boolean)
        .sort(([a], [b]) => a.localeCompare(b))
    );
  } catch {
    return {};
  }
}

function saveSavedSheets(sheets) {
  const sortedSheets = Object.fromEntries(Object.entries(sheets).sort(([a], [b]) => a.localeCompare(b)));
  window.localStorage.setItem(
    SAVED_SHEETS_KEY,
    JSON.stringify({
      version: 1,
      sheets: sortedSheets
    })
  );
}

function saveNamedSheet(name, options = {}) {
  const normalizedName = normalizeSheetName(name);
  if (!normalizedName) {
    return false;
  }

  const savedSheets = loadSavedSheets();
  if (
    options.confirmOverwrite &&
    savedSheets[normalizedName] &&
    !window.confirm(`Replace saved sheet "${normalizedName}"?`)
  ) {
    return false;
  }

  savedSheets[normalizedName] = {
    name: normalizedName,
    cells: serializeCells(),
    updatedAt: new Date().toISOString()
  };
  saveSavedSheets(savedSheets);
  currentSheetName = normalizedName;
  window.localStorage.setItem(CURRENT_SHEET_NAME_KEY, normalizedName);
  refreshSavedSheetSelect();
  render();
  return true;
}

function loadNamedSheet(name) {
  const normalizedName = normalizeSheetName(name);
  const savedSheet = loadSavedSheets()[normalizedName];
  if (!savedSheet) {
    return false;
  }

  if (!window.confirm(`Load "${normalizedName}" and replace the current sheet?`)) {
    return false;
  }

  engine.setCells(savedSheet.cells);
  currentSheetName = normalizedName;
  window.localStorage.setItem(CURRENT_SHEET_NAME_KEY, normalizedName);
  saveCells();
  resetSelection();
  refreshSavedSheetSelect();
  render();
  closeMenus();
  return true;
}

function deleteNamedSheet(name) {
  const normalizedName = normalizeSheetName(name);
  const savedSheets = loadSavedSheets();

  if (!savedSheets[normalizedName]) {
    return false;
  }

  if (!window.confirm(`Delete saved sheet "${normalizedName}"?`)) {
    return false;
  }

  delete savedSheets[normalizedName];
  saveSavedSheets(savedSheets);

  if (currentSheetName === normalizedName) {
    currentSheetName = "";
    window.localStorage.removeItem(CURRENT_SHEET_NAME_KEY);
  }

  refreshSavedSheetSelect();
  render();
  closeMenus();
  return true;
}

function refreshSavedSheetSelect() {
  const savedSheets = loadSavedSheets();
  const names = Object.keys(savedSheets);

  savedSheetSelect.replaceChildren();

  if (names.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No saved sheets";
    savedSheetSelect.append(option);
    syncFileMenuState();
    return;
  }

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (savedSheets[name].updatedAt) {
      option.title = `Saved ${new Date(savedSheets[name].updatedAt).toLocaleString()}`;
    }
    savedSheetSelect.append(option);
  }

  savedSheetSelect.value = savedSheets[currentSheetName] ? currentSheetName : names[0];
  syncFileMenuState();
}

function syncFileMenuState() {
  const hasSavedSheet = Boolean(savedSheetSelect.value);
  loadSheet.disabled = !hasSavedSheet;
  deleteSavedSheet.disabled = !hasSavedSheet;
}

function serializeCells() {
  return Object.fromEntries([...engine.rawCells.entries()].sort(([a], [b]) => compareCellIds(a, b)));
}

function sanitizeCells(cells) {
  return Object.fromEntries(
    Object.entries(cells)
      .filter(([id, value]) => parseCellId(id) && String(value) !== "")
      .sort(([a], [b]) => compareCellIds(a, b))
  );
}

function promptForSheetName(message, fallback) {
  const name = window.prompt(message, fallback);
  return normalizeSheetName(name);
}

function normalizeSheetName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

function suggestedSheetName() {
  const savedSheets = loadSavedSheets();
  let index = Object.keys(savedSheets).length + 1;
  let name = `Sheet ${index}`;

  while (savedSheets[name]) {
    index += 1;
    name = `Sheet ${index}`;
  }

  return name;
}

function resetSelection() {
  selectedCell = "A1";
  selectionStart = "A1";
  selectionEnd = "A1";
}

function closeMenus() {
  document.querySelectorAll(".menu[open]").forEach((menu) => {
    menu.removeAttribute("open");
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
