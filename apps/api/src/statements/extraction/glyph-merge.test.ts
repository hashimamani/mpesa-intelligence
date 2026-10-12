import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeGlyphRuns, type PositionedItem } from "../pdf-inspector";

/** Glyph-sized items laid out with their real advance widths, 10pt font. */
function glyphs(word: string, startX: number, advance = 5.5, height = 10): PositionedItem[] {
  return [...word].map((ch, i) => ({ str: ch, x: startX + i * advance, y: 0, width: advance, height }));
}

test("merges a per-glyph run into one word item — the re-saved-from-a-viewer PDF case", () => {
  const merged = mergeGlyphRuns(glyphs("Receipt", 51));
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.str, "Receipt");
  assert.equal(merged[0]!.x, 51);
  assert.ok(Math.abs((merged[0]!.width ?? 0) - 7 * 5.5) < 1e-9);
});

test("keeps a real inter-word space (≈0.25-0.5 of the font size) as a boundary", () => {
  // "Paid" then a 2.8pt space (≈0.28 × 10pt) then "In".
  const paid = glyphs("Paid", 373);
  const paidEnd = 373 + 4 * 5.5;
  const items = [...paid, ...glyphs("In", paidEnd + 2.8)];
  const merged = mergeGlyphRuns(items);
  assert.deepEqual(merged.map((m) => m.str), ["Paid", "In"]);
});

test("never merges across a column gap", () => {
  const items = [...glyphs("Completed", 282), ...glyphs("-999.99", 373)];
  const merged = mergeGlyphRuns(items);
  assert.deepEqual(merged.map((m) => m.str), ["Completed", "-999.99"]);
});

test("merges slightly overlapping kerned glyphs (negative gap)", () => {
  const items: PositionedItem[] = [
    { str: "A", x: 10, y: 0, width: 6, height: 10 },
    { str: "V", x: 15.4, y: 0, width: 6, height: 10 }, // starts 0.6pt before A ends
  ];
  assert.deepEqual(mergeGlyphRuns(items).map((m) => m.str), ["AV"]);
});

test("leaves width-less items untouched — hand-built fixtures keep the per-word behaviour", () => {
  const items: PositionedItem[] = [
    { str: "R", x: 0, y: 0 },
    { str: "e", x: 5, y: 0 },
  ];
  assert.equal(mergeGlyphRuns(items).length, 2);
});

test("per-word items from a normal export pass through unchanged", () => {
  // Three real cells with real column gaps between them, each one item.
  const items: PositionedItem[] = [
    { str: "AA11111111", x: 38, y: 0, width: 37.6, height: 6 },
    { str: "2026-08-01", x: 108, y: 0, width: 34.8, height: 6 },
    { str: "Completed", x: 282, y: 0, width: 32.7, height: 6 },
  ];
  assert.deepEqual(mergeGlyphRuns(items).map((m) => m.str), ["AA11111111", "2026-08-01", "Completed"]);
});
