import path from "node:path";

export interface PdfInspection {
  numPages: number;
  text: string;
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

/**
 * Opens a PDF and extracts its page count and full text — this is the extent
 * of what Stage 5 does with a document's content (confirming it's real and
 * readable). Statement-specific line-item parsing is Stage 6.
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
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      text += "\n";
    }
    return { numPages: doc.numPages, text };
  } finally {
    await doc.destroy();
  }
}
