import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { fetchDocs, pull } from "../lib/api.js";
import { readCredentials } from "../lib/credentials.js";
import { docsPath } from "../lib/paths.js";

export async function pullCommand(): Promise<void> {
  p.intro(pc.bold("bruce pull"));
  const credentials = readCredentials();
  const consumers = Object.entries(credentials.consumers ?? {});

  if (consumers.length === 0) {
    p.log.error("No consumer relationships registered — run `bruce consumer add --url <url> --token <token>` first.");
    process.exitCode = 1;
    return;
  }

  let totalPending = 0;

  for (const [slug, consumer] of consumers) {
    const spinner = p.spinner();
    spinner.start(`Pulling latest from "${consumer.producerName}"`);
    const result = await pull(consumer.bruceApiUrl, consumer.token, consumer.consumerId);

    // Refresh the local API reference every pull, not just at registration — this is what keeps
    // Claude reading accurate docs instead of a stale snapshot from whenever this repo first
    // registered as a consumer. Cheap: same round-trip cadence as the pull itself.
    let docsNote = "";
    try {
      const markdown = await fetchDocs(consumer.bruceApiUrl, consumer.token, consumer.producerId);
      const path = docsPath(slug);
      const existing = existsSync(path) ? readFileSync(path, "utf-8") : null;
      if (existing !== markdown) {
        writeFileSync(path, markdown);
        docsNote = " — docs updated";
      }
    } catch {
      // Docs refresh is best-effort; a failure here shouldn't block reporting pending changes.
    }

    if (result.unchanged || result.changes.length === 0) {
      spinner.stop(`"${consumer.producerName}": up to date${docsNote}`);
      continue;
    }

    spinner.stop(`"${consumer.producerName}": ${result.changes.length} change(s) pending${docsNote}`);
    totalPending += result.changes.length;

    result.changes.forEach((change, i) => {
      const severityColor = change.severity === "high" ? pc.red : change.severity === "medium" ? pc.yellow : pc.gray;
      const id = result.changeIds?.[i];
      p.log.message(
        `${severityColor(change.severity.toUpperCase())} ${change.endpoint} — ${change.change.kind}: ${change.change.field}${change.change.replacement ? ` → ${change.change.replacement}` : ""}`,
      );
      if (change.migration.notes) p.log.message(pc.dim(`  ${change.migration.notes}`));
      if (id) p.log.message(pc.dim(`  fixed this? run: bruce ack ${id}`));
    });
  }

  if (totalPending > 0) {
    p.outro(pc.yellow(`${totalPending} pending change(s) across your dependencies. Review before editing affected code, then \`bruce ack <id>\` each one you handle.`));
  } else {
    p.outro(pc.green("Everything up to date."));
  }
}
