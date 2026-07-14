import { boolean, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { channel } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";

// Placeholder German copy lives here until the client provides final texts
// and Meta-approved WhatsApp templates (tracked per key).
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    key: text("key").notNull(),
    channel: channel("channel").notNull(),
    locale: text("locale").notNull().default("de"),
    subject: text("subject"),
    body: text("body").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("message_templates_key_idx").on(t.tenantId, t.key, t.channel),
  ],
);
