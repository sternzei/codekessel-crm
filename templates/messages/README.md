# Message Templates (Placeholders)

Draft German copy for WhatsApp/email lives in the `message_templates` table
(seeded in `src/db/seed.ts`) so it is editable at runtime.

WhatsApp business-initiated messages require Meta-approved templates; keys in
the table map 1:1 to the approved template names once the client provides
WhatsApp Business API credentials (Phase 3).
