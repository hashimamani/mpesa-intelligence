import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatementPeriod, parseStatementRows } from "./mpesa-statement-parser";

const VALID_ROW = "RJ81ABCD12 2026-08-01 09:15:23 Customer Transfer to JOHN KAMAU 254722000111 Completed 500.00 23978.00";

test("parses a well-formed transaction row", () => {
  const { parsed, unparsed } = parseStatementRows([VALID_ROW]);
  assert.equal(unparsed.length, 0);
  assert.equal(parsed.length, 1);
  const row = parsed[0]!;
  assert.equal(row.referenceNumber, "RJ81ABCD12");
  assert.equal(row.status, "Completed");
  assert.equal(row.description, "Customer Transfer to JOHN KAMAU 254722000111");
  assert.equal(row.amount.toFixed(2), "500.00");
  assert.equal(row.balance.toFixed(2), "23978.00");
  assert.equal(row.transactionDate.toISOString(), "2026-08-01T09:15:23.000Z");
});

test("parses amounts with thousands separators", () => {
  const line = "QA12345678 2026-08-01 09:15:23 Funds received from JANE DOE 254733111222 Completed 1,234.56 25,212.56";
  const { parsed } = parseStatementRows([line]);
  assert.equal(parsed[0]!.amount.toFixed(2), "1234.56");
  assert.equal(parsed[0]!.balance.toFixed(2), "25212.56");
});

test("ignores lines that aren't transaction rows (headers, footers, disclaimers)", () => {
  const lines = [
    "M-PESA STATEMENT",
    "Customer Name: JANE MUTHONI",
    "Receipt No. Completion Time Details Transaction Status Paid In Withdrawn Balance",
    VALID_ROW,
    "Disclaimer: This statement is system generated.",
  ];
  const { parsed, unparsed } = parseStatementRows(lines);
  assert.equal(parsed.length, 1);
  assert.equal(unparsed.length, 0);
});

test("flags a line that starts like a receipt number but doesn't match the row shape", () => {
  const malformed = "RJ81ABCD12 this row is missing its amounts and status";
  const { parsed, unparsed } = parseStatementRows([malformed]);
  assert.equal(parsed.length, 0);
  assert.equal(unparsed.length, 1);
  assert.equal(unparsed[0]!.raw, malformed);
});

test("does not misfire on a merchant name that happens to look receipt-number-ish mid-line", () => {
  // The key property under test: only a line *starting* with the receipt
  // pattern is a candidate — the pattern appearing elsewhere must not count.
  const line = "This is just some text mentioning AB12345678 in passing, not a real row";
  const { parsed, unparsed } = parseStatementRows([line]);
  assert.equal(parsed.length, 0);
  assert.equal(unparsed.length, 0);
});

test("extracts an explicit statement period header", () => {
  const { periodStart, periodEnd } = parseStatementPeriod(["Statement Period: 01/08/2026 - 31/08/2026"]);
  assert.equal(periodStart?.toISOString().slice(0, 10), "2026-08-01");
  assert.equal(periodEnd?.toISOString().slice(0, 10), "2026-08-31");
});

test("falls back to min/max transaction dates when no period header is present", () => {
  const lines = [
    "RJ81ABCD12 2026-08-01 09:15:23 Customer Transfer to JOHN KAMAU 254722000111 Completed 500.00 23978.00",
    "RJ81ABCD13 2026-08-15 09:15:23 Customer Transfer to JOHN KAMAU 254722000111 Completed 500.00 23478.00",
  ];
  const { periodStart, periodEnd } = parseStatementRows(lines);
  assert.equal(periodStart?.toISOString().slice(0, 10), "2026-08-01");
  assert.equal(periodEnd?.toISOString().slice(0, 10), "2026-08-15");
});
