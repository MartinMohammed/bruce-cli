#!/usr/bin/env node
import { register } from "tsx/esm/api";
import { fileURLToPath } from "node:url";
import path from "node:path";

register();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(__dirname, "../src/index.ts"));
