import { createHash } from "node:crypto";

/**
 * Canonical content hash used as the sync/version token for the ETag-style
 * push/pull flow (DESIGN_NOTES.md §7.1) — key ordering must not affect the
 * hash, so we stringify with sorted keys rather than hashing raw JSON.
 */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
