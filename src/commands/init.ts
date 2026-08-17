import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as p from "@clack/prompts";
import { ConsumerIndexSchema, ConsumerMappingSchema, PublisherSnapshotSchema, contentHash, type ConsumerIndex, type ConsumerMapping } from "../shared/index.js";
import pc from "picocolors";
import { generateFile } from "../claude/generate.js";
import { consumerInitPrompt, publisherInitPrompt } from "../claude/prompts.js";
import { ApiError, createProducer, fetchDocs, linkDbConnection, pushMapping, reclaimProducer, whoami } from "../lib/api.js";
import { ensureBruceDirs, mergeCredentials, readCredentials } from "../lib/credentials.js";
import { currentCommit, isGitRepo } from "../lib/git.js";
import { consumersIndexPath, docsPath, fallbackPath } from "../lib/paths.js";
import { readDbProducerManifest, readProducerManifest, writeProducerManifest } from "../lib/producerManifest.js";
import { inferProducerName, slugify } from "../lib/slug.js";
import { setConsumerScanState, setProducerScanState } from "../lib/state.js";

export interface InitCommandOptions {
  /** Non-interactive flags — mainly for scripting/CI; interactive prompts are used when omitted. */
  role?: "publisher" | "consumer";
  apiKey?: string;
  bruceUrl?: string;
  token?: string;
  /**
   * Auto-discovery onboarding (DESIGN_NOTES.md §17): an owner's agent_key,
   * used to self-register a brand-new producer instead of requiring an
   * already-created --api-key. Implies role=publisher. --name/--slug are
   * optional overrides; both are inferred from package.json/the repo
   * directory name when omitted, since this path is meant to run unattended
   * and in parallel across many repos at once.
   */
  agentKey?: string;
  name?: string;
  slug?: string;
}

export async function initCommand(options: InitCommandOptions = {}): Promise<void> {
  p.intro(pc.bold("bruce init"));

  if (!isGitRepo()) {
    p.log.error("This isn't a git repository — Bruce needs git history to track incremental changes later.");
    process.exitCode = 1;
    return;
  }

  ensureBruceDirs();
  let credentials = readCredentials();

  if (!credentials.producer && !credentials.consumers && options.agentKey) {
    const bruceApiUrl = options.bruceUrl ?? (await p.text({ message: "Bruce API URL:", initialValue: "http://localhost:4100" }));
    if (p.isCancel(bruceApiUrl)) return p.cancel("Cancelled.");

    const baseName = options.name ?? inferProducerName();
    const baseSlug = options.slug ?? slugify(baseName);
    const spinner = p.spinner();

    // bruce/producer.json is committed (unlike the gitignored .credentials.json), so a repo
    // checked out fresh somewhere new — a different machine, a second workspace, CI — still
    // carries its producer identity even with no local credentials. Reclaiming here instead
    // of registering from scratch is what stops this path from producing a second, duplicate
    // producer for the same repo.
    const manifest = readProducerManifest();
    let created: { producerId: string; producerSlug: string; producerName: string; apiKey: string } | undefined;

    // bruce init only ever deals in API producers — a bruce/producer.json (or a 409's
    // existingProducerId) pointing at a postgres producer would mean this repo's identity
    // got mixed up with its database's; fail loudly rather than silently mishandling it.
    function expectApiKind(result: Awaited<ReturnType<typeof reclaimProducer>>): typeof created {
      if (result.kind !== "api") {
        throw new Error(`bruce/producer.json points at a "${result.kind}" producer — bruce init is for API producers only. Did you mean \`bruce producers connect-db\`?`);
      }
      return result;
    }

    if (manifest) {
      spinner.start(`Reclaiming existing producer "${manifest.slug}" for this checkout`);
      try {
        created = expectApiKind(await reclaimProducer(bruceApiUrl, options.agentKey, manifest.producerId));
      } catch (err) {
        spinner.stop("Failed", 1);
        p.log.error(String(err));
        process.exitCode = 1;
        return;
      }
    } else {
      spinner.start(`Registering "${baseName}" as a new producer`);
      try {
        created = await createProducer(bruceApiUrl, options.agentKey, baseName, baseSlug);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && typeof (err.body as { existingProducerId?: string })?.existingProducerId === "string") {
          // No local manifest, but the backend already has a producer at this slug under this
          // owner — almost always this exact repo, registered previously from a workspace
          // whose local state never made it here. Reclaim it rather than inventing a
          // random-suffixed sibling.
          const existingProducerId = (err.body as { existingProducerId: string }).existingProducerId;
          spinner.message(`"${baseSlug}" is already registered — reclaiming it instead of creating a duplicate`);
          try {
            created = expectApiKind(await reclaimProducer(bruceApiUrl, options.agentKey, existingProducerId));
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

    spinner.stop(`Registered as "${created!.producerSlug}"`);
    writeProducerManifest({ producerId: created!.producerId, slug: created!.producerSlug });
    credentials = mergeCredentials({
      producer: {
        apiKey: created!.apiKey,
        bruceApiUrl,
        producerId: created!.producerId,
        slug: created!.producerSlug,
        name: created!.producerName,
      },
    });
  }

  if (!credentials.producer && !credentials.consumers) {
    const role =
      options.role ??
      (await p.select({
        message: "Register this project with Bruce as:",
        options: [
          { value: "publisher", label: "Publisher — this project owns an API" },
          { value: "consumer", label: "Consumer — this project calls someone else's API" },
        ],
      }));
    if (p.isCancel(role)) return p.cancel("Cancelled.");

    if (role === "publisher") {
      const apiKey = options.apiKey ?? (await p.text({ message: "Paste your producer API key from the Bruce dashboard:" }));
      if (p.isCancel(apiKey)) return p.cancel("Cancelled.");
      const bruceApiUrl = options.bruceUrl ?? (await p.text({ message: "Bruce API URL:", initialValue: "http://localhost:4100" }));
      if (p.isCancel(bruceApiUrl)) return p.cancel("Cancelled.");

      const identity = await whoami(bruceApiUrl, apiKey);
      if (identity.kind !== "producer_key") {
        p.log.error("That key is not a producer key.");
        process.exitCode = 1;
        return;
      }
      credentials = mergeCredentials({
        producer: { apiKey, bruceApiUrl, producerId: identity.producerId, slug: identity.producerSlug, name: identity.producerName },
      });
    } else {
      const bruceApiUrl = options.bruceUrl ?? (await p.text({ message: "Bruce API URL:" }));
      if (p.isCancel(bruceApiUrl)) return p.cancel("Cancelled.");
      const token = options.token ?? (await p.text({ message: "Paste your consumer token from the Bruce dashboard:" }));
      if (p.isCancel(token)) return p.cancel("Cancelled.");

      const identity = await whoami(bruceApiUrl, token);
      if (identity.kind !== "consumer_key") {
        p.log.error("That token is not a consumer key.");
        process.exitCode = 1;
        return;
      }
      credentials = mergeCredentials({
        consumers: {
          [identity.producerSlug]: {
            token,
            bruceApiUrl,
            consumerId: identity.consumerId,
            producerId: identity.producerId,
            producerName: identity.producerName,
          },
        },
      });
      registerConsumerIndex(identity.producerSlug, identity.producerName, bruceApiUrl);
      const markdown = await fetchDocs(bruceApiUrl, token, identity.producerId);
      writeFileSync(docsPath(identity.producerSlug), markdown);
    }
  }

  // Same-repo "this API connects to its own database" detection (DESIGN_NOTES.md §19): a
  // sibling bruce/db-producer.json means this exact repo also ran `bruce producers connect-db`
  // at some point — a far more reliable signal than parsing DATABASE_URL usage out of source.
  // Best-effort only: needs an agent_key to call the by-slug endpoint, and a 409 (the other
  // half of a parallel registration batch already made this link) is expected, not an error.
  if (credentials.producer && options.agentKey) {
    const dbManifest = readDbProducerManifest();
    if (dbManifest) {
      const linked = await linkDbConnection(
        credentials.producer.bruceApiUrl,
        options.agentKey,
        dbManifest.slug,
        credentials.producer.slug,
        credentials.producer.producerId,
      );
      if (linked) p.log.info(`Detected this repo also owns a database producer ("${dbManifest.slug}") — linked as a database connection.`);
    }
  }

  const sha = currentCommit();

  if (credentials.producer) {
    const spinner = p.spinner();
    spinner.start(`Scanning repo for "${credentials.producer.name}"'s API surface (Claude)`);
    try {
      const snapshot = await generateFile({
        cwd: process.cwd(),
        targetPath: "bruce/publisher.json",
        prompt: publisherInitPrompt(credentials.producer.slug, credentials.producer.name, "bruce/publisher.json"),
        schema: PublisherSnapshotSchema,
        fallbackPath: fallbackPath(`${credentials.producer.slug}-publisher-init`),
      });
      setProducerScanState({ lastScannedCommit: sha, lastFullScanCommit: sha, trackedFiles: [], mappingHash: null });
      spinner.stop(`bruce/publisher.json written — ${snapshot.endpoints.length} endpoint(s) found`);
    } catch (err) {
      spinner.stop("Failed", 1);
      p.log.error(String(err));
      process.exitCode = 1;
    }
  }

  for (const [slug, consumer] of Object.entries(credentials.consumers ?? {})) {
    // Best-effort re-fetch if this relationship was linked before the producer had published
    // anything yet (docsPath() never got written — see DESIGN_NOTES.md §20). consumerInitPrompt
    // tells Claude to read this file first; leaving it silently missing forever would mean every
    // scan runs worse than intended, not just the first one where it was genuinely unavailable.
    if (!existsSync(docsPath(slug))) {
      try {
        const markdown = await fetchDocs(consumer.bruceApiUrl, consumer.token, consumer.producerId);
        writeFileSync(docsPath(slug), markdown);
      } catch {
        // Still not published — proceed without it, same as before this existed.
      }
    }

    const spinner = p.spinner();
    spinner.start(`Scanning repo for usage of "${consumer.producerName}" (Claude)`);
    try {
      const mapping = await generateFile<ConsumerMapping>({
        cwd: process.cwd(),
        targetPath: `bruce/consumers/${slug}-map.json`,
        prompt: consumerInitPrompt(slug, consumer.producerName, `bruce/consumers/${slug}-map.json`, `bruce/docs/${slug}-api-doc.md`),
        schema: ConsumerMappingSchema,
        fallbackPath: fallbackPath(`${slug}-consumer-init`),
      });
      const trackedFiles = Array.from(new Set(mapping.endpoints.flatMap((e) => Object.values(e.fields).flatMap((f) => f.usedIn))));
      const hash = contentHash(mapping);
      setConsumerScanState(slug, { lastScannedCommit: sha, lastFullScanCommit: sha, trackedFiles, mappingHash: hash });
      await pushMapping(consumer.bruceApiUrl, consumer.token, consumer.consumerId, mapping);
      spinner.stop(`bruce/consumers/${slug}-map.json written and pushed — ${mapping.endpoints.length} endpoint(s) mapped`);
    } catch (err) {
      spinner.stop("Failed", 1);
      p.log.error(String(err));
      process.exitCode = 1;
    }
  }

  p.outro(pc.green("bruce init complete."));
}

function registerConsumerIndex(producerSlug: string, producerName: string, bruceApiUrl: string): void {
  const indexFile = consumersIndexPath();
  const current: ConsumerIndex = existsSync(indexFile)
    ? ConsumerIndexSchema.parse(JSON.parse(readFileSync(indexFile, "utf-8")))
    : { relationships: [] };
  if (!current.relationships.some((r) => r.producerSlug === producerSlug)) {
    current.relationships.push({
      producerSlug,
      producerName,
      bruceApiUrl,
      mappingFile: `bruce/consumers/${producerSlug}-map.json`,
    });
  }
  writeFileSync(indexFile, JSON.stringify(current, null, 2));
}
