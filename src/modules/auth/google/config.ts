import { env } from "@/lib/env";

/** Endpoints are hard-coded rather than discovered: they are stable, and one
 *  less network call at sign-in time is one less failure mode. */
export const GOOGLE_ISSUER = "https://accounts.google.com";
export const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

export const GOOGLE_CALLBACK_PATH = "/auth/google/callback";

export type GoogleConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
};

/**
 * Returns the OAuth client, or null when Google sign-in is not set up. Callers
 * must treat null as "this feature does not exist" — never as a reason to fall
 * back to a weaker check.
 */
export const getGoogleConfig = (): GoogleConfig | null => {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    // Must match the redirect URI registered in Google Cloud Console exactly.
    redirectUri: new URL(GOOGLE_CALLBACK_PATH, env.APP_BASE_URL).toString(),
  };
};

export const isGoogleSignInConfigured = (): boolean =>
  getGoogleConfig() !== null;
