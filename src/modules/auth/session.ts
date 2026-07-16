import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

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
  role: "consultant" | "admin";
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

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    if (
      typeof payload.sub !== "string" ||
      typeof payload.tid !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      (payload.role !== "consultant" && payload.role !== "admin")
    ) {
      return null;
    }
    return {
      id: payload.sub,
      tenantId: payload.tid,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Returns the session only if the user is an admin. The role lives in the
 * signed session cookie, so this is a real authorization check, not a UI hint.
 * Admin-only surfaces (e.g. the OpenRegister import) call this in the server
 * action itself — never rely on hiding a nav link alone.
 */
export async function getAdminSession(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}
