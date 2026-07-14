import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so .env.local is not loaded automatically.
import { config } from "dotenv";
config({ path: ".env.local" });

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
