import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as p from "@clack/prompts";
import { ConsumerIndexSchema, ConsumerMappingSchema, PublisherSnapshotSchema, contentHash, type ConsumerIndex, type ConsumerMapping } from "../shared/index.js";
import pc from "picocolors";
import { generateFile } from "../claude/generate.js";
import { consumerInitPrompt, publisherInitPrompt } from "../claude/prompts.js";
import { fetchDocs, pushMapping, whoami } from "../lib/api.js";
import { ensureBruceDirs, mergeCredentials, readCredentials } from "../lib/credentials.js";
import { currentCommit, isGitRepo } from "../lib/git.js";
import { consumersIndexPath, docsPath, fallbackPath } from "../lib/paths.js";
import { setConsumerScanState, setProducerScanState } from "../lib/state.js";

export interface InitCommandOptions {
  /** Non-interactive flags — mainly for scripting/CI; interactive prompts are used when omitted. */
  role?: "publisher" | "consumer";
  apiKey?: string;
  bruceUrl?: string;
  token?: string;
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
