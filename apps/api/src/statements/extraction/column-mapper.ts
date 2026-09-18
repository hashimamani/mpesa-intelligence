import type { PositionedItem } from "../pdf-inspector";
import { flattenRow } from "../pdf-inspector";
import { parseFlexibleDateTime } from "./date-utils";
import { RECEIPT_NUMBER, looksLikeAmount, toDecimal, type ParsedRow, type UnparsedRow } from "./row-types";

/**
 * Header-driven, format-agnostic row extraction. Instead of assuming a fixed
 * column order (the legacy `ROW_PATTERN` approach in
 * mpesa-statement-parser.ts), this reads the statement's own header row to
 * learn where each column actually sits — so a reordered column layout, a
 * relabeled header ("Money In" instead of "Paid In"), a merged signed
 * "Amount" column instead of split Paid In/Withdrawn, or a different date
 * format all keep working without a code change. Falls back to null (letting
 * the caller use the legacy fixed-regex parser) only when no row in the
 * document contains a recognizable header at all.
 *
 * Scope: still M-Pesa PDF statements specifically — a genuinely different
 * source (a bank statement, a CSV export, a screenshot) needs its own header
 * vocabulary or its own parser, not covered here.
 */

type ColumnLabel = "RECEIPT" | "TIME" | "DETAILS" | "STATUS" | "PAID_IN" | "WITHDRAWN" | "BALANCE" | "AMOUNT";

interface HeaderColumn {
  label: ColumnLabel;
  x: number;
}

export interface ColumnMap {
  /** Sorted ascending by x — column i's data span runs from the midpoint
   * with column i-1 to the midpoint with column i+1. */
  columns: HeaderColumn[];
  hasSplitAmounts: boolean;
  hasStatus: boolean;
}

// Each pattern is matched against the header row's flattened, single-spaced
// text — synonyms cover label wording seen across statement generations or
// guessed as plausible variants; extend this list rather than adding a new
// parser when a real statement uses different wording.
const HEADER_PATTERNS: Record<ColumnLabel, RegExp> = {
  RECEIPT: /receipt\s*no\.?|receipt\s*number|reference\s*no\.?|\breceipt\b/i,
  TIME: /completion\s*time|transaction\s*date\s*(?:\/|and)?\s*time|date\s*\/\s*time/i,
  DETAILS: /\bdetails\b|\bdescription\b|\bnarrative\b/i,
  STATUS: /transaction\s*status|\bstatus\b/i,
  PAID_IN: /paid\s*in|money\s*in|\bcredit\b/i,
  WITHDRAWN: /withdrawn|money\s*out|\bdebit\b/i,
  BALANCE: /\bbalance\b/i,
  AMOUNT: /\bamount\b/i,
};

/** Maps each character offset in the row's flattened text back to the x of
 * the item it came from, so a header-label regex match (found in the
 * flattened string) can be traced back to a real column position. */
function buildOffsetMap(row: PositionedItem[]): { text: string; offsetToX: (offset: number) => number } {
  let text = "";
  const boundaries: { start: number; x: number }[] = [];
  for (const item of row) {
    if (text.length > 0) text += " ";
    boundaries.push({ start: text.length, x: item.x });
    text += item.str;
  }
  function offsetToX(offset: number): number {
    let x = boundaries[0]?.x ?? 0;
    for (const boundary of boundaries) {
      if (boundary.start <= offset) x = boundary.x;
      else break;
    }
    return x;
  }
  return { text, offsetToX };
}

/**
 * Scans every reconstructed row for one that names enough recognizable
 * column headers to be the transaction table's header — requires Receipt,
 * Details, and Balance together (a signature that shouldn't collide with the
 * statement's earlier per-type summary table, which has no per-row Receipt
 * or Balance columns) plus either a split Paid In/Withdrawn pair or a merged
 * Amount column.
 */
export function detectHeaderColumns(rows: PositionedItem[][]): ColumnMap | null {
  for (const row of rows) {
    const { text, offsetToX } = buildOffsetMap(row);
    const matches: HeaderColumn[] = [];
    for (const label of Object.keys(HEADER_PATTERNS) as ColumnLabel[]) {
      const match = HEADER_PATTERNS[label].exec(text);
      if (match) matches.push({ label, x: offsetToX(match.index) });
    }

    const found = new Set(matches.map((m) => m.label));
    const hasSplitAmounts = found.has("PAID_IN") && found.has("WITHDRAWN");
    const hasMergedAmount = !hasSplitAmounts && found.has("AMOUNT");
    const isHeaderRow = found.has("RECEIPT") && found.has("DETAILS") && found.has("BALANCE") && (hasSplitAmounts || hasMergedAmount);
    if (!isHeaderRow) continue;

    // A header phrase can incidentally contain the word "amount" even in a
    // split layout (e.g. "Transaction Amount"); prefer the split columns and
    // drop the stray AMOUNT match rather than treating both as real.
    const usable = matches.filter((m) => !(hasSplitAmounts && m.label === "AMOUNT"));
    return {
      columns: [...usable].sort((a, b) => a.x - b.x),
      hasSplitAmounts,
      hasStatus: found.has("STATUS"),
    };
  }
  return null;
}

function computeBoundaries(columns: HeaderColumn[]): number[] {
  const boundaries: number[] = [];
  for (let i = 0; i < columns.length - 1; i++) {
    boundaries.push((columns[i]!.x + columns[i + 1]!.x) / 2);
  }
  return boundaries;
}

/**
 * Assigns each item in a data row to the header column whose midpoint band
 * it falls in, then joins each column's items back into cell text. Using
 * midpoint bands (not "nearest column start") tolerates right-aligned
 * numeric columns, where a short value's x can drift well past its own
 * header's start.
 */
function assignColumns(row: PositionedItem[], columns: HeaderColumn[]): Partial<Record<ColumnLabel, string>> {
  const boundaries = computeBoundaries(columns);
  const buckets = new Map<ColumnLabel, string[]>();

  for (const item of row) {
    let index = 0;
    while (index < boundaries.length && item.x >= boundaries[index]!) index++;
    const label = columns[index]!.label;
    const bucket = buckets.get(label);
    if (bucket) bucket.push(item.str);
    else buckets.set(label, [item.str]);
  }

  const cells: Partial<Record<ColumnLabel, string>> = {};
  for (const [label, words] of buckets) {
    cells[label] = words.join(" ").replace(/\s+/g, " ").trim();
  }
  return cells;
}

function normalizeStatus(text: string): "Completed" | "Pending" | "Failed" | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === "completed") return "Completed";
  if (normalized === "pending") return "Pending";
  if (normalized === "failed") return "Failed";
  return null;
}

const RECEIPT_EXACT = new RegExp(`^${RECEIPT_NUMBER}$`);

export function parseStatementRowsDynamic(
  rows: PositionedItem[][],
): { parsed: ParsedRow[]; unparsed: UnparsedRow[] } | null {
  const columnMap = detectHeaderColumns(rows);
  if (!columnMap) return null;

  const parsed: ParsedRow[] = [];
  const unparsed: UnparsedRow[] = [];

  rows.forEach((row, rowIndex) => {
    const raw = flattenRow(row);
    const cells = assignColumns(row, columnMap.columns);

    // Not every row is a transaction candidate: the header row itself, the
    // earlier per-type summary table, customer/period preamble, and wrapped
    // Details continuation lines all land here and are silently skipped —
    // none of them will have an exact receipt number in the Receipt column.
    const referenceNumber = (cells.RECEIPT ?? "").trim();
    if (!RECEIPT_EXACT.test(referenceNumber)) return;

    const transactionDate = parseFlexibleDateTime(cells.TIME ?? "");
    if (!transactionDate) {
      unparsed.push({ rowIndex, raw, reason: `receipt-shaped row but its time column ("${cells.TIME ?? ""}") didn't parse as a date/time` });
      return;
    }

    if (!columnMap.hasStatus) {
      unparsed.push({ rowIndex, raw, reason: "no status column was detected in this statement's header, so a row's completion state can't be confirmed" });
      return;
    }
    const status = normalizeStatus(cells.STATUS ?? "");
    if (!status) {
      unparsed.push({ rowIndex, raw, reason: `unrecognized status ("${(cells.STATUS ?? "").trim()}")` });
      return;
    }

    let amount: ReturnType<typeof toDecimal> | null = null;
    if (columnMap.hasSplitAmounts) {
      const paidInText = (cells.PAID_IN ?? "").trim();
      const withdrawnText = (cells.WITHDRAWN ?? "").trim();
      const paidInOk = paidInText.length > 0 && looksLikeAmount(paidInText);
      const withdrawnOk = withdrawnText.length > 0 && looksLikeAmount(withdrawnText);
      if (paidInOk && !withdrawnOk) {
        amount = toDecimal(paidInText);
      } else if (withdrawnOk && !paidInOk) {
        const magnitude = toDecimal(withdrawnText);
        amount = magnitude.isNegative() ? magnitude : magnitude.negated();
      } else {
        unparsed.push({ rowIndex, raw, reason: `expected exactly one of Paid In/Withdrawn to hold an amount (got "${paidInText}" / "${withdrawnText}")` });
        return;
      }
    } else {
      const amountText = (cells.AMOUNT ?? "").trim();
      if (!looksLikeAmount(amountText)) {
        unparsed.push({ rowIndex, raw, reason: `amount column ("${amountText}") isn't a recognizable signed amount` });
        return;
      }
      amount = toDecimal(amountText);
    }

    const balanceText = (cells.BALANCE ?? "").trim();
    if (!looksLikeAmount(balanceText)) {
      unparsed.push({ rowIndex, raw, reason: `balance column ("${balanceText}") isn't a recognizable amount` });
      return;
    }

    parsed.push({
      rowIndex,
      raw,
      referenceNumber,
      transactionDate,
      description: (cells.DETAILS ?? "").trim(),
      status,
      amount,
      balance: toDecimal(balanceText),
    });
  });

  return { parsed, unparsed };
}
