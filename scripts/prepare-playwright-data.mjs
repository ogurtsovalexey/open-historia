/*! Prepare an isolated mutable server store for browser smoke tests. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "server", "data");
const target = path.join(root, "test-results", "playwright-data");

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(path.join(source, "scenarios"), path.join(target, "scenarios"), { recursive: true });
for (const file of ["scenario-manifest.json", "ui-settings.json"]) {
  const from = path.join(source, file);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, file));
}
