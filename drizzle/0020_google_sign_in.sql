-- Sign in with Google, gated by an admin approval.
--
-- Anyone may present a Google account, so the resulting row must grant nothing
-- on its own: `access_status` starts at 'pending' and only 'approved' can hold
-- a session (see modules/auth/current-user.ts and auth_lookup_user below).
--
-- Registration happens before any tenant context exists, exactly like the
-- password login, so it goes through narrow SECURITY DEFINER functions rather
-- than opening the RLS policies on `users`.

CREATE TYPE "user_access_status" AS ENUM ('pending', 'approved', 'rejected');
--> statement-breakpoint

-- Backfilled as 'approved': every existing row was created by an admin who had
-- already vetted it, and a wrong default here would lock the tenant out.
ALTER TABLE "users"
  ADD COLUMN "google_subject" text,
  ADD COLUMN "email_verified_at" timestamp with time zone,
  ADD COLUMN "access_status" "user_access_status" NOT NULL DEFAULT 'approved';
--> statement-breakpoint

-- New rows fail closed. Callers that vet the account (admin user creation, the
-- tenant bootstrap) set 'approved' explicitly.
ALTER TABLE "users" ALTER COLUMN "access_status" SET DEFAULT 'pending';
--> statement-breakpoint

-- Global rather than per tenant: one Google account is one identity here.
CREATE UNIQUE INDEX IF NOT EXISTS "users_google_subject_idx"
  ON "users" ("google_subject");
--> statement-breakpoint

-- Password login: pending and rejected accounts must not be able to sign in
-- even if a password was somehow set on them.
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
  WHERE lower(u.email) = lower(p_email)
    AND u.active
    AND u.access_status = 'approved'
  LIMIT 1;
$$;
--> statement-breakpoint

-- The OAuth callback needs to see pending and rejected accounts too, so it can
-- tell "waiting for approval" apart from "unknown". It deliberately returns no
-- password_hash: this path never compares one.
--
-- The two match kinds have deliberately different reach. A Google subject is
-- globally unique and was linked by an explicit act, so it matches anywhere. An
-- address is not: the same address may exist in several tenants, so it matches
-- only inside p_tenant_id — the tenant a registration would join. Matching an
-- address across tenants would hand a stranger a session in whichever row the
-- database happened to return first.
CREATE OR REPLACE FUNCTION auth_lookup_identity(
  p_email text,
  p_google_subject text,
  p_tenant_id uuid
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  email text,
  name text,
  role user_role,
  active boolean,
  access_status user_access_status,
  google_subject text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.tenant_id, u.email, u.name, u.role, u.active, u.access_status,
         u.google_subject
  FROM users u
  WHERE (p_google_subject IS NOT NULL AND u.google_subject = p_google_subject)
     OR (p_tenant_id IS NOT NULL
         AND u.tenant_id = p_tenant_id
         AND lower(u.email) = lower(p_email))
  -- A subject match wins over an address match: it is the stable identifier,
  -- and the address on a Google account can change.
  ORDER BY (u.google_subject IS NOT DISTINCT FROM p_google_subject) DESC
  LIMIT 1;
$$;
--> statement-breakpoint

-- Soft cap on the approval queue. Registration is open to anyone with a Google
-- account, so without a ceiling a distributed flood could fill the table and
-- bury real requests. An internal CRM never has hundreds of people waiting.
CREATE OR REPLACE FUNCTION auth_pending_registration_count(p_tenant_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) FROM users
  WHERE tenant_id = p_tenant_id AND access_status = 'pending';
$$;
--> statement-breakpoint

-- Which tenant a self-registration joins. Single-tenant deployments need no
-- configuration; with several tenants the caller must name one, because
-- guessing would put a stranger into someone's data.
CREATE OR REPLACE FUNCTION auth_registration_tenant()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM tenants
  WHERE (SELECT count(*) FROM tenants) = 1
  LIMIT 1;
$$;
--> statement-breakpoint

-- Creates the pending account. Role is forced to the least privileged one and
-- no password is set, so the row can only ever be used through Google and only
-- after an approval.
CREATE OR REPLACE FUNCTION auth_register_google_user(
  p_tenant_id uuid,
  p_email text,
  p_name text,
  p_google_subject text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO users (tenant_id, email, name, role, google_subject,
                     email_verified_at, access_status, active)
  VALUES (p_tenant_id, lower(p_email), p_name, 'consultant', p_google_subject,
          now(), 'pending', true)
  ON CONFLICT (tenant_id, email) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- Links a Google account to a row that already exists for the same verified
-- address. Refuses to move a subject that is already linked elsewhere.
CREATE OR REPLACE FUNCTION auth_link_google_subject(
  p_user_id uuid,
  p_google_subject text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE users
  SET google_subject = p_google_subject,
      email_verified_at = coalesce(email_verified_at, now()),
      updated_at = now()
  WHERE id = p_user_id
    AND (google_subject IS NULL OR google_subject = p_google_subject)
  RETURNING true;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_lookup_identity(text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_pending_registration_count(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_registration_tenant() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_register_google_user(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_link_google_subject(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_lookup_identity(text, text, uuid) TO qcg_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_pending_registration_count(uuid) TO qcg_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_registration_tenant() TO qcg_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_register_google_user(uuid, text, text, text) TO qcg_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_link_google_subject(uuid, text) TO qcg_app;
