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
});

if (env.AUTH_SECRET === env.TOKEN_SECRET) {
  throw new Error("AUTH_SECRET and TOKEN_SECRET must differ");
}
