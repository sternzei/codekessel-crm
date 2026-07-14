-- ============================================================================
-- Row-Level Security setup.
--
-- Model:
--   * Migrations + seed run as the table owner (bypasses RLS by design).
--   * The app runtime connects as `qcg_app` and MUST open every transaction
--     via withTenant(), which runs:
--       select set_config('app.tenant_id', '<uuid>', true);
--     Every policy filters on that setting. No setting => no rows.
--   * activity_log and consent_records are append-only (no UPDATE/DELETE).
--   * auth_lookup_user() is the single deliberate exception: login happens
--     before a tenant is known, so it is SECURITY DEFINER and limited to one
--     email-keyed lookup on active users.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qcg_app') THEN
    -- Dev password; production must override via ALTER ROLE / secret manager.
    CREATE ROLE qcg_app LOGIN PASSWORD 'qcg_app_dev_pw';
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO qcg_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qcg_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qcg_app;
--> statement-breakpoint

-- Append-only tables: take UPDATE/DELETE back away.
REVOKE UPDATE, DELETE ON activity_log FROM qcg_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON consent_records FROM qcg_app;
--> statement-breakpoint

-- Tenants table: readable only for the active tenant, never writable by app.
REVOKE INSERT, UPDATE, DELETE ON tenants FROM qcg_app;
--> statement-breakpoint
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_self ON tenants FOR SELECT TO qcg_app
  USING (id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

-- Tenant isolation for all domain tables.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON users FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE measures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON measures FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE employers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON employers FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON participants FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON appointments FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE aptitude_tests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON aptitude_tests FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON routing_rules FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tasks FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE magic_link_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON magic_link_tokens FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON applications FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON documents FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON signatures FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE reminder_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON reminder_jobs FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_templates FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

-- Append-only: separate SELECT + INSERT policies, no UPDATE/DELETE policy
-- (grants already revoked above — defense in depth).
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_select ON activity_log FOR SELECT TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
CREATE POLICY tenant_insert ON activity_log FOR INSERT TO qcg_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_select ON consent_records FOR SELECT TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
CREATE POLICY tenant_insert ON consent_records FOR INSERT TO qcg_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

-- Tasks: owner reference must match owner_kind (exactly one owner set).
ALTER TABLE tasks ADD CONSTRAINT tasks_owner_matches_kind CHECK (
  (owner_kind = 'internal_user' AND owner_user_id IS NOT NULL
     AND owner_participant_id IS NULL AND owner_employer_id IS NULL)
  OR (owner_kind = 'participant' AND owner_participant_id IS NOT NULL
     AND owner_user_id IS NULL AND owner_employer_id IS NULL)
  OR (owner_kind = 'employer' AND owner_employer_id IS NOT NULL
     AND owner_user_id IS NULL AND owner_participant_id IS NULL)
);
--> statement-breakpoint

-- Login lookup: the single tenant-unscoped read, owner-privileged, one email.
CREATE OR REPLACE FUNCTION auth_lookup_user(p_email text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  email text,
  name text,
  role user_role,
  password_hash text,
  active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.tenant_id, u.email, u.name, u.role, u.password_hash, u.active
  FROM users u
  WHERE lower(u.email) = lower(p_email) AND u.active
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO qcg_app;
