// Magic-byte sniffing for participant uploads. The client-supplied MIME type
// is attacker-controlled, so the accepted type (and the stored extension) is
// derived from the file's actual leading bytes — anything unrecognized or
// mismatched is rejected.

export type SniffedUploadType = "application/pdf" | "image/png" | "image/jpeg";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

/** The real type of a file from its leading bytes, or null when unsupported. */
export function sniffUploadType(bytes: Uint8Array): SniffedUploadType | null {
  if (startsWith(bytes, PDF_MAGIC)) return "application/pdf";
  if (startsWith(bytes, PNG_MAGIC)) return "image/png";
  if (startsWith(bytes, JPEG_MAGIC)) return "image/jpeg";
  return null;
}

export function extensionFor(type: SniffedUploadType): "pdf" | "png" | "jpg" {
  return type === "application/pdf"
    ? "pdf"
    : type === "image/png"
      ? "png"
      : "jpg";
}
