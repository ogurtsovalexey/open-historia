/*! Initialize, but never reset, the local store used by real UI playtests. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'server', 'data');
const target = path.join(root, '.local-playtests', 'live-data');
const marker = path.join(target, '.open-historia-live-playtest-store');

fs.mkdirSync(target, { recursive: true });

// Browser smoke data is deliberately recreated for every test run. Real model
// playtests are evidence: do not make them a child of test-results and do not
// delete an existing store when preparing a later run.
if (!fs.existsSync(marker)) {
  fs.cpSync(path.join(source, 'scenarios'), path.join(target, 'scenarios'), { recursive: true });
  for (const file of ['scenario-manifest.json', 'ui-settings.json']) {
    const from = path.join(source, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, file));
  }
  fs.writeFileSync(marker, 'Persistent local data for real Living World UI playtests.\n');
}

process.stdout.write(`${target}\n`);
