import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Provider seam for signatures. The MVP ships the canvas provider (eIDAS
// "simple" level: drawn signature + audit evidence). Skribble / Yousign
// (advanced/qualified) implement the same interface later; their flow
// returns a redirect URL instead of accepting canvas bytes.

export type SignatureEvidence = {
  signerName: string;
  ipAddress: string;
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
  /** Persists provider-specific artifacts, returns stored artifact path. */
  finalize(params: FinalizeParams): Promise<{ imagePath: string | null }>;
}

const SIGNATURE_DIR = path.join(process.cwd(), "var", "signatures");

class CanvasSignatureProvider implements SignatureProvider {
  readonly id = "canvas";

  async finalize(params: FinalizeParams): Promise<{ imagePath: string | null }> {
    if (!params.imageBytes) return { imagePath: null };
    await mkdir(SIGNATURE_DIR, { recursive: true });
    const name = `${params.signatureId}.png`;
    await writeFile(path.join(SIGNATURE_DIR, name), params.imageBytes);
    return { imagePath: path.join("var", "signatures", name) };
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
