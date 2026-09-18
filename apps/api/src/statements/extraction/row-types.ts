import { Decimal } from "decimal.js";

/** A receipt/reference number is always this shape across every M-Pesa
 * statement layout seen so far: two letters then eight more letters/digits.
 * Shared between the header-driven dynamic parser and the fixed-column
 * legacy fallback. */
export const RECEIPT_NUMBER = "[A-Z]{2}[A-Z0-9]{8}";

export interface ParsedRow {
  rowIndex: number;
  raw: string;
  referenceNumber: string;
  transactionDate: Date;
  description: string;
  status: "Completed" | "Pending" | "Failed";
  /** Signed — negative means withdrawn/debit, positive means paid in/credit.
   * This is the primary direction signal (see reconciliation.ts); the
   * running balance is used to validate it, not to derive it. */
  amount: Decimal;
  balance: Decimal;
}

export interface UnparsedRow {
  rowIndex: number;
  raw: string;
  reason: string;
}

export interface ParseResult {
  parsed: ParsedRow[];
  unparsed: UnparsedRow[];
  periodStart: Date | null;
  periodEnd: Date | null;
}

export function toDecimal(raw: string): Decimal {
  return new Decimal(raw.replaceAll(",", ""));
}

/** True only when `raw` is exactly a signed/unsigned decimal amount shape
 * (optionally comma-grouped, exactly 2 decimal places) — used to validate a
 * cell before handing it to `toDecimal`, so a malformed cell becomes an
 * `unparsed` row with a reason instead of a thrown exception. */
export function looksLikeAmount(raw: string): boolean {
  return /^-?[\d,]+\.\d{2}$/.test(raw.trim());
}
