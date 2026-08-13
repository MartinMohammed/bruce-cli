import path from "node:path";
import { fileURLToPath } from "node:url";

/** bruce-cli's own package root, independent of the invoking command's cwd. */
export function cliPackageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

/** Pre-recorded fallback file for BRUCE_DEMO_FALLBACK — see DESIGN_NOTES.md §7.3. */
export function fallbackPath(name: string): string {
  return path.join(cliPackageRoot(), "fallback", `${name}.json`);
}

export function bruceDir(cwd = process.cwd()): string {
  return path.join(cwd, "bruce");
}

export function stateDir(cwd = process.cwd()): string {
  return path.join(cwd, ".bruce");
}

export function credentialsPath(cwd = process.cwd()): string {
  return path.join(bruceDir(cwd), ".credentials.json");
}

export function publisherPath(cwd = process.cwd()): string {
  return path.join(bruceDir(cwd), "publisher.json");
}

export function consumersDir(cwd = process.cwd()): string {
  return path.join(bruceDir(cwd), "consumers");
}

export function consumersIndexPath(cwd = process.cwd()): string {
  return path.join(consumersDir(cwd), "index.json");
}

export function consumerMapPath(producerSlug: string, cwd = process.cwd()): string {
  return path.join(consumersDir(cwd), `${producerSlug}-map.json`);
}

export function docsDir(cwd = process.cwd()): string {
  return path.join(bruceDir(cwd), "docs");
}

export function docsPath(producerSlug: string, cwd = process.cwd()): string {
  return path.join(docsDir(cwd), `${producerSlug}-api-doc.md`);
}

export function statePath(cwd = process.cwd()): string {
  return path.join(stateDir(cwd), "state.json");
}
