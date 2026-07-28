import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DbHandle } from "@/db/client";
import {
  applications,
  documents,
  employers,
  measures,
  participants,
  signatures,
} from "@/db/schema";
import { getStorage } from "@/modules/storage";
import {
  evaluateUploadSet,
  resolveApplicantType,
} from "./upload-set";

// Application package export (concept §14): one merged PDF — cover page
// with an inventory, then every generated/uploaded document in order.

export async function buildApplicationPackage(
  tx: DbHandle,
  applicationId: string,
): Promise<{ bytes: Uint8Array; fileCount: number } | null> {
  const [application] = await tx
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId));
  if (!application) return null;

  const [participant] = await tx
    .select()
    .from(participants)
    .where(eq(participants.id, application.participantId));
  const [employer] = application.employerId
    ? await tx.select().from(employers).where(eq(employers.id, application.employerId))
    : [];
  const [measure] = application.measureId
    ? await tx.select().from(measures).where(eq(measures.id, application.measureId))
    : [];

  const allDocs = await tx
    .select()
    .from(documents)
    .where(eq(documents.participantId, application.participantId));
  const docs = allDocs.filter(
    (d) => (d.signedFilePath ?? d.filePath) && d.type !== "application_package",
  );

  // Path-aware upload-set status (Epic C): the exported package documents the
  // required eService uploads for this applicant_type and whether each is
  // present and signed, from the SAME evaluator that gates submission.
  const docIds = allDocs.map((d) => d.id);
  const sigs = docIds.length
    ? await tx
        .select({
          documentId: signatures.documentId,
          signerKind: signatures.signerKind,
          status: signatures.status,
        })
        .from(signatures)
        .where(inArray(signatures.documentId, docIds))
    : [];
  const uploadSet = evaluateUploadSet({
    applicantType: resolveApplicantType(application.applicantType),
    documents: allDocs,
    signatures: sigs,
  });

  const merged = await PDFDocument.create();
  const font = await merged.embedFont(StandardFonts.Helvetica);
  const bold = await merged.embedFont(StandardFonts.HelveticaBold);

  // Cover page
  const cover = merged.addPage([595, 842]);
  cover.drawText("Antragspaket QCG-Weiterbildung", { x: 50, y: 780, size: 18, font: bold });
  cover.drawText("PLATZHALTER — vollständige Zusammenstellung, kein amtliches Formular", {
    x: 50, y: 760, size: 8, font, color: rgb(0.6, 0.1, 0.1),
  });
  const lines: [string, string][] = [
    ["Teilnehmer:in", participant ? `${participant.firstName} ${participant.lastName}` : "—"],
    ["Arbeitgeber", employer?.companyName ?? "—"],
    ["Betriebsnummer", employer?.betriebsnummer ?? "—"],
    ["Maßnahme", measure?.name ?? "—"],
    ["AZAV-Nr.", measure?.azavNumber ?? "—"],
    ["Erstellt am", new Date().toLocaleDateString("de-DE")],
  ];
  let y = 710;
  for (const [label, value] of lines) {
    cover.drawText(label, { x: 50, y, size: 10, font, color: rgb(0.35, 0.35, 0.35) });
    cover.drawText(value, { x: 200, y, size: 10, font });
    y -= 18;
  }
  y -= 12;
  const pathLabel =
    resolveApplicantType(application.applicantType) === "company"
      ? "Sammelantrag (Firma)"
      : "Einzelantrag";
  cover.drawText(`eService-Upload-Set — ${pathLabel}:`, {
    x: 50,
    y,
    size: 12,
    font: bold,
  });
  y -= 20;
  for (const item of uploadSet.items) {
    const mark = !item.present
      ? "✗ fehlt"
      : item.requiresSignature && !item.signed
        ? item.qesPending
          ? "⧗ QES ausstehend"
          : "⧗ Signatur ausstehend"
        : "✓ vollständig";
    const suffix = item.required ? "" : " (optional)";
    cover.drawText(`${mark} — ${item.label}${suffix}`, { x: 60, y, size: 9, font });
    y -= 15;
  }
  y -= 10;
  cover.drawText("Enthaltene Dokumente:", { x: 50, y, size: 12, font: bold });
  y -= 20;
  docs.forEach((doc, index) => {
    cover.drawText(`${index + 1}. ${doc.title} (${doc.status})`, { x: 60, y, size: 10, font });
    y -= 16;
  });

  // Append every document
  const storage = getStorage();
  let fileCount = 0;
  for (const doc of docs) {
    // Include the signed artifact (stamp + certificate) when present.
    const storageKey = (doc.signedFilePath ?? doc.filePath) as string;

    let bytes: Buffer;
    try {
      bytes = await storage.get(storageKey);
    } catch {
      continue;
    }

    const ext = path.extname(storageKey).toLowerCase();
    if (ext === ".pdf") {
      const source = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(source, source.getPageIndices());
      for (const page of pages) merged.addPage(page);
      fileCount += 1;
    } else if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
      const image =
        ext === ".png" ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
      const page = merged.addPage([595, 842]);
      const scale = Math.min(495 / image.width, 742 / image.height, 1);
      page.drawText(doc.title, { x: 50, y: 800, size: 10, font: bold });
      page.drawImage(image, {
        x: 50,
        y: 780 - image.height * scale,
        width: image.width * scale,
        height: image.height * scale,
      });
      fileCount += 1;
    }
  }

  return { bytes: await merged.save(), fileCount };
}
