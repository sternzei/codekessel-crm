"use server";

import { compare } from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { rateLimitClientKey } from "@/lib/client-ip";
import {
  clearAttempts,
  isRateLimited,
  recordFailure,
} from "@/lib/rate-limit";
import { createSession, destroySession } from "./session";
import type { AppRole } from "./authorization";

// Brute-force guard: cap *failed* login attempts per client IP within a
// window. A successful login clears the counter, so legitimate users are
// never throttled.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 5 * 60_000; // 5 minutes
const LOGIN_OPTS = { limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS };

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type UserRow = {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: AppRole;
  password_hash: string | null;
  active: boolean;
};

export async function login(formData: FormData): Promise<void> {
  const headerStore = await headers();
  // Keyed on the proxy-appended client IP only (see lib/client-ip): a
  // spoofed x-forwarded-for first entry must not mint a fresh bucket.
  const rateKey = `login:${rateLimitClientKey(headerStore)}`;
  if (isRateLimited(rateKey, LOGIN_OPTS).limited) {
    redirect("/auth/sign-in?error=rate");
  }

  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    recordFailure(rateKey, LOGIN_OPTS);
    redirect("/auth/sign-in?error=1");
  }

  // SECURITY DEFINER function: the only tenant-unscoped read in the app,
  // because at login time no tenant context exists yet (see RLS migration).
  const rows = await db.execute<UserRow>(
    sql`select * from auth_lookup_user(${parsed.data.email})`,
  );
  const user = rows[0];

  const passwordOk =
    user?.password_hash != null &&
    (await compare(parsed.data.password, user.password_hash));
  if (!user || !passwordOk) {
    recordFailure(rateKey, LOGIN_OPTS);
    redirect("/auth/sign-in?error=1");
  }

  clearAttempts(rateKey);
  await createSession({
    id: user.id,
    tenantId: user.tenant_id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
  redirect("/pipeline");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/auth/sign-in");
}
