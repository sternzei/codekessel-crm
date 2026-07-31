import { asc, eq, ne } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { users } from "@/db/schema";

export type UserAccessStatus = "pending" | "approved" | "rejected";

export type TenantUserRow = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: "consultant" | "manager" | "admin";
  readonly active: boolean;
  readonly accessStatus: UserAccessStatus;
  readonly hasGoogleLogin: boolean;
  readonly createdAt: Date;
};

const selection = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  active: users.active,
  accessStatus: users.accessStatus,
  googleSubject: users.googleSubject,
  createdAt: users.createdAt,
};

type SelectedRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  accessStatus: string;
  googleSubject: string | null;
  createdAt: Date;
};

const toRow = (row: SelectedRow): TenantUserRow => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role as TenantUserRow["role"],
  active: row.active,
  accessStatus: row.accessStatus as UserAccessStatus,
  hasGoogleLogin: row.googleSubject !== null,
  createdAt: row.createdAt,
});

/**
 * Lists the accounts that already have access (RLS-scoped via withTenant).
 * Requests awaiting a decision are listed separately so they cannot be
 * mistaken for working accounts.
 */
export async function listTenantUsers(tx: DbHandle): Promise<TenantUserRow[]> {
  const rows = await tx
    .select(selection)
    .from(users)
    .where(ne(users.accessStatus, "pending"))
    .orderBy(asc(users.name));
  return rows.map(toRow);
}

/**
 * Lists sign-in attempts waiting for a decision, oldest first — someone who
 * asked yesterday should not end up below someone who asked a minute ago.
 */
export async function listAccessRequests(
  tx: DbHandle,
): Promise<TenantUserRow[]> {
  const rows = await tx
    .select(selection)
    .from(users)
    .where(eq(users.accessStatus, "pending"))
    .orderBy(asc(users.createdAt));
  return rows.map(toRow);
}
