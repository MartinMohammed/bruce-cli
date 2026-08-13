#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { ackCommand } from "./commands/ack.js";
import { consumerAddCommand } from "./commands/consumerAdd.js";
import { initCommand } from "./commands/init.js";
import { publishCommand } from "./commands/publish.js";
import { pullCommand } from "./commands/pull.js";
import { scanCommand } from "./commands/scan.js";
import { statusCommand } from "./commands/status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf-8")) as { version: string };

const program = new Command();

program.name("bruce").description("Change intelligence for AI coding agents.").version(version);

program
  .command("init")
  .description("Full scan — register this project's role and generate its mapping/contract file(s).")
  .option("--role <role>", "publisher or consumer (skips the interactive prompt)")
  .option("--api-key <key>", "producer API key (non-interactive publisher registration)")
  .option("--bruce-url <url>", "Bruce API URL (non-interactive registration)")
  .option("--token <token>", "consumer token (non-interactive consumer registration)")
  .action(initCommand);

program
  .command("scan")
  .description("Incremental scan — patch existing mapping/contract file(s) based on what changed since the last scan.")
  .action(scanCommand);

program
  .command("update")
  .description("Alias for `bruce scan`, scoped to this project's consumer-role mapping files.")
  .action(scanCommand);

program
  .command("publish")
  .description("Push bruce/publisher.json to Bruce and report any breaking changes detected.")
  .action(publishCommand);

program
  .command("pull")
  .description("Fetch pending changes for every registered upstream dependency.")
  .action(pullCommand);

program
  .command("ack <changeId>")
  .description("Acknowledge a specific change as handled — copy the id from `bruce pull`'s output.")
  .action(ackCommand);

program
  .command("consumer")
  .command("add")
  .requiredOption("--url <url>", "Bruce API URL provided by the API owner")
  .requiredOption("--token <token>", "consumer token provided by the API owner")
  .description("Register this project as a consumer of an upstream API.")
  .action(consumerAddCommand);

program
  .command("status")
  .description("Show what's registered, when it was last scanned, and whether a scan is due.")
  .action(statusCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
