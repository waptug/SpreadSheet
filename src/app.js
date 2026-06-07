import {
  FormulaEngine,
  cellId,
  compareCellIds,
  expandRange,
  parseCellId,
  rangeLabel,
  shiftFormulaReferences,
  updateFormulaReferencesForStructureChange
} from "./formulaEngine.js";

const ROWS = 256;
const COLS = 256;
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
const saveSheetFile = document.querySelector("#saveSheetFile");
const openSheetFile = document.querySelector("#openSheetFile");
const openSheetFileInput = document.querySelector("#openSheetFileInput");
const savedSheetSelect = document.querySelector("#savedSheetSelect");
const loadSheet = document.querySelector("#loadSheet");
const deleteSavedSheet = document.querySelector("#deleteSavedSheet");
const copyCells = document.querySelector("#copyCells");
const pasteCells = document.querySelector("#pasteCells");
const insertRowsAbove = document.querySelector("#insertRowsAbove");
const insertRowsBelow = document.querySelector("#insertRowsBelow");
const deleteRows = document.querySelector("#deleteRows");
const insertColumnsLeft = document.querySelector("#insertColumnsLeft");
const insertColumnsRight = document.querySelector("#insertColumnsRight");
const deleteColumns = document.querySelector("#deleteColumns");

const engine = new FormulaEngine(loadCells());
const cellInputs = new Map();
const columnHeaderButtons = [];
const rowHeaderButtons = [];
let selectedCell = "A1";
let selectionStart = "A1";
let selectionEnd = "A1";
let isSelecting = false;
let currentSheetName = loadCurrentSheetName();
let evaluation = engine.evaluateCells([selectedCell]);
let lastPaintedCellIds = new Set();
let lastRawCellIds = new Set();
let lastActiveColumnHeaderIndexes = new Set();
let lastActiveRowHeaderIndexes = new Set();
let copiedCells = null;

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

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && shouldUseGridClipboard(document.activeElement)) {
    event.preventDefault();
    copySelectedCells();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && shouldUseGridClipboard(document.activeElement)) {
    event.preventDefault();
    pasteCopiedCells();
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

saveSheetFile.addEventListener("click", async () => {
  await saveSheetToLocalFile();
  closeMenus();
});

openSheetFile.addEventListener("click", async () => {
  await openSheetFromLocalFile();
  closeMenus();
});

openSheetFileInput.addEventListener("change", async () => {
  const file = openSheetFileInput.files?.[0];
  if (!file) {
    return;
  }

  await loadSheetFile(file);
  openSheetFileInput.value = "";
});

loadSheet.addEventListener("click", () => {
  loadNamedSheet(savedSheetSelect.value);
});

deleteSavedSheet.addEventListener("click", () => {
  deleteNamedSheet(savedSheetSelect.value);
});

copyCells.addEventListener("click", () => {
  copySelectedCells();
  closeMenus();
});

pasteCells.addEventListener("click", () => {
  pasteCopiedCells();
  closeMenus();
});

insertRowsAbove.addEventListener("click", () => {
  insertRows("above");
  closeMenus();
});

insertRowsBelow.addEventListener("click", () => {
  insertRows("below");
  closeMenus();
});

deleteRows.addEventListener("click", () => {
  deleteSelectedRows();
  closeMenus();
});

insertColumnsLeft.addEventListener("click", () => {
  insertColumns("left");
  closeMenus();
});

insertColumnsRight.addEventListener("click", () => {
  insertColumns("right");
  closeMenus();
});

deleteColumns.addEventListener("click", () => {
  deleteSelectedColumns();
  closeMenus();
});

function buildGrid() {
  cellInputs.clear();
  columnHeaderButtons.length = 0;
  rowHeaderButtons.length = 0;
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
    columnHeaderButtons.push(button);
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
    rowHeaderButtons.push(rowButton);
    rowHeader.append(rowButton);
    tableRow.append(rowHeader);

    for (let col = 0; col < COLS; col += 1) {
      const id = cellId(row, col);
      const cell = document.createElement("td");
      const input = document.createElement("input");
      input.className = "cell-input";
      input.dataset.cell = id;
      cellInputs.set(id, input);
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

function copySelectedCells() {
  const range = selectedRangeBounds();
  const values = [];

  for (let row = range.firstRow; row <= range.lastRow; row += 1) {
    for (let col = range.firstCol; col <= range.lastCol; col += 1) {
      values.push({
        rowOffset: row - range.firstRow,
        colOffset: col - range.firstCol,
        raw: engine.getRaw(cellId(row, col))
      });
    }
  }

  copiedCells = {
    sourceFirstRow: range.firstRow,
    sourceFirstCol: range.firstCol,
    rowCount: range.lastRow - range.firstRow + 1,
    colCount: range.lastCol - range.firstCol + 1,
    values
  };
  syncFileMenuState();
}

function pasteCopiedCells() {
  if (!copiedCells) {
    return false;
  }

  const destination = parseCellId(selectedCell);
  let lastRow = destination.row;
  let lastCol = destination.col;

  for (const value of copiedCells.values) {
    const sourceRow = copiedCells.sourceFirstRow + value.rowOffset;
    const sourceCol = copiedCells.sourceFirstCol + value.colOffset;
    const destinationRow = destination.row + value.rowOffset;
    const destinationCol = destination.col + value.colOffset;

    if (!isVisiblePosition(destinationRow, destinationCol)) {
      continue;
    }

    const destinationId = cellId(destinationRow, destinationCol);
    const raw = value.raw.trim().startsWith("=")
      ? shiftFormulaReferences(value.raw, destinationRow - sourceRow, destinationCol - sourceCol, {
          maxRows: ROWS,
          maxCols: COLS
        })
      : value.raw;

    engine.setCell(destinationId, raw);
    lastRow = Math.max(lastRow, destinationRow);
    lastCol = Math.max(lastCol, destinationCol);
  }

  saveCells();
  selectionStart = selectedCell;
  selectionEnd = cellId(lastRow, lastCol);
  render();
  return true;
}

function insertRows(position) {
  const range = selectedRangeBounds();
  const requestedCount = range.lastRow - range.firstRow + 1;
  const index = position === "below" ? range.lastRow + 1 : range.firstRow;
  const count = Math.min(requestedCount, ROWS - index);

  if (count <= 0) {
    window.alert("There is no room to insert more rows.");
    return false;
  }

  applyStructureChange({ type: "insert", axis: "row", index, count, maxRows: ROWS, maxCols: COLS });
  selectRange(cellId(index, 0), cellId(index + count - 1, COLS - 1));
  return true;
}

function deleteSelectedRows() {
  const range = selectedRangeBounds();
  const count = range.lastRow - range.firstRow + 1;

  if (!window.confirm(`Delete ${count} selected row${count === 1 ? "" : "s"}?`)) {
    return false;
  }

  applyStructureChange({ type: "delete", axis: "row", index: range.firstRow, count, maxRows: ROWS, maxCols: COLS });
  const row = Math.min(range.firstRow, ROWS - 1);
  selectCell(cellId(row, range.firstCol), { focus: true });
  return true;
}

function insertColumns(position) {
  const range = selectedRangeBounds();
  const requestedCount = range.lastCol - range.firstCol + 1;
  const index = position === "right" ? range.lastCol + 1 : range.firstCol;
  const count = Math.min(requestedCount, COLS - index);

  if (count <= 0) {
    window.alert("There is no room to insert more columns.");
    return false;
  }

  applyStructureChange({ type: "insert", axis: "col", index, count, maxRows: ROWS, maxCols: COLS });
  selectRange(cellId(0, index), cellId(ROWS - 1, index + count - 1));
  return true;
}

function deleteSelectedColumns() {
  const range = selectedRangeBounds();
  const count = range.lastCol - range.firstCol + 1;

  if (!window.confirm(`Delete ${count} selected column${count === 1 ? "" : "s"}?`)) {
    return false;
  }

  applyStructureChange({ type: "delete", axis: "col", index: range.firstCol, count, maxRows: ROWS, maxCols: COLS });
  const col = Math.min(range.firstCol, COLS - 1);
  selectCell(cellId(range.firstRow, col), { focus: true });
  return true;
}

function applyStructureChange(change) {
  const nextCells = {};

  for (const [id, raw] of engine.rawCells.entries()) {
    const current = parseCellId(id);
    const next = adjustedCellPosition(current, change);

    if (!next) {
      continue;
    }

    nextCells[cellId(next.row, next.col)] = updateFormulaReferencesForStructureChange(raw, change);
  }

  engine.setCells(nextCells);
  saveCells();
}

function adjustedCellPosition(parsed, change) {
  if (!parsed) {
    return null;
  }

  const row = adjustedPositionCoordinate(parsed.row, change, "row");
  const col = adjustedPositionCoordinate(parsed.col, change, "col");

  if (row === null || col === null || !isVisiblePosition(row, col)) {
    return null;
  }

  return { row, col };
}

function adjustedPositionCoordinate(value, change, axis) {
  if (change.axis !== axis) {
    return value;
  }

  if (change.type === "insert") {
    return value >= change.index ? value + change.count : value;
  }

  const deletedEnd = change.index + change.count - 1;
  if (value >= change.index && value <= deletedEnd) {
    return null;
  }

  return value > deletedEnd ? value - change.count : value;
}

function updateCell(id, value) {
  engine.setCell(id, value);
  saveCells();
  render();
}

function render() {
  evaluation = engine.evaluateCells([selectedCell]);
  const selectedMeta = getCellMeta(selectedCell);
  const dependencies = new Set(selectedMeta?.dependencies ?? []);
  const dependents = new Set(evaluation.dependents[selectedCell] ?? []);
  const selectedRange = new Set(getSelectedRangeCells());
  const activeElement = document.activeElement;
  const currentRawCellIds = new Set(engine.rawCells.keys());
  const currentPaintedCellIds = new Set([
    selectedCell,
    ...selectedRange,
    ...dependencies,
    ...dependents
  ]);
  const cellsToPaint = new Set([
    ...lastPaintedCellIds,
    ...currentPaintedCellIds,
    ...lastRawCellIds,
    ...currentRawCellIds
  ]);

  for (const id of cellsToPaint) {
    if (isVisibleCell(id)) {
      paintCell(id, {
        activeElement,
        dependencies,
        dependents,
        selectedRange
      });
    }
  }

  lastPaintedCellIds = currentPaintedCellIds;
  lastRawCellIds = currentRawCellIds;

  addressBox.value = currentSelectionLabel();
  formulaBar.value = activeElement === formulaBar ? formulaBar.value : engine.getRaw(selectedCell);
  statusSheet.textContent = currentSheetName || "Unsaved sheet";
  statusCell.textContent = selectedCell;
  statusValue.textContent = statusText(selectedMeta);
  syncFileMenuState();
  updateHeaderState();
}

function paintCell(id, state) {
  const input = getCellInput(id);
  if (!input) {
    return;
  }

  const meta = getCellMeta(id);
  const isActive = state.activeElement === input;
  const isFormula = meta.raw.trim().startsWith("=");

  if (!isActive && input.value !== meta.display) {
    input.value = meta.display;
  }

  input.classList.toggle("selected", id === selectedCell);
  input.classList.toggle("range", state.selectedRange.has(id));
  input.classList.toggle("dependency", state.dependencies.has(id));
  input.classList.toggle("dependent", state.dependents.has(id));
  input.classList.toggle("formula", isFormula);
  input.classList.toggle("error", meta.value.type === "error");
  input.title = isFormula ? `${meta.raw} = ${meta.display}` : meta.raw;
}

function getCellMeta(id) {
  return (
    evaluation.cells[id] ?? {
      raw: engine.getRaw(id),
      value: { type: "blank", value: null },
      display: "",
      dependencies: []
    }
  );
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

function updateHeaderState() {
  const range = selectedRangeBounds();
  const activeColumns = new Set();
  const activeRows = new Set();

  if (range.firstRow === 0 && range.lastRow === ROWS - 1) {
    for (let col = range.firstCol; col <= range.lastCol; col += 1) {
      activeColumns.add(col);
    }
  }

  if (range.firstCol === 0 && range.lastCol === COLS - 1) {
    for (let row = range.firstRow; row <= range.lastRow; row += 1) {
      activeRows.add(row);
    }
  }

  for (const col of new Set([...lastActiveColumnHeaderIndexes, ...activeColumns])) {
    columnHeaderButtons[col]?.classList.toggle("active", activeColumns.has(col));
  }

  for (const row of new Set([...lastActiveRowHeaderIndexes, ...activeRows])) {
    rowHeaderButtons[row]?.classList.toggle("active", activeRows.has(row));
  }

  lastActiveColumnHeaderIndexes = activeColumns;
  lastActiveRowHeaderIndexes = activeRows;
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

function getCellInput(id) {
  return cellInputs.get(id) ?? null;
}

function isCellInput(element) {
  return element?.classList?.contains("cell-input") ?? false;
}

function shouldUseGridClipboard(element) {
  return isCellInput(element) && element.selectionStart === element.selectionEnd;
}

function isVisibleCell(id) {
  const parsed = parseCellId(id);
  return parsed && isVisiblePosition(parsed.row, parsed.col);
}

function isVisiblePosition(row, col) {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

function selectedRangeBounds() {
  const start = parseCellId(selectionStart);
  const end = parseCellId(selectionEnd);

  return {
    firstRow: Math.min(start.row, end.row),
    lastRow: Math.max(start.row, end.row),
    firstCol: Math.min(start.col, end.col),
    lastCol: Math.max(start.col, end.col)
  };
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
  return normalizeSheetName(window.localStorage.getItem(CURRENT_SHEET_NAME_KEY) ?? "");
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

async function saveSheetToLocalFile() {
  const payload = createSheetFilePayload();
  const fileName = fileNameFromSheetName(payload.name);
  const content = `${JSON.stringify(payload, null, 2)}\n`;

  if ("showSaveFilePicker" in window) {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "Spreadsheet JSON",
            accept: {
              "application/json": [".json", ".spreadsheet"]
            }
          }
        ]
      });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        return false;
      }

      window.alert("The browser could not write directly to that file. A download will be created instead.");
    }
  }

  downloadTextFile(content, fileName);
  return true;
}

async function openSheetFromLocalFile() {
  if ("showOpenFilePicker" in window) {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Spreadsheet JSON",
            accept: {
              "application/json": [".json", ".spreadsheet"]
            }
          }
        ]
      });
      const file = await fileHandle.getFile();
      return loadSheetFile(file);
    } catch (error) {
      if (error?.name === "AbortError") {
        return false;
      }

      window.alert("The browser could not open that file directly. Use the file picker fallback instead.");
    }
  }

  openSheetFileInput.value = "";
  openSheetFileInput.click();
  return true;
}

async function loadSheetFile(file) {
  try {
    return loadSheetFileText(await file.text(), file.name);
  } catch {
    window.alert("The selected file could not be read.");
    return false;
  }
}

function loadSheetFileText(text, fileName) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    window.alert("The selected file is not valid JSON.");
    return false;
  }

  const sheetFile = parseSheetFilePayload(parsed, fileName);
  if (!sheetFile) {
    window.alert("The selected file does not contain a valid spreadsheet.");
    return false;
  }

  if (!window.confirm(`Open "${sheetFile.name}" and replace the current sheet?`)) {
    return false;
  }

  engine.setCells(sheetFile.cells);
  currentSheetName = sheetFile.name;
  window.localStorage.setItem(CURRENT_SHEET_NAME_KEY, sheetFile.name);
  saveCells();
  resetSelection();
  refreshSavedSheetSelect();
  render();
  return true;
}

function createSheetFilePayload() {
  return {
    app: "spreadsheet",
    version: 1,
    name: currentSheetName || "Untitled Sheet",
    rows: ROWS,
    columns: COLS,
    savedAt: new Date().toISOString(),
    cells: serializeCells()
  };
}

function parseSheetFilePayload(payload, fileName) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const hasCellsObject =
    payload.cells && typeof payload.cells === "object" && !Array.isArray(payload.cells);
  const rawCells = hasCellsObject ? payload.cells : payload;
  const cells = sanitizeCells(rawCells);

  if (!hasCellsObject && Object.keys(cells).length === 0) {
    return null;
  }

  return {
    name: normalizeSheetName(payload.name) || sheetNameFromFileName(fileName) || "Imported Sheet",
    cells
  };
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
  pasteCells.disabled = !copiedCells;
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

function fileNameFromSheetName(name) {
  const safeName = normalizeSheetName(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return `${safeName || "spreadsheet"}.spreadsheet.json`;
}

function sheetNameFromFileName(fileName) {
  return normalizeSheetName(
    String(fileName ?? "")
      .replace(/\.spreadsheet\.json$/i, "")
      .replace(/\.json$/i, "")
      .replace(/\.spreadsheet$/i, "")
  );
}

function downloadTextFile(content, fileName) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
