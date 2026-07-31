import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fillBaForm } from "@/modules/documents/ba-forms";
import { embedDocumentFonts } from "@/modules/documents/fonts";

// Names outside Windows-1252 are ordinary in German employment paperwork.
// pdf-lib's standard fonts reject them at save() time, which used to turn a
// Turkish surname into a 500 on document generation, BA-form filling and
// signing. These tests pin the fix at both ends: the standard font still
// refuses, our embedded font does not.

const AWKWARD_NAMES = [
  "Ayşe Yılmaz", // Turkish: ş, ı
  "Łukasz Wiśniewski", // Polish: Ł, ś
  "Đorđe Ćirić", // Serbian latin: Đ, ć
  "Ольга Иванова", // Cyrillic
];

test("the standard font is what used to break — it still rejects these names", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  assert.throws(
    () => page.drawText("Ayşe Yılmaz", { font: helvetica, x: 50, y: 700, size: 10 }),
    /WinAnsi cannot encode/,
  );
});

test("embedded document fonts draw every name we expect to see", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const fonts = await embedDocumentFonts(doc);

  let y = 700;
  for (const name of AWKWARD_NAMES) {
    page.drawText(name, { font: fonts.regular, x: 50, y, size: 10 });
    page.drawText(name, { font: fonts.bold, x: 50, y: y - 12, size: 10 });
    y -= 30;
  }

  const bytes = await doc.save();
  assert.ok(bytes.byteLength > 0);
});

test("a glyph the font lacks is dropped, not thrown", async () => {
  // Arabic and CJK are out of Noto Sans' Latin/Greek/Cyrillic range. Losing the
  // rendering is acceptable; losing the document is not.
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const fonts = await embedDocumentFonts(doc);
  page.drawText("محمد 中文", { font: fonts.regular, x: 50, y: 700, size: 10 });
  assert.ok((await doc.save()).byteLength > 0);
});

test("filling a BA AcroForm keeps a name the template font cannot encode", async () => {
  const bytes = await fillBaForm("teilnehmer-stammblatt.pdf", {
    vorname: "Ayşe",
    nachname: "Yılmaz-Łukasz",
    plz_ort: "71032 Böblingen",
  });

  // The filled values survive as form field values, not just as pixels.
  const filled = await PDFDocument.load(bytes);
  const form = filled.getForm();
  assert.equal(form.getTextField("nachname").getText(), "Yılmaz-Łukasz");
});
