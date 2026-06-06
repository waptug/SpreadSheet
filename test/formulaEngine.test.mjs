import test from "node:test";
import assert from "node:assert/strict";
import { ERRORS, FormulaEngine } from "../src/formulaEngine.js";

test("recalculates dependent formulas when a referenced cell changes", () => {
  const engine = new FormulaEngine({
    A1: "2",
    B1: "=A1*3"
  });

  let result = engine.evaluateCells(["B1"]);
  assert.equal(result.cells.B1.display, "6");
  assert.deepEqual(result.cells.B1.dependencies, ["A1"]);

  engine.setCell("A1", "4");
  result = engine.evaluateCells(["B1"]);

  assert.equal(result.cells.B1.display, "12");
  assert.deepEqual(result.dependents.A1, ["B1"]);
});

test("evaluates row and column ranges", () => {
  const engine = new FormulaEngine({
    A1: "1",
    B1: "2",
    C1: "3",
    A2: "10",
    A3: "20",
    D1: "=SUM(A1:C1)",
    B3: "=AVG(A1:A3)"
  });

  const result = engine.evaluateCells(["D1", "B3"]);

  assert.equal(result.cells.D1.display, "6");
  assert.equal(result.cells.B3.display, "10.3333333333");
  assert.deepEqual(result.cells.D1.dependencies, ["A1", "B1", "C1"]);
  assert.deepEqual(result.cells.B3.dependencies, ["A1", "A2", "A3"]);
});

test("uses spreadsheet operator precedence", () => {
  const engine = new FormulaEngine({
    A1: "=2+3*4^2",
    A2: "=(2+3)*4^2"
  });

  const result = engine.evaluateCells(["A1", "A2"]);

  assert.equal(result.cells.A1.display, "50");
  assert.equal(result.cells.A2.display, "80");
});

test("handles cycles without hanging", () => {
  const engine = new FormulaEngine({
    A1: "=B1",
    B1: "=A1"
  });

  const result = engine.evaluateCells(["A1", "B1"]);

  assert.equal(result.cells.A1.display, ERRORS.CYCLE);
  assert.equal(result.cells.B1.display, ERRORS.CYCLE);
});

test("propagates calculation errors", () => {
  const engine = new FormulaEngine({
    A1: "hello",
    B1: "=A1+2",
    C1: "=1/0",
    D1: "=SUM(C1, 4)"
  });

  const result = engine.evaluateCells(["B1", "C1", "D1"]);

  assert.equal(result.cells.B1.display, ERRORS.VALUE);
  assert.equal(result.cells.C1.display, ERRORS.DIV0);
  assert.equal(result.cells.D1.display, ERRORS.DIV0);
});
