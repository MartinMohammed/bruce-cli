import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BruceStateSchema, type BruceState, type ScanState } from "../shared/index.js";
import { stateDir, statePath } from "./paths.js";

export function readState(cwd = process.cwd()): BruceState {
  const file = statePath(cwd);
  if (!existsSync(file)) return {};
  const parsed = BruceStateSchema.safeParse(JSON.parse(readFileSync(file, "utf-8")));
  return parsed.success ? parsed.data : {};
}

export function writeState(state: BruceState, cwd = process.cwd()): void {
  mkdirSync(stateDir(cwd), { recursive: true });
  writeFileSync(statePath(cwd), JSON.stringify(state, null, 2));
}

export function emptyScanState(): ScanState {
  return { lastScannedCommit: null, lastFullScanCommit: null, trackedFiles: [], mappingHash: null };
}

export function setProducerScanState(patch: ScanState, cwd = process.cwd()): void {
  const state = readState(cwd);
  writeState({ ...state, producer: patch }, cwd);
}

export function setConsumerScanState(producerSlug: string, patch: ScanState, cwd = process.cwd()): void {
  const state = readState(cwd);
  writeState({ ...state, consumers: { ...state.consumers, [producerSlug]: patch } }, cwd);
}
