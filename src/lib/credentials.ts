import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bruceDir, credentialsPath } from "./paths.js";

export interface ProducerCredentials {
  apiKey: string;
  bruceApiUrl: string;
  producerId: string;
  slug: string;
  name: string;
}

export interface ConsumerCredentials {
  token: string;
  bruceApiUrl: string;
  consumerId: string;
  producerId: string;
  producerName: string;
}

export interface Credentials {
  producer?: ProducerCredentials;
  /** keyed by producer slug */
  consumers?: Record<string, ConsumerCredentials>;
}

/**
 * bruce/.credentials.json — never touched by Claude (kept out of the files
 * it reads/regenerates during scans), gitignored. See DESIGN_NOTES.md §5.
 */
export function readCredentials(cwd = process.cwd()): Credentials {
  const file = credentialsPath(cwd);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf-8")) as Credentials;
}

export function writeCredentials(credentials: Credentials, cwd = process.cwd()): void {
  mkdirSync(bruceDir(cwd), { recursive: true });
  writeFileSync(credentialsPath(cwd), JSON.stringify(credentials, null, 2));
}

export function mergeCredentials(patch: Credentials, cwd = process.cwd()): Credentials {
  const current = readCredentials(cwd);
  const merged: Credentials = {
    producer: patch.producer ?? current.producer,
    consumers: { ...current.consumers, ...patch.consumers },
  };
  writeCredentials(merged, cwd);
  return merged;
}

export function ensureBruceDirs(cwd = process.cwd()): void {
  mkdirSync(path.join(bruceDir(cwd), "consumers"), { recursive: true });
  mkdirSync(path.join(bruceDir(cwd), "docs"), { recursive: true });
}
