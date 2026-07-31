"use server";

import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import {
  canAssignUserRole,
  canManageUsers,
  canMutateExistingUser,
  type AppRole,
} from "@/modules/auth/authorization";
import { getSession } from "@/modules/auth/session";

const BCRYPT_ROUNDS = 10;
const MIN_TEMP_PASSWORD_LENGTH = 8;

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  role: z.enum(["consultant", "manager", "admin"]),
  password: z.string().min(MIN_TEMP_PASSWORD_LENGTH).max(200),
});

const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["consultant", "manager", "admin"]),
});

const activeSchema = z.object({
  userId: z.string().uuid(),
  active: z.enum(["true", "false"]),
});

const resetSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(MIN_TEMP_PASSWORD_LENGTH).max(200),
});

const accessSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["consultant", "manager", "admin"]),
});

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const redirectUsers = (banner: string): never => {
  redirect(`/users?result=${banner}`);
};

/**
 * Creates a tenant user with a temporary password (no invite email yet).
 */
export async function createUser(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  if (!canManageUsers(session.role)) redirectUsers("forbidden");

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirectUsers("invalid");
    return;
  }
  const input = parsed.data;

  const roleDecision = canAssignUserRole({
    actorRole: session.role,
    targetRole: input.role,
  });
  if (roleDecision !== "allowed") {
    redirectUsers("forbidden");
    return;
  }

  const email = normalizeEmail(input.email);
  const passwordHash = await hash(input.password, BCRYPT_ROUNDS);

  const created = await withTenant(session.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, session.tenantId), eq(users.email, email)))
      .limit(1);
    if (existing) return null;

    const [row] = await tx
      .insert(users)
      .values({
        tenantId: session.tenantId,
        name: input.name,
        email,
        role: input.role,
        passwordHash,
        // Vetted by the admin who is creating it, so it skips the approval
        // queue that self-registrations land in.
        accessStatus: "approved",
        active: true,
      })
      .returning({ id: users.id });

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "user",
      subjectId: row.id,
      event: "user_created",
      meta: { role: input.role },
    });
    return row;
  });

  if (!created) {
    redirectUsers("exists");
    return;
  }
  revalidatePath("/users");
  redirectUsers("created");
}

/**
 * Changes an existing user's role within the tenant (cannot change own role).
 */
export async function setUserRole(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  if (!canManageUsers(session.role)) redirectUsers("forbidden");

  const parsed = roleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    redirectUsers("invalid");
    return;
  }
  const input = parsed.data;

  // A sole admin demoting themselves would leave the tenant with nobody able to
  // administer users, so self role changes always go through someone else.
  if (input.userId === session.id) {
    redirectUsers("forbidden");
    return;
  }

  const roleDecision = canAssignUserRole({
    actorRole: session.role,
    targetRole: input.role,
  });
  if (roleDecision !== "allowed") {
    redirectUsers("forbidden");
    return;
  }

  const outcome = await withTenant(session.tenantId, async (tx) => {
    const [target] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!target) return "invalid" as const;

    const mutateDecision = canMutateExistingUser({
      actorRole: session.role,
      currentRole: target.role as AppRole,
    });
    if (mutateDecision !== "allowed") return "forbidden" as const;

    await tx
      .update(users)
      .set({ role: input.role })
      .where(eq(users.id, target.id));

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "user",
      subjectId: target.id,
      event: "user_role_changed",
      meta: { from: target.role, to: input.role },
    });
    return "updated" as const;
  });

  revalidatePath("/users");
  redirectUsers(outcome);
}

/**
 * Activates or deactivates a tenant user (cannot deactivate self).
 */
export async function setUserActive(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  if (!canManageUsers(session.role)) redirectUsers("forbidden");

  const parsed = activeSchema.safeParse({
    userId: formData.get("userId"),
    active: formData.get("active"),
  });
  if (!parsed.success) {
    redirectUsers("invalid");
    return;
  }
  const input = parsed.data;
  if (input.userId === session.id) {
    redirectUsers("forbidden");
    return;
  }

  const nextActive = input.active === "true";

  const outcome = await withTenant(session.tenantId, async (tx) => {
    const [target] = await tx
      .select({ id: users.id, role: users.role, active: users.active })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!target) return "invalid" as const;

    const mutateDecision = canMutateExistingUser({
      actorRole: session.role,
      currentRole: target.role as AppRole,
    });
    if (mutateDecision !== "allowed") return "forbidden" as const;

    await tx
      .update(users)
      .set({ active: nextActive })
      .where(eq(users.id, target.id));

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "user",
      subjectId: target.id,
      event: "user_active_changed",
      meta: { active: nextActive },
    });
    return "updated" as const;
  });

  revalidatePath("/users");
  redirectUsers(outcome);
}

/**
 * Grants access to an account that registered itself through Google, with the
 * role the reviewer picks. This is the only step that turns a self-created row
 * into a usable account, so it re-checks the role rules server-side rather than
 * trusting the select box the form came from.
 */
export async function approveUserAccess(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  if (!canManageUsers(session.role)) redirectUsers("forbidden");

  const parsed = accessSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    redirectUsers("invalid");
    return;
  }
  const input = parsed.data;

  const roleDecision = canAssignUserRole({
    actorRole: session.role,
    targetRole: input.role,
  });
  if (roleDecision !== "allowed") {
    redirectUsers("forbidden");
    return;
  }

  const outcome = await withTenant(session.tenantId, async (tx) => {
    const [target] = await tx
      .select({
        id: users.id,
        role: users.role,
        accessStatus: users.accessStatus,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!target) return "invalid" as const;
    // Approving something that is already approved would silently overwrite the
    // role an admin set elsewhere.
    if (target.accessStatus === "approved") return "invalid" as const;

    const mutateDecision = canMutateExistingUser({
      actorRole: session.role,
      currentRole: target.role as AppRole,
    });
    if (mutateDecision !== "allowed") return "forbidden" as const;

    await tx
      .update(users)
      .set({ accessStatus: "approved", role: input.role, active: true })
      .where(eq(users.id, target.id));

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "user",
      subjectId: target.id,
      event: "user_access_approved",
      meta: { role: input.role },
    });
    return "approved" as const;
  });

  revalidatePath("/users");
  redirectUsers(outcome);
}

/**
 * Denies a registration. The row is kept rather than deleted so the same Google
 * account cannot quietly re-register, and so the decision stays auditable.
 */
export async function rejectUserAccess(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  if (!canManageUsers(session.role)) redirectUsers("forbidden");

  const parsed = z
    .object({ userId: z.string().uuid() })
    .safeParse({ userId: formData.get("userId") });
  if (!parsed.success) {
    redirectUsers("invalid");
    return;
  }
  const { userId } = parsed.data;
  if (userId === session.id) {
    redirectUsers("forbidden");
    return;
  }

  const outcome = await withTenant(session.tenantId, async (tx) => {
    const [target] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) return "invalid" as const;

    const mutateDecision = canMutateExistingUser({
      actorRole: session.role,
      currentRole: target.role as AppRole,
    });
    if (mutateDecision !== "allowed") return "forbidden" as const;

    await tx
      .update(users)
      .set({ accessStatus: "rejected", active: false })
      .where(eq(users.id, target.id));

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "user",
      subjectId: target.id,
      event: "user_access_rejected",
    });
    return "rejected" as const;
  });

  revalidatePath("/users");
  redirectUsers(outcome);
}

/**
 * Sets a new temporary password for a tenant user.
 */
export async function resetUserPassword(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  if (!canManageUsers(session.role)) redirectUsers("forbidden");

  const parsed = resetSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirectUsers("invalid");
    return;
  }
  const input = parsed.data;

  const passwordHash = await hash(input.password, BCRYPT_ROUNDS);

  const outcome = await withTenant(session.tenantId, async (tx) => {
    const [target] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!target) return "invalid" as const;

    const mutateDecision = canMutateExistingUser({
      actorRole: session.role,
      currentRole: target.role as AppRole,
    });
    if (mutateDecision !== "allowed") return "forbidden" as const;

    await tx
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, target.id));

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "user",
      subjectId: target.id,
      event: "user_password_reset",
    });
    return "passwordReset" as const;
  });

  revalidatePath("/users");
  redirectUsers(outcome);
}
