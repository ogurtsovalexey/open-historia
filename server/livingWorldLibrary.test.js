import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

let temporary;
let library;

before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-living-library-'));
  process.env.OH_DATA_DIR = temporary;
  library = await import('./libraryStore.js');
});

after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
  delete process.env.OH_DATA_DIR;
});

describe('living-world library integration', () => {
  it('publishes all compiled ScenarioV3 packs as immutable playable scenarios', () => {
    const catalog = library.getScenarioCatalog();
    const living = catalog.scenarios.filter((entry) => entry.livingWorld);
    assert.deepEqual(living.map((entry) => entry.id), [
      'scenario:central-mesoamerica-1450',
      'scenario:europe-1935-benchmark',
      'scenario:napoleonic-europe-1805',
    ]);
    assert.ok(living.every((entry) => entry.canDelete === false && entry.immutable === true));
    const details = library.getScenarioDetails('scenario:napoleonic-europe-1805');
    assert.equal(details.data.game.startDate, '1805-01-01');
    assert.equal(details.data.world.playableOwnerCodes.includes('polity:france'), true);
    assert.equal(details.data.world.ownerCodes.includes('polity:hanover'), true);
  });

  it('creates an atomic V3 session and preserves stable polity identity', () => {
    const details = library.createGame({
      name: 'French 1805 test',
      scenarioId: 'scenario:napoleonic-europe-1805',
      playerPolityId: 'polity:france',
      setActive: true,
    });
    assert.equal(details.game.livingWorld, true);
    assert.equal(details.game.playerPolityId, 'polity:france');
    assert.equal(details.game.currentDate, '1805-01-01');
    assert.match(details.game.seedChecksum, /^sha256:[a-f0-9]{64}$/u);

    const changed = library.updateGame(details.game.id, { gamePatch: { country: 'polity:russia' } });
    assert.equal(changed.game.playerPolityId, 'polity:russia');
    assert.equal(changed.data.game.country, 'polity:russia');
    assert.throws(
      () => library.updateGame(details.game.id, { gamePatch: { country: 'polity:hanover' } }),
      /not player-eligible/i,
    );
  });

  it('refuses implicit living-world save cloning', () => {
    const game = library.getGameCatalog().games.find((entry) => entry.livingWorld);
    assert.ok(game);
    assert.throws(() => library.createGame({ seedGameId: game.id, name: 'unsafe fork' }), /explicit revision fork/i);
  });
});
