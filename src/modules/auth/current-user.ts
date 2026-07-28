import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { users } from "@/db/schema";
import type { SessionUser } from "./session";

export type SignedSessionIdentity = Pick<SessionUser, "id" | "tenantId">;

/** Resolves current role and active state from the database for each request. */
export const resolveActiveSessionUser = async (
  tx: DbHandle,
  identity: SignedSessionIdentity,
): Promise<SessionUser | null> => {
  const [user] = await tx
    .select({
      id: users.id,
      tenantId: users.tenantId,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.id, identity.id),
        eq(users.tenantId, identity.tenantId),
        eq(users.active, true),
      ),
    )
    .limit(1);
  return user ?? null;
};
