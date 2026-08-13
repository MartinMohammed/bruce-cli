import { existsSync, readFileSync } from "node:fs";
import * as p from "@clack/prompts";
import { ConsumerMappingSchema, PublisherSnapshotSchema, contentHash, type ConsumerMapping } from "../shared/index.js";
import pc from "picocolors";
import { generateFile, warnIfLooksLikeFullRegen } from "../claude/generate.js";
import { incrementalScanPrompt } from "../claude/prompts.js";
import { pushMapping } from "../lib/api.js";
import { readCredentials } from "../lib/credentials.js";
import { currentCommit, diffFilesSince } from "../lib/git.js";
import { consumerMapPath, fallbackPath } from "../lib/paths.js";
import { readState, setConsumerScanState, setProducerScanState } from "../lib/state.js";

const SAFETY_NET_MAX_FILES = 40;
const SCAN_MODEL = "claude-haiku-4-5";

export async function scanCommand(): Promise<void> {
  p.intro(pc.bold("bruce scan"));
  const credentials = readCredentials();
  const state = readState();
  const sha = currentCommit();

  if (!credentials.producer && !credentials.consumers) {
    p.log.error("Nothing registered yet — run `bruce init` first.");
    process.exitCode = 1;
    return;
  }

  if (credentials.producer) {
    await scanOne({
      label: `"${credentials.producer.name}" publisher surface`,
      targetPath: "bruce/publisher.json",
      lastScannedCommit: state.producer?.lastScannedCommit ?? state.producer?.lastFullScanCommit ?? null,
      sha,
      schema: PublisherSnapshotSchema,
      fallbackKey: credentials.producer ? `${credentials.producer.slug}-publisher-scan` : undefined,
      model: SCAN_MODEL,
      onDone: async () =>
        setProducerScanState({
          lastScannedCommit: sha,
          lastFullScanCommit: state.producer?.lastFullScanCommit ?? sha,
          trackedFiles: state.producer?.trackedFiles ?? [],
          mappingHash: null,
        }),
    });
  }

  await Promise.all(
    Object.entries(credentials.consumers ?? {}).map(([slug, consumer]) => {
      const consumerState = state.consumers?.[slug];
      return scanOne({
        label: `usage of "${consumer.producerName}"`,
        targetPath: `bruce/consumers/${slug}-map.json`,
        lastScannedCommit: consumerState?.lastScannedCommit ?? consumerState?.lastFullScanCommit ?? null,
        sha,
        schema: ConsumerMappingSchema,
        fallbackKey: `${slug}-consumer-scan`,
        model: SCAN_MODEL,
        onDone: async () => {
          const raw = existsSync(consumerMapPath(slug)) ? (JSON.parse(readFileSync(consumerMapPath(slug), "utf-8")) as ConsumerMapping) : null;
          const trackedFiles = raw
            ? Array.from(new Set(raw.endpoints.flatMap((e) => Object.values(e.fields).flatMap((f) => f.usedIn))))
            : (consumerState?.trackedFiles ?? []);
          setConsumerScanState(slug, {
            lastScannedCommit: sha,
            lastFullScanCommit: consumerState?.lastFullScanCommit ?? sha,
            trackedFiles,
            mappingHash: raw ? contentHash(raw) : null,
          });
          if (raw) await pushMapping(consumer.bruceApiUrl, consumer.token, consumer.consumerId, raw);
        },
      });
    }),
  );

  p.outro(pc.green("bruce scan complete."));
}

async function scanOne(args: {
  label: string;
  targetPath: string;
  lastScannedCommit: string | null;
  sha: string | null;
  schema: typeof PublisherSnapshotSchema | typeof ConsumerMappingSchema;
  fallbackKey?: string;
  model?: string;
  onDone: () => Promise<void>;
}): Promise<void> {
  const spinner = p.spinner();

  if (!args.lastScannedCommit) {
    p.log.warn(`${args.label}: never fully scanned — run \`bruce init\` first. Skipping.`);
    return;
  }
  const lastScannedCommit = args.lastScannedCommit;
  if (!args.sha) {
    p.log.warn(`${args.label}: not in a git repo. Skipping.`);
    return;
  }
  if (lastScannedCommit === args.sha) {
    p.log.info(`${args.label}: no commits since last scan.`);
    return;
  }

  const changedFiles = diffFilesSince(lastScannedCommit);
  if (changedFiles.length === 0) {
    p.log.info(`${args.label}: no file changes detected.`);
    return;
  }
  if (changedFiles.length > SAFETY_NET_MAX_FILES) {
    p.log.warn(`${args.label}: ${changedFiles.length} files changed — too large for an incremental patch. Run \`bruce init\` for a full rescan instead.`);
    return;
  }

  spinner.start(`${args.label}: ${changedFiles.length} file(s) changed since last scan — asking Claude`);
  try {
    const existingContent = existsSync(`${process.cwd()}/${args.targetPath}`) ? readFileSync(`${process.cwd()}/${args.targetPath}`, "utf-8") : "{}";
    const previousParsed = JSON.parse(existingContent);

    const result = await generateFile({
      cwd: process.cwd(),
      targetPath: args.targetPath,
      prompt: incrementalScanPrompt(args.targetPath, existingContent, changedFiles),
      schema: args.schema as typeof PublisherSnapshotSchema,
      fallbackPath: args.fallbackKey ? fallbackPath(args.fallbackKey) : undefined,
      model: args.model,
    });

    const warning = warnIfLooksLikeFullRegen(previousParsed, result);
    if (warning) p.log.warn(warning);

    await args.onDone();
    spinner.stop(`${args.label}: patched`);
  } catch (err) {
    spinner.stop("Failed", 1);
    p.log.error(String(err));
    process.exitCode = 1;
  }
}
