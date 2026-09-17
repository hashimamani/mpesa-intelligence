import path from "node:path";

export interface PdfInspection {
  numPages: number;
  text: string;
  /** Text reconstructed into rows (grouped by y-position, sorted by x within
   * each row) — this is what the statement parser reads, since a naive
   * left-to-right/top-to-bottom text dump loses which words belong to which
   * table row. See docs/15-extraction-engine.md. */
  lines: string[];
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

interface PositionedItem {
  str: string;
  x: number;
  y: number;
}

/** Groups text items whose baselines fall within 2pt of each other into the
 * same row, then orders items left-to-right within it. 2pt tolerance absorbs
 * normal sub-pixel/rounding variance between items meant to be on one line
 * without merging genuinely adjacent lines (typical line height is 10-14pt). */
function reconstructLines(items: PositionedItem[]): string[] {
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

  return rows.map((row) =>
    row
      .sort((a, b) => a.x - b.x)
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * Opens a PDF and extracts its page count, full text, and reconstructed
 * table rows. Stage 5 used only numPages/text (basic readability check);
 * Stage 6's statement parser reads `lines`.
 */
export async function inspectPdf(bytes: Buffer): Promise<PdfInspection> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl,
    // No canvas/DOM in this Node worker process — text extraction doesn't need one.
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  try {
    let text = "";
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: PositionedItem[] = content.items
        .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item)
        .map((item) => ({ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }))
        .filter((item) => item.str.trim().length > 0);

      text += items.map((item) => item.str).join(" ");
      text += "\n";
      lines.push(...reconstructLines(items));
    }
    return { numPages: doc.numPages, text, lines };
  } finally {
    await doc.destroy();
  }
}
