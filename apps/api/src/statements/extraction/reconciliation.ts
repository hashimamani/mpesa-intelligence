import { Decimal } from "decimal.js";
import type { ParsedRow } from "./mpesa-statement-parser";

const BALANCE_TOLERANCE = new Decimal("0.01");

export type Direction = "credit" | "debit";

export interface DirectedTransaction extends ParsedRow {
  direction: Direction;
  paidIn: Decimal;
  withdrawn: Decimal;
  /** False if the running-balance delta doesn't match the row's amount —
   * a real signal something's wrong (misparsed row, missing row, wrong
   * direction), not just a formatting quirk. */
  reconciled: boolean;
}

export interface ReconciliationResult {
  transactions: DirectedTransaction[];
  issues: string[];
  /** Fraction of rows whose balance arithmetic checked out. */
  confidence: number;
}

/** Only used for the very first row, where there's no prior balance to
 * diff against — every subsequent row's direction comes from the balance
 * delta itself (docs/15-extraction-engine.md), which doesn't depend on
 * guessing keywords in a description that could phrase things differently
 * than this statement layout does. */
function inferDirectionFromDescription(description: string): Direction {
  return /received from|reversal/i.test(description) ? "credit" : "debit";
}

/**
 * Determines credit/debit for each row from the change in running balance,
 * and — as a direct consequence of that same arithmetic — validates that
 * change actually matches the row's stated amount. This is the "Statement-
 * level reconciliation" and "balance continuity" check docs/06 calls for
 * before anything is trusted as a real transaction.
 */
export function reconcile(rows: ParsedRow[]): ReconciliationResult {
  const sorted = [...rows].sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
  const issues: string[] = [];
  const transactions: DirectedTransaction[] = [];
  let previousBalance: Decimal | null = null;

  for (const row of sorted) {
    let direction: Direction;
    let reconciled = true;

    if (previousBalance !== null) {
      const delta = row.balance.minus(previousBalance);
      direction = delta.isPositive() ? "credit" : "debit";
      if (!delta.abs().minus(row.amount).abs().lte(BALANCE_TOLERANCE)) {
        reconciled = false;
        issues.push(
          `${row.referenceNumber}: balance moved by ${delta.toFixed(2)} but the row's amount is ${row.amount.toFixed(2)}`,
        );
      }
    } else {
      direction = inferDirectionFromDescription(row.description);
    }

    transactions.push({
      ...row,
      direction,
      paidIn: direction === "credit" ? row.amount : new Decimal(0),
      withdrawn: direction === "debit" ? row.amount : new Decimal(0),
      reconciled,
    });

    previousBalance = row.balance;
  }

  const confidence = transactions.length === 0 ? 0 : transactions.filter((t) => t.reconciled).length / transactions.length;
  return { transactions, issues, confidence };
}
