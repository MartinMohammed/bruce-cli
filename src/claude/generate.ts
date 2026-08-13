import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { invokeClaudeHeadless } from "./invoke.js";

const DEFAULT_ALLOWED_TOOLS = "Read,Grep,Glob,Bash(git diff:*),Edit,Write";

export class BruceGenerationError extends Error {}

export interface GenerateFileOptions<T> {
  cwd: string;
  /** Path relative to `cwd` that Claude is instructed to write. */
  targetPath: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Absolute path to a pre-recorded fallback JSON file, used only if BRUCE_DEMO_FALLBACK=1 and the live call fails. */
  fallbackPath?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Runs Claude headlessly to (re)generate a mapping/snapshot file, then
 * validates the result deterministically (no LLM) before accepting it.
 * Snapshots the previous file content and restores it on any failure, per
 * DESIGN_NOTES.md §7.3's guardrails for the unattended path.
 */
export async function generateFile<T>(options: GenerateFileOptions<T>): Promise<T> {
  const absoluteTarget = path.join(options.cwd, options.targetPath);
  const backup = existsSync(absoluteTarget) ? readFileSync(absoluteTarget, "utf-8") : null;

  const result = await invokeClaudeHeadless({
    cwd: options.cwd,
    prompt: options.prompt,
    allowedTools: DEFAULT_ALLOWED_TOOLS,
    model: options.model,
    timeoutMs: options.timeoutMs,
  });

  if (!result.ok) {
    return handleFailure(options, absoluteTarget, backup, result.timedOut ? "Claude timed out" : "Claude exited with an error");
  }

  if (!existsSync(absoluteTarget)) {
    return handleFailure(options, absoluteTarget, backup, "Claude did not write the target file");
  }

  const raw = readFileSync(absoluteTarget, "utf-8");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return handleFailure(options, absoluteTarget, backup, "Claude wrote invalid JSON");
  }

  const validated = options.schema.safeParse(parsedJson);
  if (!validated.success) {
    return handleFailure(options, absoluteTarget, backup, `Output failed schema validation: ${validated.error.message}`);
  }

  return validated.data;
}

function handleFailure<T>(
  options: GenerateFileOptions<T>,
  absoluteTarget: string,
  backup: string | null,
  reason: string,
): T {
  if (process.env.BRUCE_DEMO_FALLBACK === "1" && options.fallbackPath && existsSync(options.fallbackPath)) {
    const fallbackRaw = readFileSync(options.fallbackPath, "utf-8");
    const validated = options.schema.safeParse(JSON.parse(fallbackRaw));
    if (validated.success) {
      mkdirSync(path.dirname(absoluteTarget), { recursive: true });
      writeFileSync(absoluteTarget, fallbackRaw);
      return validated.data;
    }
  }

  if (backup !== null) {
    writeFileSync(absoluteTarget, backup);
  }
  throw new BruceGenerationError(`${reason}. ${backup !== null ? "Previous file restored." : "No previous file to restore."}`);
}

/**
 * Heuristic check for `bruce scan`: warns (does not hard-fail, to stay
 * demo-safe) if the patch looks like it ignored the "patch, don't
 * regenerate" instruction — i.e. touched an implausibly large fraction of
 * the file's top-level entries.
 */
export function warnIfLooksLikeFullRegen(previous: unknown, next: unknown): string | null {
  const prevKeys = topLevelIdentityKeys(previous);
  const nextKeys = topLevelIdentityKeys(next);
  if (prevKeys.length === 0) return null;

  const overlap = prevKeys.filter((k) => nextKeys.includes(k)).length;
  const overlapRatio = overlap / prevKeys.length;

  if (overlapRatio < 0.5) {
    return `bruce scan changed ${Math.round((1 - overlapRatio) * 100)}% of previously tracked endpoints — this looks more like a full regeneration than an incremental patch. Consider running \`bruce init\` if this was intentional.`;
  }
  return null;
}

function topLevelIdentityKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("endpoints" in value)) return [];
  const endpoints = (value as { endpoints?: unknown }).endpoints;
  if (!Array.isArray(endpoints)) return [];
  return endpoints.map((e) => `${(e as { method?: string }).method ?? ""} ${(e as { path?: string }).path ?? ""}`);
}
