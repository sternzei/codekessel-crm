import { existsSync } from "node:fs";
import path from "node:path";

const ALLOWED_EXTENSIONS = new Set([".html", ".webp"]);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".webp": "image/webp",
};

export const HANDBOOK_ROOT = path.join(process.cwd(), "content", "academy");

export type HandbookAsset = {
  readonly absolutePath: string;
  readonly contentType: string;
  readonly isHtml: boolean;
};

type ResolveHandbookAssetInput = {
  readonly root: string;
  readonly segments?: readonly string[];
};

const isSafeSegment = (segment: string): boolean =>
  segment.length > 0 &&
  segment !== "." &&
  segment !== ".." &&
  !segment.includes("/") &&
  !segment.includes("\\") &&
  !segment.includes("\0");

/**
 * Maps a /hilfe/academy URL onto a file under the packaged academy, or null
 * when the path is missing, uses a disallowed type, or tries to leave the root.
 */
export const resolveHandbookAsset = ({
  root,
  segments = [],
}: ResolveHandbookAssetInput): HandbookAsset | null => {
  const resolvedRoot = path.resolve(root);
  const relativeSegments = segments.length === 0 ? ["index.html"] : [...segments];
  if (!relativeSegments.every(isSafeSegment)) return null;
  const absolutePath = path.resolve(resolvedRoot, ...relativeSegments);
  const relative = path.relative(resolvedRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const extension = path.extname(absolutePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!ALLOWED_EXTENSIONS.has(extension) || !contentType) return null;
  if (!existsSync(absolutePath)) return null;
  return {
    absolutePath,
    contentType,
    isHtml: extension === ".html",
  };
};
