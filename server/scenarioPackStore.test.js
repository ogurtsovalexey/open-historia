import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { canonicalStringify } from '@open-historia/data-packs';
import { worldV2 } from '@open-historia/engine';
import { minimalScenarioV3 } from '../packages/data-packs/dist-test/test/scenarioV3Fixtures.js';
import {
  listCompiledScenarioPacks,
  loadCompiledScenarioPack,
} from './scenarioPackStore.js';

let temporary;

before(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-pack-store-'));
});

after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
});

const checksum = (value) => `sha256:${createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')}`;

function testRoot(name) {
  const root = path.join(temporary, name);
  fs.mkdirSync(root);
  return root;
}

function publish(directoryName, scenario = minimalScenarioV3(), root = temporary) {
  const compiled = worldV2.compileScenarioV3(scenario);
  const directory = path.join(root, directoryName);
  fs.mkdirSync(directory);
  const manifest = {
    schemaVersion: 'open-historia-compiled-scenario/1',
    generatedBy: 'open-historia-scenario-v3-cli',
    scenarioId: compiled.seed.id,
    bundleChecksum: compiled.bundleChecksum,
    seedChecksum: compiled.seedChecksum,
    initialStateRevision: compiled.initialState.revision,
    runtimeProjectionChecksum: compiled.runtimeProjectionChecksum,
    artifacts: {
      initialState: 'initial-state.json',
      runtimeProjection: 'runtime-projection.json',
      seed: 'world-seed.json',
    },
  };
  for (const [name, value] of [
    ['initial-state.json', compiled.initialState],
    ['manifest.json', manifest],
    ['runtime-projection.json', compiled.runtimeProjection],
    ['world-seed.json', compiled.seed],
  ]) fs.writeFileSync(path.join(directory, name), `${canonicalStringify(value)}\n`, 'utf8');
  return { compiled, directory };
}

describe('generic compiled ScenarioV3 pack store', () => {
  it('lists and loads checksum-verified packs without scenario-specific branches', () => {
    const root = testRoot('valid-packs');
    const scenario = minimalScenarioV3();
    scenario.id = 'scenario:store-zeta';
    scenario.metadata.title = { en: 'Zeta' };
    publish('zeta', scenario, root);
    const other = minimalScenarioV3();
    other.id = 'scenario:store-alpha';
    other.metadata.title = { en: 'Alpha' };
    publish('alpha', other, root);

    const listed = listCompiledScenarioPacks({ rootDirectory: root });
    assert.deepEqual(listed.map((entry) => entry.scenarioId), [
      'scenario:store-alpha',
      'scenario:store-zeta',
    ]);
    const loaded = loadCompiledScenarioPack('scenario:store-zeta', { rootDirectory: root });
    assert.equal(loaded.manifest.scenarioId, 'scenario:store-zeta');
    assert.equal(loaded.initialState.revision, loaded.manifest.initialStateRevision);
    assert.equal(checksum(loaded.seed), loaded.manifest.seedChecksum);
    assert.equal(checksum(loaded.runtimeProjection), loaded.manifest.runtimeProjectionChecksum);
  });

  it('fails closed on tampering, extra files and symlinks', () => {
    const root = testRoot('invalid-packs');
    const { directory } = publish('tampered', minimalScenarioV3(), root);
    const statePath = path.join(directory, 'initial-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.polities[0].treasury += 1;
    fs.writeFileSync(statePath, JSON.stringify(state));
    assert.throws(
      () => loadCompiledScenarioPack('scenario:v3-minimal', { rootDirectory: root }),
      /revision mismatch/i,
    );

    fs.rmSync(directory, { recursive: true, force: true });
    const extra = publish('extra', { ...minimalScenarioV3(), id: 'scenario:store-extra' }, root);
    fs.writeFileSync(path.join(extra.directory, 'sentinel.txt'), 'not a compiled artifact');
    assert.throws(
      () => loadCompiledScenarioPack('scenario:store-extra', { rootDirectory: root }),
      /exactly four regular artifacts/i,
    );

    fs.rmSync(extra.directory, { recursive: true, force: true });
    const linked = publish('linked', { ...minimalScenarioV3(), id: 'scenario:store-linked' }, root);
    const projectionPath = path.join(linked.directory, 'runtime-projection.json');
    fs.unlinkSync(projectionPath);
    fs.symlinkSync(path.join(linked.directory, 'world-seed.json'), projectionPath);
    assert.throws(
      () => loadCompiledScenarioPack('scenario:store-linked', { rootDirectory: root }),
      /regular non-symlink/i,
    );
  });

  it('rejects duplicate scenario identities and invalid lookup tokens', () => {
    const root = testRoot('duplicate-packs');
    publish('duplicate-a', { ...minimalScenarioV3(), id: 'scenario:store-duplicate' }, root);
    publish('duplicate-b', { ...minimalScenarioV3(), id: 'scenario:store-duplicate' }, root);
    assert.throws(
      () => listCompiledScenarioPacks({ rootDirectory: root }),
      /duplicate compiled scenario id/i,
    );
    assert.throws(
      () => loadCompiledScenarioPack('../escape', { rootDirectory: root }),
      /invalid scenario id/i,
    );
  });
});
