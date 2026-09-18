import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatementRows } from "./mpesa-statement-parser";
import { reconcile } from "./reconciliation";

// Amounts are signed in the real statement format this was calibrated
// against (negative = withdrawn, positive = paid in) — see
// docs/15-extraction-engine.md's changelog.
function row(ref: string, time: string, description: string, amount: string, balance: string): string {
  return `${ref} 2026-08-01 ${time} ${description} Completed ${amount} ${balance}`;
}

test("direction comes from the amount's sign", () => {
  const lines = [
    row("AA11111111", "08:00:00", "Funds received from 254733111222 - JANE DOE", "5000.00", "5000.00"),
    row("AA11111112", "09:00:00", "Customer Transfer to 254722000111 - JOHN KAMAU", "-500.00", "4500.00"),
  ];
  const { parsed } = parseStatementRows([], lines);
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

test("reconciles a group of rows sharing one receipt number (payment + its own charge)", () => {
  // Real statements commonly emit a payment and its "Charge" line under the
  // SAME receipt number — see docs/15. Individual rows in such a group don't
  // reliably show incremental per-row balances (observed in real data), but
  // the group's net total, checked against the transition from the previous
  // group's balance, does.
  const lines = [
    row("AA11111111", "08:00:00", "Funds received from 254733111222 - JANE DOE", "5000.00", "5000.00"),
    // 5000 - 1000 - 20 = 3980 — the group's real net effect. Both rows show
    // that same final balance rather than their own incremental delta,
    // matching what was actually observed in the real statement.
    row("AA11111112", "09:00:00", "Pay Bill Online to 522533 - Lipa na KCB", "-1000.00", "3980.00"),
    row("AA11111112", "09:00:00", "Pay Bill Charge", "-20.00", "3980.00"),
  ];
  const { parsed } = parseStatementRows([], lines);
  const { transactions, confidence, issues } = reconcile(parsed);

  assert.equal(issues.length, 0);
  assert.equal(confidence, 1);
  assert.equal(transactions[1]!.reconciled, true);
  assert.equal(transactions[2]!.reconciled, true);
});

test("flags a group whose net amount doesn't match the balance movement", () => {
  const lines = [
    row("AA11111111", "08:00:00", "Funds received from 254733111222 - JANE DOE", "5000.00", "5000.00"),
    // Balance only moved by 400, but the row claims 500 — a real inconsistency.
    row("AA11111112", "09:00:00", "Customer Transfer to 254722000111 - JOHN KAMAU", "-500.00", "4600.00"),
  ];
  const { parsed } = parseStatementRows([], lines);
  const { transactions, confidence, issues } = reconcile(parsed);

  assert.equal(transactions[1]!.reconciled, false);
  assert.equal(confidence, 0.5);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /AA11111112/);
});

test("sorts rows chronologically before reconciling, regardless of input order", () => {
  const lines = [
    row("BB11111112", "09:00:00", "Customer Transfer to 254722000111 - JOHN KAMAU", "-500.00", "4500.00"),
    row("BB11111111", "08:00:00", "Funds received from 254733111222 - JANE DOE", "5000.00", "5000.00"),
  ];
  const { parsed } = parseStatementRows([], lines);
  const { transactions } = reconcile(parsed);

  assert.equal(transactions[0]!.referenceNumber, "BB11111111");
  assert.equal(transactions[1]!.referenceNumber, "BB11111112");
  assert.equal(transactions[1]!.reconciled, true);
});

test("the first group (no prior balance to compare against) is treated as reconciled", () => {
  const lines = [row("CC11111111", "08:00:00", "Funds received from 254733111222 - JANE DOE", "5000.00", "5000.00")];
  const { parsed } = parseStatementRows([], lines);
  const { transactions } = reconcile(parsed);
  assert.equal(transactions[0]!.direction, "credit");
  assert.equal(transactions[0]!.reconciled, true);
});

test("confidence is 0 for an empty transaction list, not NaN or a crash", () => {
  const { confidence } = reconcile([]);
  assert.equal(confidence, 0);
});
