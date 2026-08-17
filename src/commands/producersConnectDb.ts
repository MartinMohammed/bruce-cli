import * as p from "@clack/prompts";
import pc from "picocolors";
import { ApiError, createDbProducer, linkDbConnection, reclaimProducer } from "../lib/api.js";
import { readDbProducerManifest, readProducerManifest, writeDbProducerManifest } from "../lib/producerManifest.js";
import { inferProducerName, slugify } from "../lib/slug.js";

export interface ProducersConnectDbOptions {
  agentKey: string;
  bruceUrl: string;
  name?: string;
  slug?: string;
}

/**
 * CLI-driven counterpart to the dashboard's "Connect a database" flow — for an auto-discovery
 * session that finds a DATABASE_URL/Supabase connection while scanning a repo, instead of
 * requiring a trip to the dashboard. This command only ever registers the producer and prints
 * setup SQL; it never touches the target database itself — running that SQL is a deliberate
 * separate step, same caution as every other agent_key mutation in this CLI (DESIGN_NOTES.md §17.3).
 *
 * Idempotent the same way `bruce init --agent-key` is (§18): bruce/db-producer.json (committed,
 * non-secret) lets a fresh checkout of this repo recognize its own database producer and
 * reclaim it instead of registering a duplicate.
 */
export async function producersConnectDbCommand(options: ProducersConnectDbOptions): Promise<void> {
  p.intro(pc.bold("bruce producers connect-db"));

  const baseName = options.name ?? `${inferProducerName()} DB`;
  const baseSlug = options.slug ?? slugify(baseName);
  const spinner = p.spinner();

  const manifest = readDbProducerManifest();
  let result: { producerId: string; producerSlug: string; producerName: string; webhookUrl: string; setupSql: string } | undefined;

  function expectDbKind(r: Awaited<ReturnType<typeof reclaimProducer>>): typeof result {
    if (r.kind !== "postgres") {
      throw new Error(`bruce/db-producer.json points at an "${r.kind}" producer — this command is for database producers only.`);
    }
    return r;
  }

  if (manifest) {
    spinner.start(`Reclaiming existing database producer "${manifest.slug}" for this checkout`);
    try {
      result = expectDbKind(await reclaimProducer(options.bruceUrl, options.agentKey, manifest.producerId));
    } catch (err) {
      spinner.stop("Failed", 1);
      p.log.error(String(err));
      process.exitCode = 1;
      return;
    }
  } else {
    spinner.start(`Registering "${baseName}" as a new database producer`);
    try {
      result = await createDbProducer(options.bruceUrl, options.agentKey, baseName, baseSlug);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof (err.body as { existingProducerId?: string })?.existingProducerId === "string") {
        const existingProducerId = (err.body as { existingProducerId: string }).existingProducerId;
        spinner.message(`"${baseSlug}" is already registered — reclaiming it instead of creating a duplicate`);
        try {
          result = expectDbKind(await reclaimProducer(options.bruceUrl, options.agentKey, existingProducerId));
        } catch (reclaimErr) {
          spinner.stop("Failed", 1);
          p.log.error(String(reclaimErr));
          process.exitCode = 1;
          return;
        }
      } else {
        spinner.stop("Failed", 1);
        p.log.error(String(err));
        process.exitCode = 1;
        return;
      }
    }
  }

  spinner.stop(`Registered as "${result!.producerSlug}"`);
  writeDbProducerManifest({ producerId: result!.producerId, slug: result!.producerSlug });

  // Symmetric to the check in `bruce init` (DESIGN_NOTES.md §19) — whichever of the two
  // commands runs second is the one that actually creates the link; the other's attempt
  // 409s harmlessly. A sibling bruce/producer.json means this same repo is also registered
  // as an API producer, i.e. it's the thing that connects to this database.
  const apiManifest = readProducerManifest();
  if (apiManifest) {
    const linked = await linkDbConnection(options.bruceUrl, options.agentKey, result!.producerSlug, apiManifest.slug, apiManifest.producerId);
    if (linked) p.log.info(`Detected this repo also owns an API producer ("${apiManifest.slug}") — linked as a database connection.`);
  }

  p.log.message(pc.bold("Run this once against the target database (Supabase SQL editor, or psql) — it installs a DDL event"));
  p.log.message(pc.bold("trigger that pushes a fresh schema snapshot to Bruce the instant a migration runs:"));
  p.log.message("");
  p.log.message(result!.setupSql);

  p.outro(`Database producer "${result!.producerSlug}" ready — waiting on that SQL to actually detect anything.`);
}
