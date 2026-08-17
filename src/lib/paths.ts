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

/**
 * bruce/producer.json — committed (no leading dot, unlike credentials.json), holds only the
 * non-secret {producerId, slug} pair. Lets `bruce init --agent-key` recognize "this repo is
 * already registered" from a fresh checkout on a different machine/workspace, where the
 * gitignored .credentials.json never survived — see reclaimProducer() in lib/api.ts.
 */
export function producerManifestPath(cwd = process.cwd()): string {
  return path.join(bruceDir(cwd), "producer.json");
}

/**
 * bruce/db-producer.json — same idea as producer.json, kept as a separate file rather than
 * folded in, since a single repo can plausibly be both: an API producer in its own right
 * (bruce init --agent-key) AND the place a database producer for it gets registered from
 * (bruce producers connect-db). One file per kind avoids the two clobbering each other.
 */
export function dbProducerManifestPath(cwd = process.cwd()): string {
  return path.join(bruceDir(cwd), "db-producer.json");
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
