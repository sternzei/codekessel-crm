import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  AUTH_SECRET: z.string().min(16),
  TOKEN_SECRET: z.string().min(16),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  // OpenRegister (Handelsregister) company import. Optional: without a key the
  // register provider falls back to a demo-safe mock adapter (zero credits).
  OPENREGISTER_API_KEY: z.string().optional(),
  OPENREGISTER_BASE_URL: z
    .string()
    .url()
    .default("https://api.openregister.de"),
  // WhatsApp Business Cloud (Phase 3 — provided by the client). Without the
  // access token + phone-number id the messaging adapter stays in demo-safe
  // mock mode (resolveAdapterMode → "mock"). WHATSAPP_USE_TEMPLATES=true
  // switches LIVE sends to Meta-approved HSM templates (required for business-
  // initiated messages outside the 24h session window). Declared here for
  // central validation/documentation; the adapter reads process.env directly
  // so it stays injectable in unit tests.
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().optional(),
  WHATSAPP_USE_TEMPLATES: z.enum(["true", "false"]).optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().optional(),
  // Inbound webhook (§0d step 3). WHATSAPP_WEBHOOK_VERIFY_TOKEN answers Meta's
  // GET subscribe handshake; WHATSAPP_APP_SECRET validates the HMAC signature on
  // POST receipts/replies. Both optional: without them the webhook route is
  // inert (no verification, no state changes) so it is demo-safe to deploy.
  // Declared here for documentation; the route reads process.env directly so it
  // stays injectable in unit tests.
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
});

// Fail fast at startup: a missing secret must never surface as a runtime 500.
export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  TOKEN_SECRET: process.env.TOKEN_SECRET,
  APP_BASE_URL: process.env.APP_BASE_URL,
  OPENREGISTER_API_KEY: process.env.OPENREGISTER_API_KEY,
  OPENREGISTER_BASE_URL: process.env.OPENREGISTER_BASE_URL,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION,
  WHATSAPP_USE_TEMPLATES: process.env.WHATSAPP_USE_TEMPLATES,
  WHATSAPP_TEMPLATE_LANGUAGE: process.env.WHATSAPP_TEMPLATE_LANGUAGE,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
});

if (env.AUTH_SECRET === env.TOKEN_SECRET) {
  throw new Error("AUTH_SECRET and TOKEN_SECRET must differ");
}
