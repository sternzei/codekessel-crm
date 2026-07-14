import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { channel } from "./enums";
import { createdAt, tenantId } from "./helpers";
import { participants } from "./participants";
import { users } from "./users";

// Free-text notes from calls and messages — the consultant's memory of a
// lead. Kept out of activity_log on purpose: notes carry PII, the audit
// stream must not.
export const contactNotes = pgTable(
  "contact_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    channel: channel("channel").notNull().default("internal"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("contact_notes_participant_idx").on(t.participantId)],
);
