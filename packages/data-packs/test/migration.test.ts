import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LegacySpecAdapter } from '../src/legacy-adapter.js';
import { scenarioV2Schema } from '../src/schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const fixturePath = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'legacy-rome.spec.mjs');
const fixtureUrl = pathToFileURL(fixturePath).href;

describe('LegacySpecAdapter — side-by-side migration', () => {
  it('produces a schema-valid side-by-side Draft plus a loss report', async () => {
    const { default: spec } = (await import(fixtureUrl)) as { default: unknown };
    const adapter = new LegacySpecAdapter();
    const result = adapter.migrate(spec);

    assert.strictEqual(result.report.scenarioId, 'scenario:legacy-rome');
    assert.strictEqual(result.report.polityCount, 2);

    // Side-by-side Draft must parse as a Scenario V2 document.
    const draft = result.draft as { scenario: unknown };
    assert.strictEqual(scenarioV2Schema.safeParse(draft.scenario).success, true);

    // Loss report must record the deferred (unresolvable) fields.
    const lossPaths = result.report.losses.map((l) => l.path);
    assert(lossPaths.includes('/scenario/regionAssignments'));
    assert(lossPaths.includes('/scenario/historicalFacts'));
    assert(lossPaths.includes('/scenario/assumptions'));
  });

  it('is idempotent: two runs yield byte-identical Draft and report', async () => {
    const { default: spec } = (await import(fixtureUrl)) as { default: unknown };
    const adapter = new LegacySpecAdapter();
    const first = adapter.migrate(spec);
    const second = adapter.migrate(spec);

    assert.strictEqual(first.draftChecksum, second.draftChecksum);
    assert.deepStrictEqual(first.draft, second.draft);
    assert.deepStrictEqual(first.report, second.report);
  });

  it('does not rewrite the source spec', async () => {
    const before = readFileSync(fixturePath, 'utf8');
    const { default: spec } = (await import(fixtureUrl)) as { default: unknown };
    void new LegacySpecAdapter().migrate(spec);
    const after = readFileSync(fixturePath, 'utf8');
    assert.strictEqual(before, after);
  });

  it('moves prose simulationRules into constraints.narrativeRules with a warning', async () => {
    const { default: spec } = (await import(fixtureUrl)) as { default: unknown };
    const result = new LegacySpecAdapter().migrate(spec);
    const draft = result.draft as {
      scenario: { simulationRules: { constraints: { narrativeRules: string[] } } };
    };
    assert.strictEqual(draft.scenario.simulationRules.constraints.narrativeRules.length, 1);
    assert(result.report.warnings.some((w) => w.path === '/scenario/simulationRules'));
  });

  it('writes a real deterministic side-by-side Draft directory without changing the source', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'open-historia-v2-migration-'));
    const output = path.join(tempRoot, 'legacy-rome.v2-draft');
    const before = readFileSync(fixturePath);
    try {
      const adapter = new LegacySpecAdapter();
      const first = await adapter.migrateFile(fixturePath, output);
      const firstBytes = Object.fromEntries(first.files.map((name) => [name, readFileSync(path.join(output, name), 'utf8')]));
      const second = await adapter.migrateFile(fixturePath, output);
      const secondBytes = Object.fromEntries(second.files.map((name) => [name, readFileSync(path.join(output, name), 'utf8')]));

      assert.deepStrictEqual(readdirSync(output).sort(), ['manifest.json', 'migration-report.json', 'scenario.json', 'sources.json']);
      assert.deepStrictEqual(firstBytes, secondBytes);
      assert(before.equals(readFileSync(fixturePath)));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('LegacySpecAdapter — real read-only preset', () => {
  it('migrates the real roman-117 preset without rewriting it', async () => {
    const realSpecPath = path.join(repoRoot, 'scripts', 'presets', 'roman-117.spec.mjs');
    if (!existsSync(realSpecPath)) {
      // The adapter path is still exercised above; the real preset is read-only
      // fixture data that may not be present in every checkout.
      return;
    }
    const before = readFileSync(realSpecPath, 'utf8');
    const { default: spec } = (await import(pathToFileURL(realSpecPath).href)) as { default: unknown };
    const result = new LegacySpecAdapter().migrate(spec);
    const after = readFileSync(realSpecPath, 'utf8');

    assert.strictEqual(before, after);
    assert.strictEqual(result.report.scenarioId, 'scenario:roman-117');
    assert(result.report.polityCount > 0);
  });
});
