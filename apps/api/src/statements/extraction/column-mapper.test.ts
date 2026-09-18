import { test } from "node:test";
import assert from "node:assert/strict";
import type { PositionedItem } from "../pdf-inspector";
import { detectHeaderColumns, parseStatementRowsDynamic } from "./column-mapper";

/** Builds one reconstructed row from `[text, x]` pairs — mirrors what
 * pdf-inspector.ts's row reconstruction hands the parser: word-level items
 * in left-to-right x order, y already collapsed away. */
function row(...cells: [string, number][]): PositionedItem[] {
  return cells.map(([str, x]) => ({ str, x, y: 0 }));
}

// Column starts spaced 200pt apart — generous enough that a multi-word cell
// (several words at columnStart, +36, +72, ...) never reaches into the next
// column's zone, so these tests exercise the column-assignment logic itself,
// not alignment edge cases (those are validated against the real statement
// separately).
const COLUMN_WIDTH = 500;
function col(index: number): number {
  return index * COLUMN_WIDTH;
}
/** Places `words` left-to-right within column `index`, 25pt apart — a
 * description can run to several words (e.g. "Pay Bill Online to 522533 -
 * Lipa na KCB") and still stay well inside the column's zone before the
 * 250pt-away midpoint boundary with the next column. */
function cell(index: number, ...words: string[]): [string, number][] {
  return words.map((word, i) => [word, col(index) + i * 25] as [string, number]);
}

// Standard order: Receipt(0) Completion Time(1) Details(2) Transaction Status(3) Paid In(4) Withdrawn(5) Balance(6)
const STANDARD_HEADER = row(
  ...cell(0, "Receipt", "No."),
  ...cell(1, "Completion", "Time"),
  ...cell(2, "Details"),
  ...cell(3, "Transaction", "Status"),
  ...cell(4, "Paid", "In"),
  ...cell(5, "Withdrawn"),
  ...cell(6, "Balance"),
);

test("detects the standard header layout and reports split Paid In/Withdrawn columns", () => {
  const map = detectHeaderColumns([STANDARD_HEADER]);
  assert.ok(map);
  assert.equal(map!.hasSplitAmounts, true);
  assert.equal(map!.hasStatus, true);
  assert.equal(map!.columns.map((c) => c.label).join(","), "RECEIPT,TIME,DETAILS,STATUS,PAID_IN,WITHDRAWN,BALANCE");
});

test("parses a credit and a debit row under the standard layout", () => {
  const creditRow = row(
    ...cell(0, "RJ81ABCD12"),
    ...cell(1, "2026-08-01", "09:15:23"),
    ...cell(2, "Customer", "Transfer", "to", "JOHN", "KAMAU"),
    ...cell(3, "Completed"),
    ...cell(4, "500.00"),
    ...cell(6, "23978.00"),
  );
  const debitRow = row(
    ...cell(0, "QA12345679"),
    ...cell(1, "2026-08-01", "10:02:11"),
    ...cell(2, "Pay", "Bill", "Online", "to", "522533", "-", "Lipa", "na", "KCB"),
    ...cell(3, "Completed"),
    ...cell(5, "-2,350.00"),
    ...cell(6, "21628.00"),
  );

  const result = parseStatementRowsDynamic([STANDARD_HEADER, creditRow, debitRow]);
  assert.ok(result);
  assert.equal(result!.unparsed.length, 0);
  assert.equal(result!.parsed.length, 2);

  const [credit, debit] = result!.parsed;
  assert.equal(credit!.referenceNumber, "RJ81ABCD12");
  assert.equal(credit!.amount.toFixed(2), "500.00");
  assert.equal(credit!.balance.toFixed(2), "23978.00");
  assert.equal(credit!.description, "Customer Transfer to JOHN KAMAU");

  assert.equal(debit!.referenceNumber, "QA12345679");
  assert.equal(debit!.amount.toFixed(2), "-2350.00");
  assert.ok(debit!.amount.isNegative());
});

test("still parses when the columns are declared in a completely different order", () => {
  // Balance first, Receipt last — the opposite of the real statement's order.
  const reorderedHeader = row(
    ...cell(0, "Balance"),
    ...cell(1, "Withdrawn"),
    ...cell(2, "Paid", "In"),
    ...cell(3, "Transaction", "Status"),
    ...cell(4, "Details"),
    ...cell(5, "Completion", "Time"),
    ...cell(6, "Receipt", "No."),
  );
  const dataRow = row(
    ...cell(0, "23978.00"),
    ...cell(2, "500.00"),
    ...cell(3, "Completed"),
    ...cell(4, "Customer", "Transfer", "to", "JOHN", "KAMAU"),
    ...cell(5, "2026-08-01", "09:15:23"),
    ...cell(6, "RJ81ABCD12"),
  );

  const result = parseStatementRowsDynamic([reorderedHeader, dataRow]);
  assert.ok(result);
  assert.equal(result!.unparsed.length, 0);
  assert.equal(result!.parsed.length, 1);
  assert.equal(result!.parsed[0]!.referenceNumber, "RJ81ABCD12");
  assert.equal(result!.parsed[0]!.amount.toFixed(2), "500.00");
  assert.equal(result!.parsed[0]!.balance.toFixed(2), "23978.00");
});

test("recognizes relabeled headers ('Money In'/'Money Out' instead of 'Paid In'/'Withdrawn')", () => {
  const header = row(
    ...cell(0, "Receipt", "No."),
    ...cell(1, "Completion", "Time"),
    ...cell(2, "Details"),
    ...cell(3, "Status"),
    ...cell(4, "Money", "In"),
    ...cell(5, "Money", "Out"),
    ...cell(6, "Balance"),
  );
  const map = detectHeaderColumns([header]);
  assert.ok(map);
  assert.equal(map!.hasSplitAmounts, true);
});

test("handles a merged signed 'Amount' column instead of split Paid In/Withdrawn", () => {
  const header = row(
    ...cell(0, "Receipt", "No."),
    ...cell(1, "Completion", "Time"),
    ...cell(2, "Details"),
    ...cell(3, "Status"),
    ...cell(4, "Amount"),
    ...cell(6, "Balance"),
  );
  const map = detectHeaderColumns([header]);
  assert.ok(map);
  assert.equal(map!.hasSplitAmounts, false);

  const debitRow = row(
    ...cell(0, "QA12345679"),
    ...cell(1, "2026-08-01", "10:02:11"),
    ...cell(2, "Airtime", "Purchase"),
    ...cell(3, "Completed"),
    ...cell(4, "-100.00"),
    ...cell(6, "21628.00"),
  );
  const result = parseStatementRowsDynamic([header, debitRow]);
  assert.ok(result);
  assert.equal(result!.unparsed.length, 0);
  assert.equal(result!.parsed[0]!.amount.toFixed(2), "-100.00");
});

test("parses slash-delimited and month-name date formats in the Time column", () => {
  const slashRow = row(
    ...cell(0, "RJ81ABCD12"),
    ...cell(1, "01/08/2026", "09:15:23"),
    ...cell(2, "Airtime", "Purchase"),
    ...cell(3, "Completed"),
    ...cell(4, "100.00"),
    ...cell(6, "21628.00"),
  );
  const monthNameRow = row(
    ...cell(0, "QA12345679"),
    ...cell(1, "01", "Aug", "2026", "09:15:23"),
    ...cell(2, "Airtime", "Purchase"),
    ...cell(3, "Completed"),
    ...cell(4, "100.00"),
    ...cell(6, "21728.00"),
  );

  const slashResult = parseStatementRowsDynamic([STANDARD_HEADER, slashRow]);
  assert.ok(slashResult);
  assert.equal(slashResult!.unparsed.length, 0);
  assert.equal(slashResult!.parsed[0]!.transactionDate.toISOString().slice(0, 10), "2026-08-01");

  const monthResult = parseStatementRowsDynamic([STANDARD_HEADER, monthNameRow]);
  assert.ok(monthResult);
  assert.equal(monthResult!.unparsed.length, 0);
  assert.equal(monthResult!.parsed[0]!.transactionDate.toISOString().slice(0, 10), "2026-08-01");
});

test("returns null (defer to the legacy fallback) when no row has a recognizable header", () => {
  const unrelated = row(["M-PESA", 0], ["STATEMENT", 100]);
  const customerLine = row(["Customer", 0], ["Name:", 100], ["JANE", 200], ["MUTHONI", 260]);
  assert.equal(parseStatementRowsDynamic([unrelated, customerLine]), null);
  assert.equal(detectHeaderColumns([unrelated, customerLine]), null);
});

test("flags a row where both Paid In and Withdrawn are filled as unparsed rather than guessing", () => {
  const ambiguousRow = row(
    ...cell(0, "RJ81ABCD12"),
    ...cell(1, "2026-08-01", "09:15:23"),
    ...cell(2, "Something", "Odd"),
    ...cell(3, "Completed"),
    ...cell(4, "500.00"),
    ...cell(5, "-100.00"),
    ...cell(6, "23978.00"),
  );
  const result = parseStatementRowsDynamic([STANDARD_HEADER, ambiguousRow]);
  assert.ok(result);
  assert.equal(result!.parsed.length, 0);
  assert.equal(result!.unparsed.length, 1);
  assert.match(result!.unparsed[0]!.reason, /exactly one of Paid In\/Withdrawn/);
});

test("flags an unrecognized status as unparsed rather than guessing", () => {
  const badStatusRow = row(
    ...cell(0, "RJ81ABCD12"),
    ...cell(1, "2026-08-01", "09:15:23"),
    ...cell(2, "Something"),
    ...cell(3, "Reversed"),
    ...cell(4, "500.00"),
    ...cell(6, "23978.00"),
  );
  const result = parseStatementRowsDynamic([STANDARD_HEADER, badStatusRow]);
  assert.ok(result);
  assert.equal(result!.parsed.length, 0);
  assert.equal(result!.unparsed.length, 1);
  assert.match(result!.unparsed[0]!.reason, /unrecognized status/);
});

test("flags a non-decimal balance as unparsed rather than guessing", () => {
  const badBalanceRow = row(
    ...cell(0, "RJ81ABCD12"),
    ...cell(1, "2026-08-01", "09:15:23"),
    ...cell(2, "Something"),
    ...cell(3, "Completed"),
    ...cell(4, "500.00"),
    ...cell(6, "n/a"),
  );
  const result = parseStatementRowsDynamic([STANDARD_HEADER, badBalanceRow]);
  assert.ok(result);
  assert.equal(result!.parsed.length, 0);
  assert.equal(result!.unparsed.length, 1);
  assert.match(result!.unparsed[0]!.reason, /balance column/);
});

test("skips the header row, customer/period preamble, and any non-receipt row without flagging them", () => {
  const preamble = row(["Statement", 0], ["Period:", 100], ["01", 300], ["Aug", 340], ["2026", 380]);
  const dataRow = row(
    ...cell(0, "RJ81ABCD12"),
    ...cell(1, "2026-08-01", "09:15:23"),
    ...cell(2, "Something"),
    ...cell(3, "Completed"),
    ...cell(4, "500.00"),
    ...cell(6, "23978.00"),
  );
  const result = parseStatementRowsDynamic([preamble, STANDARD_HEADER, dataRow]);
  assert.ok(result);
  assert.equal(result!.parsed.length, 1);
  assert.equal(result!.unparsed.length, 0);
});
