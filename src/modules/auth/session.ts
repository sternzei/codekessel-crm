import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { withTenant } from "@/db/client";
import { env } from "@/lib/env";
import type { AppRole } from "./authorization";
import { resolveActiveSessionUser } from "./current-user";

// Lean, self-contained session handling for internal users (consultant/admin).
// Deliberately not Auth.js: internal-only credentials auth on Next 16 needs
// ~80 lines with jose and zero external identity processors (DSGVO-relevant).
// The interface below is small enough to swap for Auth.js later if needed.

const SESSION_COOKIE = "qcg_session";
const SESSION_TTL_HOURS = 12;
const secret = new TextEncoder().encode(env.AUTH_SECRET);

export type SessionUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: AppRole;
};

export async function createSession(user: SessionUser): Promise<void> {
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const token = await new SignJWT({
    tid: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(secret);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires,
    path: "/",
  });
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getCachedSession = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    // A cookie whose claims are the wrong shape is no session at all. The id
    // and tenant are checked against the UUID form before they reach the
    // database: otherwise a malformed pair turns every page into a 500 (the
    // query rejects on the cast) instead of a clean redirect to sign-in.
    if (
      typeof payload.sub !== "string" ||
      typeof payload.tid !== "string" ||
      !UUID_PATTERN.test(payload.sub) ||
      !UUID_PATTERN.test(payload.tid) ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      (payload.role !== "consultant" &&
        payload.role !== "manager" &&
        payload.role !== "admin")
    ) {
      return null;
    }
    const identity = {
      id: payload.sub,
      tenantId: payload.tid,
    };
    return withTenant(identity.tenantId, (tx) =>
      resolveActiveSessionUser(tx, identity),
    );
  } catch {
    return null;
  }
});

export const getSession = (): Promise<SessionUser | null> => getCachedSession();

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Returns the session only if the user's current database role is admin.
 * OpenRegister import is intentionally admin-only by product policy; managers
 * are excluded. Never rely on hiding its navigation link alone.
 */
export async function getAdminSession(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}
