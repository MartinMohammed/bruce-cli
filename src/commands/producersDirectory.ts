import * as p from "@clack/prompts";
import pc from "picocolors";
import { fetchProducerDirectory } from "../lib/api.js";

export interface ProducersListOptions {
  agentKey: string;
  bruceUrl: string;
}

/**
 * The fix for cross-session consumer-linking (previously: guess a producer's slug blind, and
 * if wrong, silently give up — see DESIGN_NOTES.md §18 on auto-discovery reconciliation).
 * A Claude session that only sees a subset of repos can run this before `consumer add` to
 * match a dependency against every producer actually registered under the account, including
 * ones registered in a completely different session.
 */
export async function producersListCommand(options: ProducersListOptions): Promise<void> {
  p.intro(pc.bold("bruce producers list"));

  try {
    const producers = await fetchProducerDirectory(options.bruceUrl, options.agentKey);
    if (producers.length === 0) {
      p.log.message("No producers registered under this account yet.");
    } else {
      for (const producer of producers) {
        p.log.message(`${pc.bold(producer.slug)}  (${producer.kind})  — ${producer.name}`);
      }
    }
    p.outro(`${producers.length} producer(s).`);
  } catch (err) {
    p.log.error(String(err));
    process.exitCode = 1;
  }
}
