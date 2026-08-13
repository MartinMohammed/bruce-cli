import * as p from "@clack/prompts";
import pc from "picocolors";
import { readCredentials } from "../lib/credentials.js";
import { currentCommit, isGitRepo } from "../lib/git.js";
import { readState } from "../lib/state.js";

export function statusCommand(): void {
  p.intro(pc.bold("bruce status"));
  const credentials = readCredentials();
  const state = readState();

  if (!credentials.producer && !credentials.consumers) {
    p.log.warn("This project isn't registered with Bruce yet. Run `bruce init`.");
    p.outro("Not registered.");
    return;
  }

  if (credentials.producer) {
    const s = state.producer;
    p.log.message(pc.bold(`Publisher: ${credentials.producer.name} (${credentials.producer.slug})`));
    p.log.message(`  last full scan:   ${s?.lastFullScanCommit ?? "never"}`);
    p.log.message(`  last incremental: ${s?.lastScannedCommit ?? "never"}`);
    p.log.message(`  last published hash: ${s?.mappingHash ?? "not published yet"}`);
  }

  for (const [slug, consumer] of Object.entries(credentials.consumers ?? {})) {
    const s = state.consumers?.[slug];
    p.log.message(pc.bold(`Consumer of: ${consumer.producerName} (${slug})`));
    p.log.message(`  last full scan:   ${s?.lastFullScanCommit ?? "never"}`);
    p.log.message(`  last incremental: ${s?.lastScannedCommit ?? "never"}`);
    p.log.message(`  tracked files:    ${s?.trackedFiles.length ?? 0}`);
  }

  if (isGitRepo()) {
    const sha = currentCommit();
    const stale =
      (state.producer && state.producer.lastScannedCommit !== sha) ||
      Object.values(state.consumers ?? {}).some((s) => s.lastScannedCommit !== sha);
    if (stale) p.log.warn("Repo has changed since the last scan — run `bruce scan`.");
  }

  p.outro("Run `bruce pull` to check for pending upstream changes.");
}
