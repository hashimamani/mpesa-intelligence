import { Decimal } from "decimal.js";
import type { ParsedRow } from "./mpesa-statement-parser";

const BALANCE_TOLERANCE = new Decimal("0.01");

export type Direction = "credit" | "debit";

export interface DirectedTransaction extends ParsedRow {
  direction: Direction;
  paidIn: Decimal;
  withdrawn: Decimal;
  /** False if this row's *group* (see below) didn't reconcile — every row
   * in a group shares the same value. */
  reconciled: boolean;
}

export interface ReconciliationResult {
  transactions: DirectedTransaction[];
  issues: string[];
  /** Fraction of rows whose group's balance arithmetic checked out. */
  confidence: number;
}

/**
 * Direction comes directly from the amount's sign (the real statement
 * renders withdrawn amounts as negative, paid-in as positive) — reliable
 * and simple, unlike inferring it from balance movement.
 *
 * Reconciliation, however, works at the *group* level, not per-row: a real
 * statement frequently emits several rows under the *same* receipt number
 * for one real-world transaction (e.g. a Pay Bill payment plus its own
 * "Pay Bill Charge" line, or a Fuliza payment plus its "OverDraft of Credit
 * Party" line) — see docs/15-extraction-engine.md. Individual rows within
 * such a group do not reliably show incremental per-row balances (observed
 * in real data — a payment and its charge sometimes show the *identical*
 * balance), but the group's *net* amount, checked against the balance
 * transition from the previous group, does reconcile cleanly. This was
 * validated against a real statement (100% of groups reconciled) before
 * being adopted, not assumed.
 */
export function reconcile(rows: ParsedRow[]): ReconciliationResult {
  const sorted = [...rows].sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
  const issues: string[] = [];
  const transactions: DirectedTransaction[] = [];

  const groups: ParsedRow[][] = [];
  for (const row of sorted) {
    const currentGroup = groups.at(-1);
    if (currentGroup && currentGroup[0]!.referenceNumber === row.referenceNumber) {
      currentGroup.push(row);
    } else {
      groups.push([row]);
    }
  }

  let previousBalance: Decimal | null = null;
  for (const group of groups) {
    const groupTotal = group.reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
    const expectedBalance: Decimal | null = previousBalance === null ? null : previousBalance.plus(groupTotal);
    const reconciled =
      expectedBalance === null || group.some((row) => row.balance.minus(expectedBalance!).abs().lte(BALANCE_TOLERANCE));

    if (!reconciled) {
      issues.push(
        `${group[0]!.referenceNumber}: expected balance ${expectedBalance!.toFixed(2)} after this group's net ${groupTotal.toFixed(2)}, but no row in the group shows that`,
      );
    }

    for (const row of group) {
      const direction: Direction = row.amount.isNegative() ? "debit" : "credit";
      transactions.push({
        ...row,
        direction,
        paidIn: direction === "credit" ? row.amount.abs() : new Decimal(0),
        withdrawn: direction === "debit" ? row.amount.abs() : new Decimal(0),
        reconciled,
      });
    }

    // Advance using the arithmetically-derived balance, not a row's shown
    // value — keeps one bad group from cascading false mismatches through
    // the rest of the statement.
    previousBalance = expectedBalance ?? group.at(-1)!.balance;
  }

  const confidence = transactions.length === 0 ? 0 : transactions.filter((t) => t.reconciled).length / transactions.length;
  return { transactions, issues, confidence };
}
