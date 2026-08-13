import { spawn } from "node:child_process";

export interface ClaudeInvokeOptions {
  cwd: string;
  prompt: string;
  allowedTools: string;
  model?: string;
  timeoutMs?: number;
}

export interface ClaudeInvokeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawns Claude Code headlessly (`claude -p`), prompt piped via stdin rather
 * than argv to avoid quoting/injection issues with large prompts, tool
 * access restricted to exactly what the calling command needs. This is the
 * CLI-owned "sync moment" from DESIGN_NOTES.md §7.3 — it spawns a fresh,
 * scoped run rather than trying to attach to any existing session.
 */
export function invokeClaudeHeadless(options: ClaudeInvokeOptions): Promise<ClaudeInvokeResult> {
  return new Promise((resolve) => {
    const args = ["-p", "--output-format", "json", "--allowedTools", options.allowedTools];
    if (options.model) args.push("--model", options.model);

    const child = spawn("claude", args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 180_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, stdout, stderr, timedOut });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: stderr + String(err), timedOut });
    });

    child.stdin.write(options.prompt);
    child.stdin.end();
  });
}
