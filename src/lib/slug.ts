import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Matches the dashboard's slug rule (bruce-frontend/src/lib/slugify.ts) and the backend's schema. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/**
 * Best-effort producer name for auto-discovery: package.json's own `name`
 * field if present, else the repo directory's basename. Never asks — this
 * only runs in the non-interactive `--agent-key` path, which is meant to be
 * run unattended and in parallel across many repos at once.
 */
export function inferProducerName(cwd = process.cwd()): string {
  const pkgPath = path.join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
      if (pkg.name) return pkg.name.replace(/^@[^/]+\//, "");
    } catch {
      // fall through to directory name
    }
  }
  return path.basename(cwd);
}
