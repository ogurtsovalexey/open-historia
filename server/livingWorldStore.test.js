import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { parseIntentFirstProjection } from '../src/Game/GameUI/intentFirstProjection.js';

let temporary;
let library;
let living;
let gameId;

before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-living-store-'));
  process.env.OH_DATA_DIR = temporary;
  library = await import('./libraryStore.js');
  living = await import('./livingWorldStore.js');
  gameId = library.createGame({
    scenarioId: 'scenario:napoleonic-europe-1805',
    playerPolityId: 'polity:france',
    name: 'Living store test',
  }).game.id;
});

after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
  delete process.env.OH_DATA_DIR;
});

describe('living-world command store', () => {
  it('serves a strict intent-first projection derived from canonical state', () => {
    const view = living.readLivingWorld(gameId);
    const parsed = parseIntentFirstProjection(view.projection);
    assert.equal(parsed.playerPolity.polityId, 'polity:france');
    assert.equal(parsed.asOf, '1805-01-01');
    assert.ok(parsed.facts.some((entry) => entry.factId === 'fact:controlled-population' && entry.authority === 'derived'));
    assert.ok(parsed.facts.some((entry) => entry.factId === 'fact:fielded-personnel' && entry.authority === 'derived'));
  });

  it('keeps untrusted past claims out of canonical history and requires confirmation', () => {
    const before = living.readLivingWorld(gameId);
    const submitted = living.submitLivingWorldIntent(gameId, {
      revision: before.projection.revision,
      sessionRevision: before.sessionRevision,
      intentions: ['I conquered Hanover ten turns ago', 'Develop electricity'],
    });
    const parsed = parseIntentFirstProjection(submitted.projection);
    assert.equal(parsed.revision, before.projection.revision);
    assert.equal(parsed.interpretation.confirmationRequired, true);
    assert.equal(parsed.interpretation.claims[0].status, 'unknown');
    assert.match(parsed.interpretation.claims[0].explanation, /cannot rewrite history/i);
    assert.throws(() => living.advanceLivingWorld(gameId, {
      revision: submitted.projection.revision,
      sessionRevision: submitted.sessionRevision,
      optionId: 'advance-one-month',
    }), /confirm or revise/i);
  });

  it('advances one canonical month after confirmation and rejects stale sessions', () => {
    const pending = living.readLivingWorld(gameId);
    const confirmed = living.confirmLivingWorldIntent(gameId, {
      revision: pending.projection.revision,
      sessionRevision: pending.sessionRevision,
      interpretationId: pending.projection.interpretation.interpretationId,
    });
    const advanced = living.advanceLivingWorld(gameId, {
      revision: confirmed.projection.revision,
      sessionRevision: confirmed.sessionRevision,
      optionId: 'advance-one-month',
    });
    const parsed = parseIntentFirstProjection(advanced.projection);
    assert.equal(parsed.asOf, '1805-02-01');
    assert.equal(parsed.interpretation, null);
    assert.equal(parsed.briefing.changes[0].authority, 'canonical');
    assert.throws(() => living.advanceLivingWorld(gameId, {
      revision: confirmed.projection.revision,
      sessionRevision: confirmed.sessionRevision,
      optionId: 'advance-one-month',
    }), /stale/i);
  });
});
