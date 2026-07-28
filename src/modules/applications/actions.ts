"use server";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { applications, documents, participants } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { getSession } from "@/modules/auth/session";
import { processTransition } from "@/modules/routing/engine";
import { buildStorageKey, getStorage } from "@/modules/storage";
import { buildApplicationPackage } from "./package";
import {
  ApplicationNotReadyError,
  ApplicationTransitionError,
  changeApplicationStatus,
} from "./service";

export async function createApplication(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const participantId = z.string().uuid().parse(formData.get("participantId"));
  const applicantType = z
    .enum(["single", "company"])
    .catch("single")
    .parse(formData.get("applicantType"));

  await withTenant(session.tenantId, async (tx) => {
    const [participant] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, participantId));
    // Both parties must exist before an application makes sense.
    if (!participant?.employerId || !participant.measureId) return;

    const existing = await tx
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.participantId, participantId)));
    if (existing.length > 0) return;

    const [application] = await tx
      .insert(applications)
      .values({
        tenantId: session.tenantId,
        participantId,
        employerId: participant.employerId,
        measureId: participant.measureId,
        applicantType,
      })
      .returning({ id: applications.id });

    await processTransition(tx, {
      tenantId: session.tenantId,
      entity: "application",
      entityId: application.id,
      status: "in_preparation",
      actorKind: "internal_user",
      actorUserId: session.id,
      context: {
        participantId,
        employerId: participant.employerId,
        consultantId: participant.assignedConsultantId ?? session.id,
      },
    });
  });

  revalidatePath(`/documents/${participantId}`);
  revalidatePath("/applications");
}

const statusSchema = z.enum([
  "in_preparation",
  "complete",
  "sent_to_employer",
  "submitted",
  "approved",
  "rejected",
  "correction_required",
]);

export async function setApplicationStatus(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const applicationId = z.string().uuid().parse(formData.get("applicationId"));
  const to = statusSchema.parse(formData.get("status"));
  const responseNote = z
    .string()
    .trim()
    .max(2000)
    .optional()
    .parse(formData.get("responseNote") ?? undefined);

  await withTenant(session.tenantId, async (tx) => {
    try {
      await changeApplicationStatus(tx, {
        applicationId,
        to,
        actorKind: "internal_user",
        actorUserId: session.id,
        responseNote,
      });
    } catch (error: unknown) {
      // Illegal status jumps are ignored (idempotent re-clicks). A blocked
      // readiness gate is meaningful and must surface, not be swallowed.
      if (error instanceof ApplicationNotReadyError) throw error;
      if (error instanceof ApplicationTransitionError) return;
      throw error;
    }
  });

  revalidatePath("/applications");
  revalidatePath("/pipeline");
}

/**
 * Merges all of the participant's documents into one Antragspaket PDF and
 * stores it as a document row — the export the admin sends to the AG-S.
 */
export async function exportApplicationPackage(
  formData: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const applicationId = z.string().uuid().parse(formData.get("applicationId"));

  await withTenant(session.tenantId, async (tx) => {
    const result = await buildApplicationPackage(tx, applicationId);
    if (!result) return;

    const [application] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId));
    if (!application) return;

    const filePath = await getStorage().put({
      key: buildStorageKey({ prefix: "documents", extension: "pdf" }),
      bytes: result.bytes,
      contentType: "application/pdf",
    });

    const [doc] = await tx
      .insert(documents)
      .values({
        tenantId: session.tenantId,
        type: "application_package",
        title: `Antragspaket (${result.fileCount} Dokumente)`,
        status: "approved",
        participantId: application.participantId,
        employerId: application.employerId,
        applicationId,
        filePath,
        sha256: createHash("sha256").update(result.bytes).digest("hex"),
      })
      .returning({ id: documents.id });

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "application",
      subjectId: applicationId,
      event: "package_exported",
      meta: { documentId: doc.id, fileCount: result.fileCount },
    });
  });

  revalidatePath("/applications");
}
