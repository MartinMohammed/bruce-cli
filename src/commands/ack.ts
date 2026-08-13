import * as p from "@clack/prompts";
import pc from "picocolors";
import { ackChange } from "../lib/api.js";
import { readCredentials } from "../lib/credentials.js";

/**
 * `bruce ack <changeId>` — the explicit close-the-loop step, deliberately
 * NOT automatic. Auto-acking on "the old field no longer appears in a scan"
 * would trust absence-of-evidence the same way findAffectedConsumers()
 * refuses to (an unscanned or half-fixed file looks identical to a real
 * fix). This is meant to be the thing an interactive Claude session calls
 * right after applying the fix `bruce pull` warned about — it already has
 * the changeId from that same pull's output, no extra lookup needed.
 *
 * A changeId belongs to exactly one producer relationship, but the CLI
 * doesn't ask the caller to know which one — it tries each registered
 * relationship's token until one is accepted.
 */
export async function ackCommand(changeId: string): Promise<void> {
  p.intro(pc.bold(`bruce ack ${changeId}`));
  const credentials = readCredentials();
  const consumers = Object.entries(credentials.consumers ?? {});

  if (consumers.length === 0) {
    p.log.error("No consumer relationships registered — run `bruce consumer add --url <url> --token <token>` first.");
    process.exitCode = 1;
    return;
  }

  for (const [, consumer] of consumers) {
    try {
      await ackChange(consumer.bruceApiUrl, consumer.token, consumer.consumerId, changeId);
      p.outro(pc.green(`Acknowledged — "${consumer.producerName}" now shows this as handled.`));
      return;
    } catch {
      // Doesn't belong to this relationship — try the next one.
    }
  }

  p.log.error(
    `No registered relationship recognized change "${changeId}". Copy the id straight from a recent \`bruce pull\` — it's printed next to each change.`,
  );
  process.exitCode = 1;
}
