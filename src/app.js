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

const sheet = document.querySelector("#sheet");
const addressBox = document.querySelector("#addressBox");
const formulaBar = document.querySelector("#formulaBar");
const statusCell = document.querySelector("#statusCell");
const statusValue = document.querySelector("#statusValue");
const clearSheet = document.querySelector("#clearSheet");

const engine = new FormulaEngine(loadCells());
const gridIds = createGridIds();
let evaluation = engine.evaluateCells(gridIds);
let selectedCell = "A1";
let selectionStart = "A1";
let selectionEnd = "A1";
let isSelecting = false;

buildGrid();
render();

document.addEventListener("pointerup", () => {
  isSelecting = false;
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
    insertFunction(button.dataset.insertFunction);
  });
});

clearSheet.addEventListener("click", () => {
  if (!window.confirm("Clear all cells?")) {
    return;
  }

  engine.setCells({});
  saveCells();
  render();
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
  statusCell.textContent = selectedCell;
  statusValue.textContent = statusText(selectedMeta);
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

function insertFunction(name) {
  const selectedCells = getSelectedRangeCells();
  const isSingleCell = selectedCells.length === 1;
  const label = isSingleCell ? "" : currentSelectionLabel();
  const formula = `=${name}(${label})`;
  const destination = isSingleCell ? selectedCell : suggestedFormulaDestination();

  selectedCell = destination;
  selectionStart = destination;
  selectionEnd = destination;
  engine.setCell(destination, formula);
  saveCells();
  formulaBar.value = formula;
  render();
  getCellInput(destination)?.focus();
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
    JSON.stringify(Object.fromEntries([...engine.rawCells.entries()].sort(([a], [b]) => compareCellIds(a, b))))
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
