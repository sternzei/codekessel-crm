import { z } from "zod";

const isProduction = process.env.NODE_ENV === "production";
const PLACEHOLDER_SECRET = /dev-only|change-me|placeholder|example|secret123/i;

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  AUTH_SECRET: z.string().min(16),
  TOKEN_SECRET: z.string().min(16),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  // Durable object storage for uploads + generated/signed PDFs. Defaults to the
  // local-disk driver so dev + single-VM deploys keep working with no cloud
  // creds. Set STORAGE_DRIVER=s3 (+ the S3_* vars) for durable, multi-replica
  // storage on S3 / Cloudflare R2 / MinIO. See src/modules/storage.
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  // Escape hatch for a single always-on VM with a persistent volume mounted at
  // the local storage root. Required in production when STORAGE_DRIVER=local.
  ALLOW_LOCAL_STORAGE_IN_PROD: z.enum(["true", "false"]).optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  // Custom endpoint for S3-compatible providers (R2, MinIO). Omit for AWS S3.
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Required by MinIO and some R2 setups (bucket in the path, not the host).
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
  // Optional key namespace inside the bucket, e.g. "qcg/prod".
  S3_KEY_PREFIX: z.string().optional(),
  // Magic-link token lifetime in hours (default 168 = 7 days). Centrally
  // enforced + clamped to safe guardrails in modules/tokens/policy.ts.
  MAGIC_LINK_TTL_HOURS: z.coerce.number().int().positive().optional(),
  // OpenRegister (Handelsregister) company import. Optional: without a key the
  // register provider falls back to a demo-safe mock adapter (zero credits).
  OPENREGISTER_API_KEY: z.string().optional(),
  OPENREGISTER_BASE_URL: z
    .string()
    .url()
    .default("https://api.openregister.de"),
  // WhatsApp Business Cloud — parked until Meta setup completes. Without the
  // access token + phone-number id the adapter stays in mock mode and the
  // tasks UI uses click-to-chat instead of pretending Cloud sends succeed.
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  // Business display number this WABA represents, in E.164 without the "+"
  // (e.g. 4915510151448). Informational only — LIVE sends are addressed by
  // WHATSAPP_PHONE_NUMBER_ID, not this value. Surfaced in the Postausgang so
  // approvers can see which number a message goes out from.
  WHATSAPP_SENDER_NUMBER: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().optional(),
  WHATSAPP_USE_TEMPLATES: z.enum(["true", "false"]).optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().optional(),
  OUTBOX_STALE_SENDING_MINUTES: z.coerce.number().int().min(5).default(15),
  // Inbound webhook. Optional until Meta setup — without these the webhook
  // route stays inert.
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  // Must be true behind a reverse proxy in production so login rate limits
  // key on the real client IP (see client-ip.ts).
  TRUST_PROXY: z.enum(["true", "false"]).optional(),
  // Resend email. Optional: without both vars the email adapter stays mock.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
}).superRefine((value, ctx) => {
  // The S3 driver is useless without a bucket — fail fast at startup rather
  // than on the first upload.
  if (value.STORAGE_DRIVER === "s3" && !value.S3_BUCKET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["S3_BUCKET"],
      message: "S3_BUCKET is required when STORAGE_DRIVER=s3",
    });
  }
  if (!isProduction) return;
  // Single-VM demos may set ALLOW_LOCAL_STORAGE_IN_PROD=true and keep a local
  // APP_BASE_URL. Multi-replica / public prod must use HTTPS non-localhost.
  const allowSingleVmLocal =
    value.ALLOW_LOCAL_STORAGE_IN_PROD === "true" &&
    value.STORAGE_DRIVER === "local";
  if (
    !allowSingleVmLocal &&
    (value.APP_BASE_URL.includes("localhost") ||
      value.APP_BASE_URL.startsWith("http://"))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["APP_BASE_URL"],
      message:
        "Production requires a public HTTPS APP_BASE_URL (magic links use it)",
    });
  }
  if (value.AUTH_SECRET.length < 32 || PLACEHOLDER_SECRET.test(value.AUTH_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_SECRET"],
      message: "Production AUTH_SECRET must be ≥32 chars and not a placeholder",
    });
  }
  if (
    value.TOKEN_SECRET.length < 32 ||
    PLACEHOLDER_SECRET.test(value.TOKEN_SECRET)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["TOKEN_SECRET"],
      message: "Production TOKEN_SECRET must be ≥32 chars and not a placeholder",
    });
  }
  if (
    value.STORAGE_DRIVER === "local" &&
    value.ALLOW_LOCAL_STORAGE_IN_PROD !== "true"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STORAGE_DRIVER"],
      message:
        "Production requires STORAGE_DRIVER=s3 (or ALLOW_LOCAL_STORAGE_IN_PROD=true with a persistent volume)",
    });
  }
  if (value.TRUST_PROXY !== "true") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["TRUST_PROXY"],
      message:
        "Production behind a reverse proxy must set TRUST_PROXY=true (login rate limits)",
    });
  }
});

// Fail fast at startup: a missing secret must never surface as a runtime 500.
export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  TOKEN_SECRET: process.env.TOKEN_SECRET,
  APP_BASE_URL: process.env.APP_BASE_URL,
  STORAGE_DRIVER: process.env.STORAGE_DRIVER,
  ALLOW_LOCAL_STORAGE_IN_PROD: process.env.ALLOW_LOCAL_STORAGE_IN_PROD,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_REGION: process.env.S3_REGION,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  S3_KEY_PREFIX: process.env.S3_KEY_PREFIX,
  MAGIC_LINK_TTL_HOURS: process.env.MAGIC_LINK_TTL_HOURS,
  OPENREGISTER_API_KEY: process.env.OPENREGISTER_API_KEY,
  OPENREGISTER_BASE_URL: process.env.OPENREGISTER_BASE_URL,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_SENDER_NUMBER: process.env.WHATSAPP_SENDER_NUMBER,
  WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION,
  WHATSAPP_USE_TEMPLATES: process.env.WHATSAPP_USE_TEMPLATES,
  WHATSAPP_TEMPLATE_LANGUAGE: process.env.WHATSAPP_TEMPLATE_LANGUAGE,
  OUTBOX_STALE_SENDING_MINUTES: process.env.OUTBOX_STALE_SENDING_MINUTES,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  TRUST_PROXY: process.env.TRUST_PROXY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
});

if (env.AUTH_SECRET === env.TOKEN_SECRET) {
  throw new Error("AUTH_SECRET and TOKEN_SECRET must differ");
}
