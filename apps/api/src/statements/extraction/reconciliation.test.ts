import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatementRows } from "./mpesa-statement-parser";
import { reconcile } from "./reconciliation";

function row(ref: string, time: string, description: string, amount: string, balance: string): string {
  return `${ref} 2026-08-01 ${time} ${description} Completed ${amount} ${balance}`;
}

test("infers credit when balance goes up and debit when it goes down", () => {
  const lines = [
    row("AA11111111", "08:00:00", "Funds received from JANE DOE 254733111222", "5000.00", "5000.00"),
    row("AA11111112", "09:00:00", "Customer Transfer to JOHN KAMAU 254722000111", "500.00", "4500.00"),
  ];
  const { parsed } = parseStatementRows(lines);
  const { transactions, confidence, issues } = reconcile(parsed);

  assert.equal(issues.length, 0);
  assert.equal(confidence, 1);
  assert.equal(transactions[0]!.direction, "credit");
  assert.equal(transactions[0]!.paidIn.toFixed(2), "5000.00");
  assert.equal(transactions[0]!.withdrawn.toFixed(2), "0.00");
  assert.equal(transactions[1]!.direction, "debit");
  assert.equal(transactions[1]!.withdrawn.toFixed(2), "500.00");
  assert.equal(transactions[1]!.reconciled, true);
});

test("flags a row whose amount doesn't match its balance movement", () => {
  const lines = [
    row("AA11111111", "08:00:00", "Funds received from JANE DOE 254733111222", "5000.00", "5000.00"),
    // Balance only moved by 400, but the row claims 500 — a real inconsistency.
    row("AA11111112", "09:00:00", "Customer Transfer to JOHN KAMAU 254722000111", "500.00", "4600.00"),
  ];
  const { parsed } = parseStatementRows(lines);
  const { transactions, confidence, issues } = reconcile(parsed);

  assert.equal(transactions[1]!.reconciled, false);
  assert.equal(confidence, 0.5);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /AA11111112/);
});

test("sorts rows chronologically before reconciling, regardless of input order", () => {
  const lines = [
    row("BB11111112", "09:00:00", "Customer Transfer to JOHN KAMAU 254722000111", "500.00", "4500.00"),
    row("BB11111111", "08:00:00", "Funds received from JANE DOE 254733111222", "5000.00", "5000.00"),
  ];
  const { parsed } = parseStatementRows(lines);
  const { transactions } = reconcile(parsed);

  assert.equal(transactions[0]!.referenceNumber, "BB11111111");
  assert.equal(transactions[1]!.referenceNumber, "BB11111112");
  assert.equal(transactions[1]!.reconciled, true);
});

test("first row (no prior balance) falls back to description keywords for direction", () => {
  const lines = [row("CC11111111", "08:00:00", "Funds received from JANE DOE 254733111222", "5000.00", "5000.00")];
  const { parsed } = parseStatementRows(lines);
  const { transactions } = reconcile(parsed);
  assert.equal(transactions[0]!.direction, "credit");
});

test("confidence is 0 for an empty transaction list, not NaN or a crash", () => {
  const { confidence } = reconcile([]);
  assert.equal(confidence, 0);
});
