import { existsSync, readFileSync } from "node:fs";
import * as p from "@clack/prompts";
import { contentHash, PublisherSnapshotSchema } from "../shared/index.js";
import pc from "picocolors";
import { publishSnapshot } from "../lib/api.js";
import { readCredentials } from "../lib/credentials.js";
import { publisherPath } from "../lib/paths.js";
import { readState, setProducerScanState } from "../lib/state.js";

export async function publishCommand(): Promise<void> {
  p.intro(pc.bold("bruce publish"));
  const credentials = readCredentials();

  if (!credentials.producer) {
    p.log.error("This project isn't registered as a publisher — run `bruce init` first.");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(publisherPath())) {
    p.log.error("bruce/publisher.json doesn't exist yet — run `bruce init` or `bruce scan` first.");
    process.exitCode = 1;
    return;
  }

  const snapshot = PublisherSnapshotSchema.parse(JSON.parse(readFileSync(publisherPath(), "utf-8")));
  const hash = contentHash(snapshot);

  const spinner = p.spinner();
  spinner.start(`Publishing to ${credentials.producer.bruceApiUrl}`);
  const result = await publishSnapshot(credentials.producer.bruceApiUrl, credentials.producer.apiKey, snapshot);

  const state = readState();
  setProducerScanState({ ...(state.producer ?? { lastScannedCommit: null, lastFullScanCommit: null, trackedFiles: [] }), mappingHash: hash });

  if (!result.published) {
    spinner.stop("No changes since last publish.");
    p.outro("Up to date.");
    return;
  }

  spinner.stop(`Published — ${result.changes.length} change(s) detected`);
  if (result.changes.length === 0) {
    p.outro(pc.green(result.isFirstSnapshot ? "First snapshot published. Nothing to diff against yet." : "Published — no changes detected against the last snapshot."));
    return;
  }

  for (const change of result.changes) {
    const { summary } = change;
    const severityColor = summary.severity === "high" ? pc.red : summary.severity === "medium" ? pc.yellow : pc.gray;
    p.log.message(
      `${severityColor(summary.severity.toUpperCase())} ${summary.endpoint} — ${summary.change.kind}: ${summary.change.field}${summary.change.replacement ? ` → ${summary.change.replacement}` : ""}`,
    );
    if (summary.affectedConsumers.length > 0) {
      p.log.message(pc.dim(`  affects: ${summary.affectedConsumers.join(", ")}`));
    }
  }
  p.outro(pc.yellow(`${result.changes.length} breaking change(s) published — affected consumers will see this on their next \`bruce pull\`.`));
}
