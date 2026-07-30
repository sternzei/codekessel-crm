"use server";

import { compare } from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { requestClientIp } from "@/lib/client-ip";
import {
  clearAttemptsAsync,
  isRateLimitedAsync,
  recordFailureAsync,
} from "@/lib/rate-limit-store";
import { createSession, destroySession } from "./session";
import type { AppRole } from "./authorization";

// Brute-force guard with two budgets, both counting only *failed* attempts:
//
//   1. Per account+client — stops password guessing against one inbox. A
//      successful login clears it, so legitimate users are never throttled.
//   2. Per client IP across all accounts — stops password spraying, where one
//      attacker tries a few passwords against many different addresses and
//      would otherwise get a fresh per-account budget for each one.
//
// The IP budget applies ONLY when the IP is knowable (TRUST_PROXY + a proxy
// that appends the peer address). Without it every caller shares one bucket,
// so an IP-wide cap would lock out all users at once.
const LOGIN_LIMIT = 10;
const LOGIN_IP_LIMIT = 30;
const LOGIN_WINDOW_MS = 5 * 60_000; // 5 minutes
const LOGIN_OPTS = { limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS };
const LOGIN_IP_OPTS = { limit: LOGIN_IP_LIMIT, windowMs: LOGIN_WINDOW_MS };

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

const buildAccountKey = (email: string, clientKey: string): string =>
  `login:acct:${email.trim().toLowerCase()}:${clientKey}`;

const buildIpKey = (clientIp: string): string => `login:ip:${clientIp}`;

export async function login(formData: FormData): Promise<void> {
  const headerStore = await headers();
  const clientIp = requestClientIp(headerStore);
  const clientKey = clientIp ?? "untrusted";
  const ipKey = clientIp ? buildIpKey(clientIp) : null;

  if (ipKey && (await isRateLimitedAsync(ipKey, LOGIN_IP_OPTS)).limited) {
    redirect("/auth/sign-in?error=rate");
  }

  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    if (ipKey) await recordFailureAsync(ipKey, LOGIN_IP_OPTS);
    redirect("/auth/sign-in?error=1");
  }

  const accountKey = buildAccountKey(parsed.data.email, clientKey);
  if ((await isRateLimitedAsync(accountKey, LOGIN_OPTS)).limited) {
    redirect("/auth/sign-in?error=rate");
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
    await recordFailureAsync(accountKey, LOGIN_OPTS);
    if (ipKey) await recordFailureAsync(ipKey, LOGIN_IP_OPTS);
    redirect("/auth/sign-in?error=1");
  }

  // Only the account budget is cleared: one successful sign-in must not wipe
  // the spraying counter an attacker built up against other accounts.
  await clearAttemptsAsync(accountKey);
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
