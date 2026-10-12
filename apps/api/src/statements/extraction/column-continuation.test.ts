import { test } from "node:test";
import assert from "node:assert/strict";
import type { PositionedItem } from "../pdf-inspector";
import { parseStatementRowsDynamic } from "./column-mapper";

/** Per-word items WITH real widths/heights, as pdf-inspector produces after
 * merging a per-glyph PDF — unlike column-mapper.test.ts's width-less
 * fixtures, which exercise the plain midpoint rule. Metrics match the real
 * statement this was calibrated on: 6pt font, ~3.5pt per character, ~1.8pt
 * spaces (e.g. a 10-char receipt number measured 37.6pt wide). The column
 * x positions below are the real header positions from that statement, so
 * the geometry has to be consistent with them or items overlap. */
function words(startX: number, text: string, charWidth = 3.5, space = 1.8, height = 6): PositionedItem[] {
  const out: PositionedItem[] = [];
  let x = startX;
  for (const word of text.split(" ")) {
    const width = word.length * charWidth;
    out.push({ str: word, x, y: 0, width, height });
    x += width + space;
  }
  return out;
}

// Real header x positions from a real statement: Details@216, Status@282.
const HEADER: PositionedItem[] = [
  ...words(51, "Receipt No."),
  ...words(111, "Completion Time"),
  ...words(216, "Details"),
  ...words(282, "Transaction Status"),
  ...words(373, "Paid In"),
  ...words(436, "Withdrawn"),
  ...words(510, "Balance"),
];

test("a multi-word Details cell whose later words cross the Status midpoint stays in Details (continuation rule)", () => {
  // Details starts at 178; its last word "to" starts at ~266, past the
  // Details/Status midpoint (249), and ends ~273 — a 9pt gap to "Completed"
  // at 282 (1.5 font sizes, a real column gap). Under the plain midpoint
  // rule "to" would land in Status and the status cell would read
  // "to Completed" — the exact failure seen on a real re-saved statement
  // (270 rows).
  const row: PositionedItem[] = [
    ...words(38, "AA11111111"),
    ...words(108, "2026-08-01"),
    ...words(145, "09:15:23"),
    ...words(178, "Customer Transfer of Funds to"),
    ...words(282, "Completed"),
    ...words(436, "-500.00"),
    ...words(510, "4500.00"),
  ];
  const result = parseStatementRowsDynamic([HEADER, row]);
  assert.ok(result);
  assert.equal(result!.unparsed.length, 0, JSON.stringify(result!.unparsed));
  assert.equal(result!.parsed.length, 1);
  assert.equal(result!.parsed[0]!.description, "Customer Transfer of Funds to");
  assert.equal(result!.parsed[0]!.status, "Completed");
  assert.equal(result!.parsed[0]!.amount.toFixed(2), "-500.00");
});

test("a genuine column gap still moves to the next column even when the previous cell ran long", () => {
  // Details ends at ~262; Status "Completed" starts at 282 — a 20pt gap
  // (2 font sizes), well above the 0.75 continuation threshold.
  const row: PositionedItem[] = [
    ...words(38, "AA11111112"),
    ...words(108, "2026-08-02"),
    ...words(145, "10:00:00"),
    ...words(178, "Airtime Purchase"),
    ...words(282, "Completed"),
    ...words(436, "-100.00"),
    ...words(510, "4400.00"),
  ];
  const result = parseStatementRowsDynamic([HEADER, row]);
  assert.ok(result);
  assert.equal(result!.unparsed.length, 0, JSON.stringify(result!.unparsed));
  assert.equal(result!.parsed[0]!.status, "Completed");
});
