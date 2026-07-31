import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

// When the browser uploads straight to object storage, the app never sees the
// bytes at upload time — it only hears afterwards that "the file is at this
// key". Believing that claim unconditionally would be the whole vulnerability:
// a participant could name the key of somebody else's document and have it
// filed under their own name.
//
// So the key is not a claim, it is a grant. The server chooses it, signs it
// together with the type and size it presigned for, and refuses on submit
// anything it did not sign. The grant is bound to the magic-link token that
// asked for it, so a ticket from one participant's link is worthless on
// another's, and it expires in minutes because it only has to survive one
// upload.

const TICKET_AUDIENCE = "qcg:upload-ticket";
const TICKET_TTL_SECONDS = 15 * 60;

// The participant-facing secret, not the session one: this is the same trust
// domain as the magic link it hangs off.
const secret = new TextEncoder().encode(env.TOKEN_SECRET);

export type UploadTicketClaims = {
  readonly key: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly fileName: string;
};

/** One presigned upload, as handed to the browser. */
export type UploadTicketGrant = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Opaque to the browser; handed back untouched when the upload is done. */
  readonly ticket: string;
};

export type UploadTicketResult =
  | { readonly ok: true; readonly grants: readonly UploadTicketGrant[] }
  | {
      readonly ok: false;
      readonly reason: "throttled" | "invalid" | "unsupported" | "rejected";
    };

/** Identifies the magic-link token without ever storing the token itself. */
export const tokenFingerprint = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const sealUploadTicket = async (
  claims: UploadTicketClaims,
  binding: { readonly token: string },
): Promise<string> =>
  new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(TICKET_AUDIENCE)
    .setSubject(tokenFingerprint(binding.token))
    .setIssuedAt()
    .setExpirationTime(`${TICKET_TTL_SECONDS}s`)
    .sign(secret);

/**
 * Returns the grant this ticket carries, or null for anything forged,
 * expired, or issued for a different magic link.
 */
export const openUploadTicket = async (
  sealed: string,
  binding: { readonly token: string },
): Promise<UploadTicketClaims | null> => {
  try {
    const { payload } = await jwtVerify(sealed, secret, {
      audience: TICKET_AUDIENCE,
      subject: tokenFingerprint(binding.token),
    });
    if (
      typeof payload.key !== "string" ||
      typeof payload.contentType !== "string" ||
      typeof payload.fileName !== "string" ||
      typeof payload.byteSize !== "number"
    ) {
      return null;
    }
    return {
      key: payload.key,
      contentType: payload.contentType,
      byteSize: payload.byteSize,
      fileName: payload.fileName,
    };
  } catch {
    return null;
  }
};
