-- Two tables were left without RLS on purpose: they are not tenant-scoped, and
-- the app reaches them only by a key it already had to be allowed to read.
-- That reasoning holds as long as the only way into the database is this app.
--
-- On a managed platform it stops holding. Supabase publishes the `public`
-- schema through an auto-generated REST API and grants the `anon` and
-- `authenticated` roles access to new tables by default, so a table with
-- grants and no RLS is world-readable to anyone holding the anon key — which
-- is a public value by design. For `storage_objects` that would mean every
-- uploaded document and every signed PDF.
--
-- So: deny-by-default for every role except the app role, and take the
-- platform's blanket grants back. Both halves are safe on a plain Postgres —
-- the second one does nothing when those roles do not exist.

ALTER TABLE "storage_objects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Unconditional rather than tenant-scoped: this keeps today's access model
-- exactly as it was for the app, while every other role now reads zero rows.
-- The table owner (migrations, the worker) bypasses RLS as always.
CREATE POLICY "storage_objects_app" ON "storage_objects" FOR ALL TO qcg_app
  USING (true) WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rate_limit_buckets_app" ON "rate_limit_buckets" FOR ALL TO qcg_app
  USING (true) WITH CHECK (true);
--> statement-breakpoint

-- `service_role` is deliberately left alone: it needs the secret key, which
-- never leaves a server, and revoking it would break the platform tooling an
-- operator may still want. Treat that key as a root credential.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    -- Without this, the next migration that creates a table re-opens the hole.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END
$$;
