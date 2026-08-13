import { execFileSync } from "node:child_process";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

export function isGitRepo(cwd = process.cwd()): boolean {
  try {
    git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

export function currentCommit(cwd = process.cwd()): string | null {
  try {
    return git(["rev-parse", "HEAD"], cwd);
  } catch {
    return null;
  }
}

/**
 * Files changed between two commits, scoped to `cwd`'s subtree and returned
 * as paths relative to `cwd` — not the repo root. Without `--relative`, a
 * `cwd` inside a monorepo subfolder would see (and Claude would be told to
 * read) every changed file across the whole repo, including sibling
 * projects it has no business touching.
 */
export function diffFilesSince(fromSha: string, cwd = process.cwd()): string[] {
  try {
    const out = git(["diff", "--name-only", "--relative", fromSha, "HEAD"], cwd);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}
