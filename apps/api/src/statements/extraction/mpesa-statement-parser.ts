import { Decimal } from "decimal.js";

/**
 * Targets the publicly documented M-Pesa statement layout (the PDF export
 * from the Safaricom app/portal): a table of
 * `Receipt No. | Completion Time | Details | Transaction Status | Paid In | Withdrawn | Balance`
 * rows under a header naming the customer and statement period. This has
 * NOT been validated against a real Safaricom statement (none was available
 * to build against — see docs/15-extraction-engine.md, which flags this as
 * a real, open risk rather than a solved problem). Treat layout assumptions
 * here as best-effort until checked against a genuine sample.
 */
export const PARSER_VERSION = "mpesa-statement-v1";

const RECEIPT_NUMBER = "[A-Z]{2}[A-Z0-9]{8}";
const ROW_PATTERN = new RegExp(
  `^(${RECEIPT_NUMBER})\\s+(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{2}:\\d{2}:\\d{2})\\s+(.+?)\\s+(Completed|Pending|Failed)\\s+([\\d,]+\\.\\d{2})\\s+([\\d,]+\\.\\d{2})$`,
);

const PERIOD_PATTERN = /Statement Period:?\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/i;

export interface ParsedRow {
  rowIndex: number;
  raw: string;
  referenceNumber: string;
  transactionDate: Date;
  description: string;
  status: "Completed" | "Pending" | "Failed";
  /** The single trailing amount before balance — direction (paid in vs
   * withdrawn) isn't known yet at parse time; see classifyDirection. */
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
 * lines without running the full pattern against every line in the document. */
function looksLikeTransactionRow(line: string): boolean {
  return new RegExp(`^${RECEIPT_NUMBER}\\b`).test(line);
}

export function parseStatementPeriod(lines: string[]): { periodStart: Date | null; periodEnd: Date | null } {
  for (const line of lines) {
    const match = PERIOD_PATTERN.exec(line);
    if (match) {
      const [, startStr, endStr] = match as unknown as [string, string, string];
      const [startDay, startMonth, startYear] = startStr.split("/");
      const [endDay, endMonth, endYear] = endStr.split("/");
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
