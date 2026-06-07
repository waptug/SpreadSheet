export const ERRORS = Object.freeze({
  CYCLE: "#CYCLE!",
  DIV0: "#DIV/0!",
  NAME: "#NAME?",
  REF: "#REF!",
  VALUE: "#VALUE!"
});

const CELL_RE = /^([A-Z]+)([1-9][0-9]*)$/i;
const MAX_RANGE_CELLS = 256 * 256;

class FormulaException extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function columnLabel(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError("Column index must be a non-negative integer.");
  }

  let value = index + 1;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

export function cellId(rowIndex, colIndex) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new RangeError("Row index must be a non-negative integer.");
  }

  return `${columnLabel(colIndex)}${rowIndex + 1}`;
}

export function parseCellId(id) {
  const match = String(id).trim().match(CELL_RE);
  if (!match) {
    return null;
  }

  const [, columnPart, rowPart] = match;
  let colIndex = 0;

  for (const character of columnPart.toUpperCase()) {
    colIndex = colIndex * 26 + character.charCodeAt(0) - 64;
  }

  return {
    id: `${columnPart.toUpperCase()}${Number(rowPart)}`,
    row: Number(rowPart) - 1,
    col: colIndex - 1
  };
}

export function normalizeCellId(id) {
  const parsed = parseCellId(id);
  if (!parsed) {
    throw new FormulaException(ERRORS.REF);
  }

  return parsed.id;
}

export function compareCellIds(left, right) {
  const parsedLeft = parseCellId(left);
  const parsedRight = parseCellId(right);

  if (!parsedLeft || !parsedRight) {
    return String(left).localeCompare(String(right));
  }

  return parsedLeft.row - parsedRight.row || parsedLeft.col - parsedRight.col;
}

export function rangeLabel(startId, endId) {
  const start = parseCellId(startId);
  const end = parseCellId(endId);
  if (!start || !end) {
    throw new FormulaException(ERRORS.REF);
  }

  const firstRow = Math.min(start.row, end.row);
  const lastRow = Math.max(start.row, end.row);
  const firstCol = Math.min(start.col, end.col);
  const lastCol = Math.max(start.col, end.col);
  const first = cellId(firstRow, firstCol);
  const last = cellId(lastRow, lastCol);

  return first === last ? first : `${first}:${last}`;
}

export function expandRange(startId, endId) {
  const start = parseCellId(startId);
  const end = parseCellId(endId);
  if (!start || !end) {
    throw new FormulaException(ERRORS.REF);
  }

  const firstRow = Math.min(start.row, end.row);
  const lastRow = Math.max(start.row, end.row);
  const firstCol = Math.min(start.col, end.col);
  const lastCol = Math.max(start.col, end.col);
  const total = (lastRow - firstRow + 1) * (lastCol - firstCol + 1);

  if (total > MAX_RANGE_CELLS) {
    throw new FormulaException(ERRORS.REF);
  }

  const ids = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = firstCol; col <= lastCol; col += 1) {
      ids.push(cellId(row, col));
    }
  }

  return ids;
}

export class FormulaEngine {
  constructor(rawCells = {}) {
    this.rawCells = new Map();
    this.setCells(rawCells);
  }

  setCells(rawCells = {}) {
    this.rawCells.clear();

    for (const [id, value] of Object.entries(rawCells)) {
      this.setCell(id, value);
    }
  }

  setCell(id, value) {
    const normalizedId = normalizeCellId(id);
    const rawValue = String(value ?? "");

    if (rawValue === "") {
      this.rawCells.delete(normalizedId);
      return;
    }

    this.rawCells.set(normalizedId, rawValue);
  }

  getRaw(id) {
    return this.rawCells.get(normalizeCellId(id)) ?? "";
  }

  evaluateCells(targetIds = []) {
    const memo = new Map();
    const dependencies = new Map();
    const cells = {};
    const ids = new Set([...this.rawCells.keys()]);

    for (const id of targetIds) {
      ids.add(normalizeCellId(id));
    }

    const evaluateCell = (id, stack = []) => {
      const normalizedId = normalizeCellId(id);

      if (memo.has(normalizedId)) {
        return memo.get(normalizedId);
      }

      if (stack.includes(normalizedId)) {
        return errorValue(ERRORS.CYCLE);
      }

      const raw = this.rawCells.get(normalizedId) ?? "";
      const value = evaluateRaw(raw, {
        cellId: normalizedId,
        dependencies,
        evaluateCell,
        stack: [...stack, normalizedId]
      });

      memo.set(normalizedId, value);
      return value;
    };

    for (const id of [...ids].sort(compareCellIds)) {
      const value = evaluateCell(id);
      const directDependencies = [...(dependencies.get(id) ?? [])].sort(compareCellIds);
      cells[id] = {
        raw: this.rawCells.get(id) ?? "",
        value,
        display: formatValue(value),
        dependencies: directDependencies
      };
    }

    return {
      cells,
      dependencies: Object.fromEntries(
        Object.entries(cells).map(([id, cell]) => [id, cell.dependencies])
      ),
      dependents: buildDependents(cells)
    };
  }
}

function evaluateRaw(raw, context) {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return blankValue();
  }

  if (!trimmed.startsWith("=")) {
    return literalValue(raw);
  }

  const expression = trimmed.slice(1).trim();
  if (expression === "") {
    return errorValue(ERRORS.VALUE);
  }

  try {
    const parser = new Parser(tokenize(expression));
    const ast = parser.parse();
    return evaluateAst(ast, context);
  } catch (error) {
    if (error instanceof FormulaException) {
      return errorValue(error.code);
    }

    return errorValue(ERRORS.VALUE);
  }
}

function literalValue(raw) {
  const trimmed = raw.trim();
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
    return numberValue(Number(trimmed));
  }

  return textValue(raw);
}

function evaluateAst(node, context) {
  switch (node.type) {
    case "number":
      return numberValue(node.value);
    case "string":
      return textValue(node.value);
    case "cell":
      registerDependency(context, node.id);
      return context.evaluateCell(node.id, context.stack);
    case "range":
      return evaluateRange(node, context);
    case "unary":
      return evaluateUnary(node, context);
    case "binary":
      return evaluateBinary(node, context);
    case "call":
      return evaluateCall(node, context);
    default:
      throw new FormulaException(ERRORS.VALUE);
  }
}

function evaluateRange(node, context) {
  const values = [];
  for (const id of expandRange(node.start, node.end)) {
    registerDependency(context, id);
    values.push(context.evaluateCell(id, context.stack));
  }

  return rangeValue(values);
}

function evaluateUnary(node, context) {
  const value = evaluateAst(node.argument, context);
  const number = toNumber(value);

  if (isError(number)) {
    return number;
  }

  return numberValue(node.operator === "-" ? -number.value : number.value);
}

function evaluateBinary(node, context) {
  if (node.operator === "&") {
    const left = toText(evaluateAst(node.left, context));
    if (isError(left)) {
      return left;
    }

    const right = toText(evaluateAst(node.right, context));
    if (isError(right)) {
      return right;
    }

    return textValue(left.value + right.value);
  }

  const left = toNumber(evaluateAst(node.left, context));
  if (isError(left)) {
    return left;
  }

  const right = toNumber(evaluateAst(node.right, context));
  if (isError(right)) {
    return right;
  }

  switch (node.operator) {
    case "+":
      return numberValue(left.value + right.value);
    case "-":
      return numberValue(left.value - right.value);
    case "*":
      return numberValue(left.value * right.value);
    case "/":
      return right.value === 0 ? errorValue(ERRORS.DIV0) : numberValue(left.value / right.value);
    case "^":
      return numberValue(left.value ** right.value);
    default:
      throw new FormulaException(ERRORS.VALUE);
  }
}

function evaluateCall(node, context) {
  const name = node.name.toUpperCase();
  const args = node.args.map((arg) => evaluateAst(arg, context));

  if (!FUNCTIONS.has(name)) {
    return errorValue(ERRORS.NAME);
  }

  return FUNCTIONS.get(name)(args);
}

const FUNCTIONS = new Map([
  ["SUM", (args) => numberValue(numericArgs(args).reduce((sum, value) => sum + value, 0))],
  [
    "AVG",
    (args) => {
      const values = numericArgs(args);
      return values.length === 0
        ? numberValue(0)
        : numberValue(values.reduce((sum, value) => sum + value, 0) / values.length);
    }
  ],
  [
    "MIN",
    (args) => {
      const values = numericArgs(args);
      return values.length === 0 ? numberValue(0) : numberValue(Math.min(...values));
    }
  ],
  [
    "MAX",
    (args) => {
      const values = numericArgs(args);
      return values.length === 0 ? numberValue(0) : numberValue(Math.max(...values));
    }
  ],
  ["COUNT", (args) => numberValue(numericArgs(args).length)],
  ["CONCAT", (args) => textValue(textArgs(args).join(""))],
  [
    "LEN",
    (args) => {
      assertArgCount(args, 1, 1);
      return numberValue([...textArg(args, 0)].length);
    }
  ],
  [
    "LEFT",
    (args) => {
      assertArgCount(args, 1, 2);
      const text = [...textArg(args, 0)];
      const count = integerArg(args, 1, 1);
      if (count < 0) {
        throw new FormulaException(ERRORS.VALUE);
      }

      return textValue(text.slice(0, count).join(""));
    }
  ],
  [
    "RIGHT",
    (args) => {
      assertArgCount(args, 1, 2);
      const text = [...textArg(args, 0)];
      const count = integerArg(args, 1, 1);
      if (count < 0) {
        throw new FormulaException(ERRORS.VALUE);
      }

      return textValue(count === 0 ? "" : text.slice(-count).join(""));
    }
  ],
  [
    "MID",
    (args) => {
      assertArgCount(args, 3, 3);
      const text = [...textArg(args, 0)];
      const start = integerArg(args, 1);
      const count = integerArg(args, 2);
      if (start < 1 || count < 0) {
        throw new FormulaException(ERRORS.VALUE);
      }

      return textValue(text.slice(start - 1, start - 1 + count).join(""));
    }
  ],
  [
    "UPPER",
    (args) => {
      assertArgCount(args, 1, 1);
      return textValue(textArg(args, 0).toUpperCase());
    }
  ],
  [
    "LOWER",
    (args) => {
      assertArgCount(args, 1, 1);
      return textValue(textArg(args, 0).toLowerCase());
    }
  ],
  [
    "TRIM",
    (args) => {
      assertArgCount(args, 1, 1);
      return textValue(textArg(args, 0).trim().replace(/\s+/g, " "));
    }
  ],
  [
    "FIND",
    (args) => {
      assertArgCount(args, 2, 3);
      const search = textArg(args, 0);
      const text = textArg(args, 1);
      const start = integerArg(args, 2, 1);

      if (start < 1 || start > text.length + 1) {
        throw new FormulaException(ERRORS.VALUE);
      }

      const index = text.indexOf(search, start - 1);
      if (index === -1) {
        throw new FormulaException(ERRORS.VALUE);
      }

      return numberValue(index + 1);
    }
  ],
  [
    "REPLACE",
    (args) => {
      assertArgCount(args, 4, 4);
      const text = [...textArg(args, 0)];
      const start = integerArg(args, 1);
      const count = integerArg(args, 2);
      const replacement = textArg(args, 3);

      if (start < 1 || count < 0) {
        throw new FormulaException(ERRORS.VALUE);
      }

      const index = Math.min(start - 1, text.length);
      return textValue([...text.slice(0, index), replacement, ...text.slice(index + count)].join(""));
    }
  ]
]);

function numericArgs(args) {
  const values = [];

  for (const value of flattenValues(args)) {
    if (isError(value)) {
      throw new FormulaException(value.code);
    }

    if (value.type === "number") {
      values.push(value.value);
    }
  }

  return values;
}

function textArgs(args) {
  const values = [];

  for (const value of flattenValues(args)) {
    const text = toText(value);
    if (isError(text)) {
      throw new FormulaException(text.code);
    }

    values.push(text.value);
  }

  return values;
}

function textArg(args, index) {
  const text = toText(scalarArg(args, index));
  if (isError(text)) {
    throw new FormulaException(text.code);
  }

  return text.value;
}

function integerArg(args, index, fallback) {
  if (index >= args.length && fallback !== undefined) {
    return fallback;
  }

  const number = toNumber(scalarArg(args, index));
  if (isError(number)) {
    throw new FormulaException(number.code);
  }

  return Math.trunc(number.value);
}

function scalarArg(args, index) {
  const value = args[index] ?? blankValue();

  if (value.type === "range") {
    throw new FormulaException(ERRORS.VALUE);
  }

  if (isError(value)) {
    throw new FormulaException(value.code);
  }

  return value;
}

function assertArgCount(args, min, max = min) {
  if (args.length < min || args.length > max) {
    throw new FormulaException(ERRORS.VALUE);
  }
}

function flattenValues(values) {
  const flattened = [];

  for (const value of values) {
    if (value.type === "range") {
      flattened.push(...flattenValues(value.values));
      continue;
    }

    flattened.push(value);
  }

  return flattened;
}

function registerDependency(context, id) {
  if (!context.dependencies.has(context.cellId)) {
    context.dependencies.set(context.cellId, new Set());
  }

  context.dependencies.get(context.cellId).add(normalizeCellId(id));
}

function toNumber(value) {
  if (isError(value)) {
    return value;
  }

  if (value.type === "blank") {
    return numberValue(0);
  }

  if (value.type !== "number" || !Number.isFinite(value.value)) {
    return errorValue(ERRORS.VALUE);
  }

  return value;
}

function toText(value) {
  if (isError(value)) {
    return value;
  }

  if (value.type === "blank") {
    return textValue("");
  }

  if (value.type === "number") {
    return textValue(formatValue(value));
  }

  if (value.type === "text") {
    return value;
  }

  return errorValue(ERRORS.VALUE);
}

function blankValue() {
  return { type: "blank", value: null };
}

function numberValue(value) {
  if (!Number.isFinite(value)) {
    return errorValue(ERRORS.VALUE);
  }

  return { type: "number", value };
}

function textValue(value) {
  return { type: "text", value };
}

function errorValue(code) {
  return { type: "error", code, value: code };
}

function rangeValue(values) {
  return { type: "range", values };
}

function isError(value) {
  return value.type === "error";
}

export function formatValue(value) {
  if (value.type === "blank") {
    return "";
  }

  if (value.type === "error") {
    return value.code;
  }

  if (value.type === "text") {
    return value.value;
  }

  if (value.type === "range") {
    return ERRORS.VALUE;
  }

  if (Number.isInteger(value.value)) {
    return String(value.value);
  }

  return String(Number(value.value.toFixed(10)));
}

function buildDependents(cells) {
  const dependents = {};

  for (const [id, cell] of Object.entries(cells)) {
    for (const dependency of cell.dependencies) {
      if (!dependents[dependency]) {
        dependents[dependency] = [];
      }

      dependents[dependency].push(id);
    }
  }

  for (const id of Object.keys(dependents)) {
    dependents[id].sort(compareCellIds);
  }

  return dependents;
}

function tokenize(input) {
  const tokens = [];
  let index = 0;

  while (index < input.length) {
    const character = input[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(character)) {
      const match = input.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) {
        throw new FormulaException(ERRORS.VALUE);
      }

      tokens.push({ type: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }

    if (character === "\"") {
      let value = "";
      index += 1;

      while (index < input.length) {
        const next = input[index];

        if (next === "\"") {
          if (input[index + 1] === "\"") {
            value += "\"";
            index += 2;
            continue;
          }

          index += 1;
          tokens.push({ type: "string", value });
          value = null;
          break;
        }

        value += next;
        index += 1;
      }

      if (value !== null) {
        throw new FormulaException(ERRORS.VALUE);
      }

      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      const match = input.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      const value = match[0].toUpperCase();
      tokens.push({
        type: CELL_RE.test(value) ? "cell" : "identifier",
        value
      });
      index += match[0].length;
      continue;
    }

    if ("+-*/^&(),:".includes(character)) {
      tokens.push({ type: character, value: character });
      index += 1;
      continue;
    }

    throw new FormulaException(ERRORS.VALUE);
  }

  tokens.push({ type: "eof", value: "" });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.current = 0;
  }

  parse() {
    const expression = this.parseConcatenation();
    this.expect("eof");
    return expression;
  }

  parseConcatenation() {
    let node = this.parseAdditive();

    while (this.match("&")) {
      const operator = this.previous().value;
      const right = this.parseAdditive();
      node = { type: "binary", operator, left: node, right };
    }

    return node;
  }

  parseAdditive() {
    let node = this.parseMultiplicative();

    while (this.match("+") || this.match("-")) {
      const operator = this.previous().value;
      const right = this.parseMultiplicative();
      node = { type: "binary", operator, left: node, right };
    }

    return node;
  }

  parseMultiplicative() {
    let node = this.parsePower();

    while (this.match("*") || this.match("/")) {
      const operator = this.previous().value;
      const right = this.parsePower();
      node = { type: "binary", operator, left: node, right };
    }

    return node;
  }

  parsePower() {
    const node = this.parseUnary();

    if (this.match("^")) {
      const operator = this.previous().value;
      const right = this.parsePower();
      return { type: "binary", operator, left: node, right };
    }

    return node;
  }

  parseUnary() {
    if (this.match("+") || this.match("-")) {
      const operator = this.previous().value;
      return { type: "unary", operator, argument: this.parseUnary() };
    }

    return this.parsePrimary();
  }

  parsePrimary() {
    if (this.match("number")) {
      return { type: "number", value: this.previous().value };
    }

    if (this.match("string")) {
      return { type: "string", value: this.previous().value };
    }

    if (this.match("cell")) {
      const start = normalizeCellId(this.previous().value);

      if (this.match(":")) {
        const end = normalizeCellId(this.expect("cell").value);
        return { type: "range", start, end };
      }

      return { type: "cell", id: start };
    }

    if (this.match("identifier")) {
      const name = this.previous().value;
      this.expect("(");
      const args = [];

      if (!this.check(")")) {
        do {
          args.push(this.parseConcatenation());
        } while (this.match(","));
      }

      this.expect(")");
      return { type: "call", name, args };
    }

    if (this.match("(")) {
      const expression = this.parseConcatenation();
      this.expect(")");
      return expression;
    }

    throw new FormulaException(ERRORS.VALUE);
  }

  match(...types) {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }

    return false;
  }

  expect(type) {
    if (this.check(type)) {
      return this.advance();
    }

    throw new FormulaException(ERRORS.VALUE);
  }

  check(type) {
    return this.peek().type === type;
  }

  advance() {
    if (!this.check("eof")) {
      this.current += 1;
    }

    return this.previous();
  }

  peek() {
    return this.tokens[this.current];
  }

  previous() {
    return this.tokens[this.current - 1];
  }
}
