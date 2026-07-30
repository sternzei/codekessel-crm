-- Blob storage inside Postgres, selected with STORAGE_DRIVER=db.
--
-- Uploads and generated/signed PDFs are DSGVO/AZAV artifacts that must outlive
-- a container. Keeping them here means one durable store and one backup for an
-- internal CRM, at the cost of carrying every document through pg_dump — see
-- docs/PRODUCTION-READINESS.md for the backup split that keeps restores fast.
--
-- No RLS, deliberately: rows are addressed only by an unguessable key that the
-- caller obtained from a documents/signature row it was already allowed to read
-- under RLS. That is the same trust model the filesystem driver has. Scoping
-- this per tenant later is additive (add tenant_id + a policy + one put() field).
CREATE TABLE IF NOT EXISTS "storage_objects" (
  "key" text PRIMARY KEY NOT NULL,
  "content_type" text,
  -- Kept alongside the blob so "how much is in here / what is large" never has
  -- to read the bytes themselves.
  "byte_size" integer NOT NULL,
  "bytes" bytea NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "storage_objects" TO qcg_app;
