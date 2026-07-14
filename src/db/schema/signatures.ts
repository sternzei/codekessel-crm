import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ownerKind, signatureStatus } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { documents } from "./documents";
import { employers } from "./employers";
import { participants } from "./participants";
import { users } from "./users";

// Audit-grade signature record. `provider` keeps the door open for
// Skribble/Yousign (QES) behind the same interface — MVP uses "canvas".
export const signatures = pgTable("signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  status: signatureStatus("status").notNull().default("pending"),

  signerKind: ownerKind("signer_kind").notNull(),
  signerParticipantId: uuid("signer_participant_id").references(
    () => participants.id,
  ),
  signerEmployerId: uuid("signer_employer_id").references(() => employers.id),
  signerUserId: uuid("signer_user_id").references(() => users.id),

  // Audit trail: who, when, from where, over exactly which file version.
  signerName: text("signer_name"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  ipAddress: text("ip_address"),
  documentSha256: text("document_sha256"),
  provider: text("provider").notNull().default("canvas"),
  signatureImagePath: text("signature_image_path"),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
