import { Decimal } from "decimal.js";

/**
 * Targets the M-Pesa statement layout (the PDF export from the Safaricom
 * app/portal): a table of
 * `Receipt | Completion Time | Details | Status | Paid In | Withdrawn | Balance`
 * rows under a header naming the customer and statement period, preceded by
 * a per-type SUMMARY table. Calibrated against one real statement (2026-09;
 * see docs/15-extraction-engine.md's changelog) — still not exhaustively
 * validated across statement variants (different date ranges, failed/
 * pending transactions, business accounts), so treat this as tested-once,
 * not proven-general.
 */
export const PARSER_VERSION = "mpesa-statement-v2";

const RECEIPT_NUMBER = "[A-Z]{2}[A-Z0-9]{8}";
// Withdrawn amounts render with a leading "-" in the real statement (Paid In
// amounts don't) — both amount fields allow an optional sign defensively.
// Row is a single line even when the Details text visually wraps onto
// further lines below it: those wrapped continuation lines don't start with
// a receipt number, so they're simply ignored by looksLikeTransactionRow
// rather than needing to be stitched back on — Status/Paid In/Withdrawn/
// Balance are fixed-position table cells that stay on the row's first line
// regardless of how many lines the Details column wraps to.
const ROW_PATTERN = new RegExp(
  `^(${RECEIPT_NUMBER})\\s+(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{2}:\\d{2}:\\d{2})\\s+(.+?)\\s+(Completed|Pending|Failed)\\s+(-?[\\d,]+\\.\\d{2})\\s+(-?[\\d,]+\\.\\d{2})$`,
);

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// "Statement Period: 01 Aug 2026 - 14 Aug 2026" — the actual format used by
// the real statement this was calibrated against. A slash-delimited
// DD/MM/YYYY variant is also accepted since other statement generations may
// use it (unverified either way — see module doc comment).
const PERIOD_PATTERN_TEXT = /Statement Period:?\s*(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/i;
const PERIOD_PATTERN_SLASH = /Statement Period:?\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i;

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

function toDecimal(raw: string): Decimal {
  return new Decimal(raw.replaceAll(",", ""));
}

/** A row is worth attempting to parse if it starts with something that
 * looks like a receipt number — cheaply filters out header/footer/disclaimer
 * lines, and (deliberately) any wrapped continuation line of a Details cell,
 * without running the full pattern against every line in the document. */
function looksLikeTransactionRow(line: string): boolean {
  return new RegExp(`^${RECEIPT_NUMBER}\\b`).test(line);
}

function monthNameToIndex(name: string): number | null {
  const key = name.slice(0, 3).toLowerCase();
  return key in MONTHS ? MONTHS[key]! : null;
}

export function parseStatementPeriod(lines: string[]): { periodStart: Date | null; periodEnd: Date | null } {
  for (const line of lines) {
    const textMatch = PERIOD_PATTERN_TEXT.exec(line);
    if (textMatch) {
      const [, startDay, startMonth, startYear, endDay, endMonth, endYear] = textMatch as unknown as [
        string, string, string, string, string, string, string,
      ];
      const startMonthIdx = monthNameToIndex(startMonth);
      const endMonthIdx = monthNameToIndex(endMonth);
      if (startMonthIdx !== null && endMonthIdx !== null) {
        return {
          periodStart: new Date(Date.UTC(Number(startYear), startMonthIdx, Number(startDay))),
          periodEnd: new Date(Date.UTC(Number(endYear), endMonthIdx, Number(endDay))),
        };
      }
    }

    const slashMatch = PERIOD_PATTERN_SLASH.exec(line);
    if (slashMatch) {
      const [, startDay, startMonth, startYear, endDay, endMonth, endYear] = slashMatch as unknown as [
        string, string, string, string, string, string, string,
      ];
      return {
        periodStart: new Date(Date.UTC(Number(startYear), Number(startMonth) - 1, Number(startDay))),
        periodEnd: new Date(Date.UTC(Number(endYear), Number(endMonth) - 1, Number(endDay))),
      };
    }
  }
  return { periodStart: null, periodEnd: null };
}

export function parseStatementRows(lines: string[]): ParseResult {
  const parsed: ParsedRow[] = [];
  const unparsed: UnparsedRow[] = [];

  lines.forEach((line, rowIndex) => {
    if (!looksLikeTransactionRow(line)) return;

    const match = ROW_PATTERN.exec(line);
    if (!match) {
      unparsed.push({ rowIndex, raw: line, reason: "line starts with a receipt-number-like token but doesn't match the expected row shape" });
      return;
    }

    const [, referenceNumber, dateStr, timeStr, description, status, amountStr, balanceStr] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
      "Completed" | "Pending" | "Failed",
      string,
      string,
    ];

    parsed.push({
      rowIndex,
      raw: line,
      referenceNumber,
      transactionDate: new Date(`${dateStr}T${timeStr}Z`),
      description: description.trim(),
      status,
      amount: toDecimal(amountStr),
      balance: toDecimal(balanceStr),
    });
  });

  const { periodStart, periodEnd } = parseStatementPeriod(lines);
  const dates = parsed.map((row) => row.transactionDate.getTime());
  return {
    parsed,
    unparsed,
    periodStart: periodStart ?? (dates.length ? new Date(Math.min(...dates)) : null),
    periodEnd: periodEnd ?? (dates.length ? new Date(Math.max(...dates)) : null),
  };
}
