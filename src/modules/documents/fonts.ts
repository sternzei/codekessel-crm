import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

// Every PDF this app produces carries data a human typed: a participant's name,
// a street, an employer. pdf-lib's standard fonts encode WinAnsi (Windows-1252)
// and THROW on anything outside it, so a "Yılmaz" or a "Łukasz" turned document
// generation, BA-form filling and signing into 500s. Embedding a Unicode font
// removes that failure mode: fontkit maps unknown code points to .notdef and
// draws a blank instead of raising.
//
// Noto Sans covers Latin (incl. Latin Extended-A/B), Greek and Cyrillic, which
// is the realistic range for German employment paperwork. Scripts beyond that
// (Arabic, CJK) render as blanks rather than crashing — no data is lost, the
// value is still stored and searchable in the database.

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

export type DocumentFonts = {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
};

/** Read once per process; the bytes are ~1 MB and never change. */
let cachedBytes: { regular: Buffer; bold: Buffer } | null = null;

async function loadFontBytes(): Promise<{ regular: Buffer; bold: Buffer }> {
  if (cachedBytes) return cachedBytes;
  const [regular, bold] = await Promise.all([
    readFile(path.join(FONT_DIR, "NotoSans-Regular.ttf")),
    readFile(path.join(FONT_DIR, "NotoSans-Bold.ttf")),
  ]);
  cachedBytes = { regular, bold };
  return cachedBytes;
}

/**
 * Embeds the Unicode text fonts into `doc`. Subsetted, so a one-page cover
 * sheet does not carry a megabyte of glyphs it never draws.
 */
export async function embedDocumentFonts(
  doc: PDFDocument,
): Promise<DocumentFonts> {
  doc.registerFontkit(fontkit);
  const bytes = await loadFontBytes();
  const [regular, bold] = await Promise.all([
    doc.embedFont(bytes.regular, { subset: true }),
    doc.embedFont(bytes.bold, { subset: true }),
  ]);
  return { regular, bold };
}
