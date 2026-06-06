# Spreadsheet

A static spreadsheet application with editable cells, numeric and text formulas, range functions, dependency recalculation, and local browser persistence.

## Run

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:5173/` in a browser.

## Formula Examples

- `=A1+B1`
- `=A1*3`
- `=SUM(A1:A10)`
- `=AVG(A1:D1)`
- `=MIN(A1:C5)`
- `=MAX(A1:C5)`
- `=COUNT(A1:C5)`
- `=A1&" "&B1`
- `=CONCAT(A1, " ", B1)`
- `=LEN(A1)`
- `=LEFT(A1, 3)`
- `=RIGHT(A1, 3)`
- `=MID(A1, 2, 4)`
- `=UPPER(A1)`
- `=LOWER(A1)`
- `=TRIM(A1)`
- `=FIND("text", A1)`
- `=REPLACE(A1, 1, 4, "new")`

Formulas recalculate whenever referenced cells change. Circular references display `#CYCLE!`.

## Test

```sh
npm test
```
