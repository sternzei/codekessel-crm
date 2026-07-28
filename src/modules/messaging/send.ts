import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { employers, participants } from "@/db/schema";
import type { Recipient } from "./types";

/** Resolve name + addresses for a task owner. */
export async function resolveRecipient(
  tx: DbHandle,
  ownerKind: "participant" | "employer",
  ownerId: string,
): Promise<Recipient | null> {
  if (ownerKind === "participant") {
    const [p] = await tx
      .select({
        firstName: participants.firstName,
        lastName: participants.lastName,
        email: participants.email,
        phone: participants.phone,
      })
      .from(participants)
      .where(eq(participants.id, ownerId));
    if (!p) return null;
    return {
      kind: "participant",
      id: ownerId,
      email: p.email,
      phone: p.phone,
      displayName: p.firstName,
    };
  }

  const [e] = await tx
    .select({
      companyName: employers.companyName,
      contactName: employers.contactName,
      email: employers.contactEmail,
      phone: employers.contactPhone,
    })
    .from(employers)
    .where(eq(employers.id, ownerId));
  if (!e) return null;
  return {
    kind: "employer",
    id: ownerId,
    email: e.email,
    phone: e.phone,
    displayName: e.contactName ?? e.companyName,
  };
}
