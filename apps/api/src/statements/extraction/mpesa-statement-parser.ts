import type { PositionedItem } from "../pdf-inspector";
import { monthNameToIndex } from "./date-utils";
import { parseStatementRowsDynamic } from "./column-mapper";
import { RECEIPT_NUMBER, toDecimal, type ParsedRow, type UnparsedRow, type ParseResult } from "./row-types";

/**
 * Targets the M-Pesa statement layout (the PDF export from the Safaricom
 * app/portal): a table of
 * `Receipt | Completion Time | Details | Status | Paid In | Withdrawn | Balance`
 * rows under a header naming the customer and statement period, preceded by
 * a per-type SUMMARY table. Calibrated against one real statement (2026-09;
 * see docs/15-extraction-engine.md's changelog).
 *
 * Row extraction is now header-driven (extraction/column-mapper.ts): column
 * positions, order, and labels are read from the statement's own header row
 * rather than assumed fixed, so a reordered/relabeled/reformatted layout
 * still parses. The fixed-regex parser below (`ROW_PATTERN`) only runs as a
 * fallback when no row in the document contains a header the column-mapper
 * recognizes at all.
 */
export const PARSER_VERSION = "mpesa-statement-v3-dynamic";

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

// "Statement Period: 01 Aug 2026 - 14 Aug 2026" — the actual format used by
// the real statement this was calibrated against. A slash-delimited
// DD/MM/YYYY variant is also accepted since other statement generations may
// use it (unverified either way — see module doc comment).
const PERIOD_PATTERN_TEXT = /Statement Period:?\s*(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/i;
const PERIOD_PATTERN_SLASH = /Statement Period:?\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i;

export type { ParsedRow, UnparsedRow, ParseResult };

/** A row is worth attempting to parse if it starts with something that
 * looks like a receipt number — cheaply filters out header/footer/disclaimer
 * lines, and (deliberately) any wrapped continuation line of a Details cell,
 * without running the full pattern against every line in the document. Only
 * used by the legacy fixed-column fallback. */
function looksLikeTransactionRow(line: string): boolean {
  return new RegExp(`^${RECEIPT_NUMBER}\\b`).test(line);
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

/**
 * Fixed-column fallback: only reached when the header-driven dynamic parser
 * (column-mapper.ts) can't find a recognizable header row anywhere in the
 * document. Assumes the exact column order/format this project was
 * originally calibrated against.
 */
function parseStatementRowsLegacy(lines: string[]): { parsed: ParsedRow[]; unparsed: UnparsedRow[] } {
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

  return { parsed, unparsed };
}

export function parseStatementRows(rows: PositionedItem[][], lines: string[]): ParseResult {
  const dynamic = parseStatementRowsDynamic(rows);
  const { parsed, unparsed } = dynamic ?? parseStatementRowsLegacy(lines);

  const { periodStart, periodEnd } = parseStatementPeriod(lines);
  const dates = parsed.map((row) => row.transactionDate.getTime());
  return {
    parsed,
    unparsed,
    periodStart: periodStart ?? (dates.length ? new Date(Math.min(...dates)) : null),
    periodEnd: periodEnd ?? (dates.length ? new Date(Math.max(...dates)) : null),
  };
}
