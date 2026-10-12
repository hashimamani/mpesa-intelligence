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
function groupTotalOf(group: ParsedRow[]): Decimal {
  return group.reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
}

/** Does applying this group's net to `previousBalance` land on a balance
 * some row in the group actually shows? The same test the group check
 * below applies — reused to disambiguate same-second ordering. */
function chainsFrom(group: ParsedRow[], previousBalance: Decimal): boolean {
  const expected = previousBalance.plus(groupTotalOf(group));
  return group.some((row) => row.balance.minus(expected).abs().lte(BALANCE_TOLERANCE));
}

export function reconcile(rows: ParsedRow[]): ReconciliationResult {
  // Chronological. Same-second ties get a deterministic document order here
  // only as a starting point — the print order is NOT trusted for them
  // (see the bucket walk below).
  const sorted = [...rows].sort(
    (a, b) => a.transactionDate.getTime() - b.transactionDate.getTime() || a.rowIndex - b.rowIndex,
  );
  const issues: string[] = [];
  const transactions: DirectedTransaction[] = [];

  // Buckets of groups sharing one timestamp; within a bucket, rows are
  // grouped by receipt number (not merely by adjacency, so two receipts
  // interleaved on the page can't split a group).
  const buckets: ParsedRow[][][] = [];
  for (const row of sorted) {
    const time = row.transactionDate.getTime();
    let bucket = buckets.at(-1);
    if (!bucket || bucket[0]![0]!.transactionDate.getTime() !== time) {
      bucket = [];
      buckets.push(bucket);
    }
    const group = bucket.find((g) => g[0]!.referenceNumber === row.referenceNumber);
    if (group) group.push(row);
    else bucket.push([row]);
  }

  // Walk buckets in time order. A bucket holding >1 receipt is where the
  // statement's print order can't be trusted: a real second statement had
  // five same-second credit + automatic-Fuliza-repayment pairs, of which
  // two printed the repayment ABOVE its triggering credit and three printed
  // it BELOW — in the same document. No positional rule works in either
  // direction (a "newest-first" tiebreak was tried and broke the other
  // three). What is reliable is the Balance column: only one ordering
  // chains from the running balance. So among the bucket's remaining
  // groups, take the one that chains; if none does, fall back to document
  // order and let the group check flag it as it would have anyway.
  const orderedGroups: ParsedRow[][] = [];
  let previousBalance: Decimal | null = null;
  const chainState = { balance: null as Decimal | null };
  for (const bucket of buckets) {
    const remaining = [...bucket];
    while (remaining.length > 0) {
      let pick = 0;
      if (remaining.length > 1 && chainState.balance !== null) {
        const chained = remaining.findIndex((g) => chainsFrom(g, chainState.balance!));
        if (chained >= 0) pick = chained;
      }
      const [group] = remaining.splice(pick, 1);
      orderedGroups.push(group!);
      // Track the running balance the same way the main loop below does, so
      // tie resolution and verification agree.
      chainState.balance = chainState.balance === null ? group!.at(-1)!.balance : chainState.balance.plus(groupTotalOf(group!));
    }
  }

  for (const group of orderedGroups) {
    const groupTotal = groupTotalOf(group);
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
