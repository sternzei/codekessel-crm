import { sql } from "drizzle-orm";
import { db, withTenant } from "@/db/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { logActivity } from "@/modules/audit/log";
import type { AppRole } from "../authorization";
import type { SessionUser } from "../session";
import type { GoogleIdentity } from "./claims";

// What happens after Google has vouched for an address. The rule the whole
// feature rests on: a Google account by itself grants nothing. It either maps
// onto an approved account, or it creates a row that waits for a human.

type IdentityRow = {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: AppRole;
  active: boolean;
  access_status: "pending" | "approved" | "rejected";
  google_subject: string | null;
};

export type GoogleAccountOutcome =
  /** Approved and active — a session may be created for this user. */
  | { readonly kind: "signed_in"; readonly user: SessionUser }
  /** Known but waiting for (or denied) an approval; no session either way. */
  | { readonly kind: "pending" }
  | { readonly kind: "rejected" }
  | { readonly kind: "deactivated" }
  /** The address belongs to an account already linked to another Google login. */
  | { readonly kind: "conflict" }
  /** Several tenants and no REGISTRATION_TENANT_ID: we refuse to guess. */
  | { readonly kind: "registration_closed" };

// An internal CRM never has hundreds of people waiting for an approval, so a
// queue this long means someone is filling it on purpose.
const MAX_PENDING_REGISTRATIONS = 200;

const lookupIdentity = async (
  identity: GoogleIdentity,
  tenantId: string | null,
): Promise<IdentityRow | undefined> => {
  const rows = await db.execute<IdentityRow>(
    sql`select * from auth_lookup_identity(${identity.email}, ${identity.subject}, ${tenantId})`,
  );
  return rows[0];
};

const resolveRegistrationTenant = async (): Promise<string | null> => {
  if (env.REGISTRATION_TENANT_ID) return env.REGISTRATION_TENANT_ID;
  const rows = await db.execute<{ auth_registration_tenant: string | null }>(
    sql`select auth_registration_tenant()`,
  );
  return rows[0]?.auth_registration_tenant ?? null;
};

const linkGoogleSubject = async (
  userId: string,
  subject: string,
): Promise<boolean> => {
  const rows = await db.execute<{ auth_link_google_subject: boolean | null }>(
    sql`select auth_link_google_subject(${userId}, ${subject})`,
  );
  return rows[0]?.auth_link_google_subject === true;
};

const toSessionUser = (row: IdentityRow): SessionUser => ({
  id: row.id,
  tenantId: row.tenant_id,
  email: row.email,
  name: row.name,
  role: row.role,
});

const isQueueFull = async (tenantId: string): Promise<boolean> => {
  const rows = await db.execute<{ auth_pending_registration_count: number }>(
    sql`select auth_pending_registration_count(${tenantId})`,
  );
  return Number(rows[0]?.auth_pending_registration_count ?? 0) >=
    MAX_PENDING_REGISTRATIONS;
};

const registerPendingUser = async (
  identity: GoogleIdentity,
  tenantId: string,
): Promise<GoogleAccountOutcome> => {
  if (await isQueueFull(tenantId)) {
    logger.warn("google.registration_closed", { reason: "queue_full" });
    return { kind: "registration_closed" };
  }

  let userId: string | null;
  try {
    const rows = await db.execute<{ auth_register_google_user: string | null }>(
      sql`select auth_register_google_user(${tenantId}, ${identity.email}, ${identity.name}, ${identity.subject})`,
    );
    userId = rows[0]?.auth_register_google_user ?? null;
  } catch (error) {
    // A REGISTRATION_TENANT_ID pointing at nothing, or a Google subject already
    // linked to another account, both land here. Neither is something the
    // visitor can fix, and neither may become a half-created account.
    logger.warn("google.registration_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { kind: "registration_closed" };
  }
  // Null means a concurrent request won the insert; the account exists either
  // way and is pending, which is exactly what we report.
  if (!userId) return { kind: "pending" };

  await withTenant(tenantId, (tx) =>
    logActivity(tx, {
      tenantId,
      actorKind: "system",
      subjectKind: "user",
      subjectId: userId,
      event: "user_registration_requested",
      meta: { provider: "google" },
    }),
  );
  logger.info("google.registration_requested", { userId });
  return { kind: "pending" };
};

/**
 * Maps a verified Google identity onto an account.
 *
 * Linking an existing password account by email is safe here *only* because
 * the address was verified by Google (see claims.ts) — an unverified address
 * would make this an account-takeover path.
 */
export const resolveGoogleAccount = async (
  identity: GoogleIdentity,
): Promise<GoogleAccountOutcome> => {
  // Resolved first because it also bounds the address match: an address is
  // only recognised inside the tenant a registration would join, while a
  // linked Google subject is recognised anywhere.
  const tenantId = await resolveRegistrationTenant();
  const row = await lookupIdentity(identity, tenantId);
  if (!row) {
    if (!tenantId) {
      logger.warn("google.registration_closed", { reason: "tenant_ambiguous" });
      return { kind: "registration_closed" };
    }
    return registerPendingUser(identity, tenantId);
  }

  if (row.access_status === "rejected") return { kind: "rejected" };

  if (row.google_subject !== identity.subject) {
    const linked = await linkGoogleSubject(row.id, identity.subject);
    if (!linked) {
      logger.warn("google.link_conflict", { userId: row.id });
      return { kind: "conflict" };
    }
    await withTenant(row.tenant_id, (tx) =>
      logActivity(tx, {
        tenantId: row.tenant_id,
        actorKind: "system",
        subjectKind: "user",
        subjectId: row.id,
        event: "user_google_linked",
      }),
    );
  }

  if (row.access_status === "pending") return { kind: "pending" };
  if (!row.active) return { kind: "deactivated" };
  return { kind: "signed_in", user: toSessionUser(row) };
};
