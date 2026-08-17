#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { ackCommand } from "./commands/ack.js";
import { consumerAddCommand } from "./commands/consumerAdd.js";
import { initCommand } from "./commands/init.js";
import { publishCommand } from "./commands/publish.js";
import { producersConnectDbCommand } from "./commands/producersConnectDb.js";
import { producersListCommand } from "./commands/producersDirectory.js";
import { pullCommand } from "./commands/pull.js";
import { scanCommand } from "./commands/scan.js";
import { statusCommand } from "./commands/status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf-8")) as { version: string };

const program = new Command();

program.name("bruce").description("Change intelligence for AI coding agents.").version(version);

program.addHelpText(
  "after",
  `
Registering many repos (and databases) at once (agent_key, auto-discovery):
  1. Producers — API and database both, run in parallel. Safe to re-run, even from a different
     checkout/machine/CI than the one that registered it originally — both reclaim the existing
     producer instead of creating a duplicate:
       $ bruce init --agent-key <key> --bruce-url <url>
       $ bruce producers connect-db --agent-key <key> --bruce-url <url> --name "..." --slug ...
     connect-db only registers the producer and prints setup SQL — it never runs anything
     against the actual database; that's a separate, deliberate step.
  2. Before linking any consumer, look up what's actually registered — including producers
     from a DIFFERENT session you never saw — instead of guessing a slug:
       $ bruce producers list --agent-key <key> --bruce-url <url>
  3. Then link, once per matched producer:
       $ bruce consumer add --agent-key <key> --producer-slug <slug-from-step-2> --bruce-url <url>

  Run every producer in step 1 to completion before starting step 2 — linking against a
  producer that's still mid-registration will look identical to one that doesn't exist yet.`,
);

program
  .command("init")
  .description("Full scan — register this project's role and generate its mapping/contract file(s).")
  .option("--role <role>", "publisher or consumer (skips the interactive prompt)")
  .option("--api-key <key>", "producer API key (non-interactive publisher registration)")
  .option("--bruce-url <url>", "Bruce API URL (non-interactive registration)")
  .option("--token <token>", "consumer token (non-interactive consumer registration)")
  .option("--agent-key <key>", "owner's agent key — auto-registers this repo as a new producer (auto-discovery onboarding)")
  .option("--name <name>", "producer name override for --agent-key (defaults to package.json's name, or the directory name)")
  .option("--slug <slug>", "producer slug override for --agent-key (defaults to a slugified --name)")
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
  .option("--url <url>", "Bruce API URL provided by the API owner (with --token)")
  .option("--token <token>", "consumer token provided by the API owner (with --url)")
  .option("--agent-key <key>", "owner's agent key — links to a producer you already own by slug (with --producer-slug and --bruce-url)")
  .option("--producer-slug <slug>", "slug of the producer to link to (with --agent-key)")
  .option("--bruce-url <url>", "Bruce API URL (with --agent-key)")
  .option("--name <name>", "consumer relationship name override for --agent-key (defaults to package.json's name, or the directory name)")
  .description("Register this project as a consumer of an upstream API — either --url/--token (from the producer's dashboard) or --agent-key/--producer-slug (auto-discovery, same-owner only).")
  .action(consumerAddCommand);

const producersCommand = program.command("producers");

producersCommand
  .command("list")
  .requiredOption("--agent-key <key>", "owner's agent key")
  .requiredOption("--bruce-url <url>", "Bruce API URL")
  .description("List every producer (name, slug, kind) registered under this account — use this to find the right --producer-slug for `bruce consumer add` instead of guessing.")
  .action(producersListCommand);

producersCommand
  .command("connect-db")
  .requiredOption("--agent-key <key>", "owner's agent key")
  .requiredOption("--bruce-url <url>", "Bruce API URL")
  .option("--name <name>", "producer name override (defaults to the repo/directory name + \" DB\")")
  .option("--slug <slug>", "producer slug override (defaults to a slugified --name)")
  .description(
    "Register a Postgres/Supabase database as a producer and print the setup SQL to run against it — the CLI-driven counterpart to the dashboard's \"Connect a database\" flow. Only registers the producer; run the printed SQL yourself.",
  )
  .action(producersConnectDbCommand);

program
  .command("status")
  .description("Show what's registered, when it was last scanned, and whether a scan is due.")
  .action(statusCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
