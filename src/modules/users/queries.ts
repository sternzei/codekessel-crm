import { asc } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { users } from "@/db/schema";

export type TenantUserRow = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: "consultant" | "manager" | "admin";
  readonly active: boolean;
  readonly createdAt: Date;
};

/**
 * Lists all users in the current tenant (RLS-scoped via withTenant).
 */
export async function listTenantUsers(tx: DbHandle): Promise<TenantUserRow[]> {
  const rows = await tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.name));
  return rows.map((row) => ({
    ...row,
    role: row.role as TenantUserRow["role"],
  }));
}
