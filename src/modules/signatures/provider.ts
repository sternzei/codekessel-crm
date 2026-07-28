import { getStorage } from "@/modules/storage";

// Provider seam for signatures. The MVP ships the canvas provider (eIDAS
// "simple" level: drawn signature + audit evidence). Skribble / Yousign
// (advanced/qualified) implement the same interface later; their flow
// returns a redirect URL instead of accepting canvas bytes.

export type SignatureEvidence = {
  signerName: string;
  // Nullable: only recorded when honestly knowable (TRUST_PROXY deployment,
  // see lib/client-ip) — never a spoofable x-forwarded-for value.
  ipAddress: string | null;
  documentSha256: string;
  signedAt: Date;
};

export type FinalizeParams = {
  signatureId: string;
  evidence: SignatureEvidence;
  /** PNG bytes of the drawn signature (canvas provider only). */
  imageBytes?: Buffer;
};

export interface SignatureProvider {
  readonly id: string;
  /** Persists provider-specific artifacts, returns the stored artifact key. */
  finalize(params: FinalizeParams): Promise<{ imagePath: string | null }>;
}

class CanvasSignatureProvider implements SignatureProvider {
  readonly id = "canvas";

  async finalize(params: FinalizeParams): Promise<{ imagePath: string | null }> {
    if (!params.imageBytes) return { imagePath: null };
    const imagePath = await getStorage().put({
      key: `signatures/${params.signatureId}.png`,
      bytes: params.imageBytes,
      contentType: "image/png",
    });
    return { imagePath };
  }
}

const providers: Record<string, SignatureProvider> = {
  canvas: new CanvasSignatureProvider(),
};

export function getSignatureProvider(id: string): SignatureProvider {
  const provider = providers[id];
  if (!provider) throw new Error(`Unknown signature provider: ${id}`);
  return provider;
}
