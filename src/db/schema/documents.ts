import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { documentStatus } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { applications } from "./applications";
import { employers } from "./employers";
import { participants } from "./participants";

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  status: documentStatus("status").notNull().default("data_missing"),

  participantId: uuid("participant_id").references(() => participants.id),
  employerId: uuid("employer_id").references(() => employers.id),
  applicationId: uuid("application_id").references(() => applications.id),

  // Template the file is generated/prefilled from (templates/pdf, templates/documents).
  templateKey: text("template_key"),
  filePath: text("file_path"),
  sha256: text("sha256"),

  // Signed artifact: original file_path/sha256 stay the integrity anchor
  // (what was actually signed); these hold the stamped + certificate PDF
  // produced once every required signature is collected.
  signedFilePath: text("signed_file_path"),
  signedSha256: text("signed_sha256"),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
