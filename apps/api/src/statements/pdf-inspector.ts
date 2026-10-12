import path from "node:path";

export interface PositionedItem {
  str: string;
  x: number;
  y: number;
  /** Rendered width/height in page units. Optional only for hand-built
   * test fixtures; real pdfjs items always carry them. Without them,
   * adjacent items are never merged (the pre-existing behaviour). */
  width?: number;
  height?: number;
}

export interface PdfInspection {
  numPages: number;
  text: string;
  /** Text reconstructed into rows (grouped by y-position, sorted by x within
   * each row) — this is what the statement parser reads, since a naive
   * left-to-right/top-to-bottom text dump loses which words belong to which
   * table row. See docs/15-extraction-engine.md. */
  lines: string[];
  /** Same row grouping as `lines`, but keeping each item's x-position instead
   * of flattening to a string. The dynamic column-mapper (extraction/
   * column-mapper.ts) needs this to read column boundaries off wherever the
   * statement's own header row places them, rather than assuming a fixed
   * column order. `lines` remains for period-text scanning and raw-text
   * storage, where position doesn't matter. */
  rows: PositionedItem[][];
}

// pdfjs-dist's legacy Node build ships ESM-only (.mjs, no CJS entry). A plain
// `import()` here would work in real ESM, but this codebase compiles to
// CommonJS, and TypeScript's CommonJS emit rewrites `import()` into
// `require()` even inside an async function — which then fails at runtime
// with "require() of ES Module ... not supported" (found the hard way, via
// the e2e test below actually running this code against a real PDF).
// Routing the specifier through `Function` hides the import() expression
// from TypeScript's static rewrite, so a genuine dynamic import happens at
// runtime — the standard workaround for a CJS TS build loading an ESM-only package.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>;

async function loadPdfjs() {
  return dynamicImport("pdfjs-dist/legacy/build/pdf.mjs");
}

const standardFontDataUrl = path.join(
  path.dirname(require.resolve("pdfjs-dist/package.json")),
  "standard_fonts/",
);

/** Groups text items whose baselines fall within 2pt of each other into the
 * same row, then orders items left-to-right within it. 2pt tolerance absorbs
 * normal sub-pixel/rounding variance between items meant to be on one line
 * without merging genuinely adjacent lines (typical line height is 10-14pt). */
function reconstructRows(items: PositionedItem[]): PositionedItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionedItem[][] = [];

  for (const item of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - item.y) <= 2) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows.map((row) => mergeGlyphRuns([...row].sort((a, b) => a.x - b.x)));
}

/**
 * Some PDFs emit one text item per GLYPH rather than per word — found on a
 * real statement that had been re-saved from a viewer (same 1,550 lines
 * as its original export, but 43 items per line instead of 3, the header
 * arriving as "R","e","c","e","i","p","t" at x=51,56,60,64…). Joining
 * those with spaces shredded every word and receipt number, so nothing
 * matched. Merge consecutive items whose horizontal gap is smaller than a
 * real inter-word space: kerned glyphs sit ~0pt apart (sometimes
 * overlapping), a space at 10pt is ~2.5pt, a column gap 20pt+. The
 * threshold scales with font size so it holds at other sizes. Per-word
 * items (the normal case) are untouched — their gaps ARE spaces.
 */
export function mergeGlyphRuns(items: PositionedItem[]): PositionedItem[] {
  const merged: PositionedItem[] = [];
  for (const item of items) {
    const prev = merged.at(-1);
    if (prev && prev.width !== undefined && item.width !== undefined) {
      const fontSize = Math.max(prev.height ?? 0, item.height ?? 0, 1);
      const gap = item.x - (prev.x + prev.width);
      if (gap < Math.max(0.5, 0.15 * fontSize)) {
        prev.str += item.str;
        prev.width = item.x + item.width - prev.x;
        continue;
      }
    }
    merged.push({ ...item });
  }
  return merged;
}

export function flattenRow(row: PositionedItem[]): string {
  return row
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Opens a PDF and extracts its page count, full text, and reconstructed
 * table rows. Stage 5 used only numPages/text (basic readability check);
 * Stage 6's statement parser reads `lines`.
 */
export interface InspectPdfOptions {
  /** Decryption password for a protected PDF. The statement the M-Pesa app
   * emails is encrypted by default, so this is the normal case, not an
   * edge case. Used only for this one load; never logged or stored. */
  password?: string;
}

export async function inspectPdf(bytes: Buffer, options: InspectPdfOptions = {}): Promise<PdfInspection> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl,
    // No canvas/DOM in this Node worker process — text extraction doesn't need one.
    isEvalSupported: false,
    ...(options.password ? { password: options.password } : {}),
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (error) {
    // pdfjs reports both cases as a PasswordException and tells them apart
    // by code: 1 = NEED_PASSWORD (none supplied), 2 = INCORRECT_PASSWORD.
    // Surfaced as two distinct error codes so the UI can prompt for a
    // password vs. ask for it again — statement-processor.ts stores
    // `error.message` as the job's errorCode, so these messages ARE the
    // codes. Verified against a pdfkit-encrypted fixture, not assumed.
    const err = error as { name?: string; code?: number };
    if (err?.name === "PasswordException") {
      throw new Error(err.code === 2 ? "password_incorrect" : "password_required");
    }
    throw error;
  }
  try {
    let text = "";
    const rows: PositionedItem[][] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: PositionedItem[] = content.items
        .filter(
          (item): item is typeof item & { str: string; transform: number[]; width: number; height: number } =>
            "str" in item,
        )
        .map((item) => ({
          str: item.str,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          width: item.width,
          height: item.height,
        }))
        .filter((item) => item.str.trim().length > 0);

      text += items.map((item) => item.str).join(" ");
      text += "\n";
      rows.push(...reconstructRows(items));
    }
    const lines = rows.map(flattenRow);
    return { numPages: doc.numPages, text, lines, rows };
  } finally {
    await doc.destroy();
  }
}
