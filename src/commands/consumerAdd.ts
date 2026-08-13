import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as p from "@clack/prompts";
import { ConsumerIndexSchema, type ConsumerIndex } from "../shared/index.js";
import pc from "picocolors";
import { fetchDocs, whoami } from "../lib/api.js";
import { ensureBruceDirs, mergeCredentials } from "../lib/credentials.js";
import { consumersIndexPath, docsPath } from "../lib/paths.js";

export async function consumerAddCommand(options: { url: string; token: string }): Promise<void> {
  p.intro(pc.bold("bruce consumer add"));
  const spinner = p.spinner();

  spinner.start("Identifying producer from token");
  const identity = await whoami(options.url, options.token);
  if (identity.kind !== "consumer_key") {
    spinner.stop("Failed");
    p.log.error("That token is not a consumer key. Ask the API owner for a consumer relationship token.");
    process.exitCode = 1;
    return;
  }
  spinner.stop(`Registered as a consumer of "${identity.producerName}" (${identity.producerSlug})`);

  mergeCredentials({
    consumers: {
      [identity.producerSlug]: {
        token: options.token,
        bruceApiUrl: options.url,
        consumerId: identity.consumerId,
        producerId: identity.producerId,
        producerName: identity.producerName,
      },
    },
  });

  ensureBruceDirs();
  const indexFile = consumersIndexPath();
  const current: ConsumerIndex = existsSync(indexFile)
    ? ConsumerIndexSchema.parse(JSON.parse(readFileSync(indexFile, "utf-8")))
    : { relationships: [] };
  if (!current.relationships.some((r) => r.producerSlug === identity.producerSlug)) {
    current.relationships.push({
      producerSlug: identity.producerSlug,
      producerName: identity.producerName,
      bruceApiUrl: options.url,
      mappingFile: `bruce/consumers/${identity.producerSlug}-map.json`,
    });
  }
  writeFileSync(indexFile, JSON.stringify(current, null, 2));

  spinner.start("Downloading API docs");
  try {
    const markdown = await fetchDocs(options.url, options.token, identity.producerId);
    writeFileSync(docsPath(identity.producerSlug), markdown);
    spinner.stop(`Docs saved to bruce/docs/${identity.producerSlug}-api-doc.md`);
  } catch (err) {
    spinner.stop("Failed", 1);
    p.log.error(String(err));
    process.exitCode = 1;
    return;
  }

  p.outro(`Run ${pc.cyan("bruce init")} (or ${pc.cyan("bruce scan")}) to map how this repo uses "${identity.producerName}".`);
}
