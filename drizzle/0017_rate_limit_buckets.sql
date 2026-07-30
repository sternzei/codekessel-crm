-- Shared rate-limit buckets for login + anonymous /t throttles.
-- No RLS: buckets are keyed by IP/email before tenant context exists.
CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "key" text PRIMARY KEY NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "rate_limit_buckets" TO qcg_app;
