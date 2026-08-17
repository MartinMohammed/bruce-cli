import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { bruceDir, dbProducerManifestPath, producerManifestPath } from "./paths.js";

export interface ProducerManifest {
  producerId: string;
  slug: string;
}

/** Committed, non-secret — see producerManifestPath()'s docstring for why this exists. */
export function readProducerManifest(cwd = process.cwd()): ProducerManifest | undefined {
  const file = producerManifestPath(cwd);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf-8")) as ProducerManifest;
}

export function writeProducerManifest(manifest: ProducerManifest, cwd = process.cwd()): void {
  mkdirSync(bruceDir(cwd), { recursive: true });
  writeFileSync(producerManifestPath(cwd), JSON.stringify(manifest, null, 2));
}

/** Same shape and purpose as ProducerManifest, kept in a separate file — see dbProducerManifestPath(). */
export function readDbProducerManifest(cwd = process.cwd()): ProducerManifest | undefined {
  const file = dbProducerManifestPath(cwd);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf-8")) as ProducerManifest;
}

export function writeDbProducerManifest(manifest: ProducerManifest, cwd = process.cwd()): void {
  mkdirSync(bruceDir(cwd), { recursive: true });
  writeFileSync(dbProducerManifestPath(cwd), JSON.stringify(manifest, null, 2));
}
