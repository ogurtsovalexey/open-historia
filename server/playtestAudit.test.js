import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { buildPlaytestAudit } from '../scripts/playtest-audit.mjs';

let temporary;
let library;
let living;
let gameId;

before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-playtest-audit-'));
  process.env.OH_DATA_DIR = temporary;
  library = await import('./libraryStore.js');
  living = await import('./livingWorldStore.js');
  gameId = library.createGame({
    scenarioId: 'scenario:napoleonic-europe-1805',
    playerPolityId: 'polity:france',
    name: 'Audit export test',
  }).game.id;
});

after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
  delete process.env.OH_DATA_DIR;
});

test('exports a validated, read-only revision and provider-provenance audit', () => {
  const before = living.readLivingWorld(gameId);
  const submitted = living.submitLivingWorldIntent(gameId, {
    revision: before.projection.revision,
    sessionRevision: before.sessionRevision,
    intentions: ['Keep the frontier supplied.'],
    modelOutput: {
      revision: before.projection.revision,
      questions: [], claims: [], requestedActions: [], proposedInitiatives: [],
    },
    modelMetadata: {
      provider: 'codex-subscription',
      model: 'gpt-5.6-luna',
      effort: 'low',
      endpoint: 'must-not-be-persisted',
      apiKey: 'must-not-be-persisted',
    },
  });
  living.confirmLivingWorldIntent(gameId, {
    revision: submitted.projection.revision,
    sessionRevision: submitted.sessionRevision,
    interpretationId: submitted.projection.interpretation.interpretationId,
  });

  const revisionDirectory = path.join(library.getGameDirectory(gameId), 'engine-session', 'revisions');
  const diskBefore = fs.readdirSync(revisionDirectory).sort();
  const audit = buildPlaytestAudit({ gameId, dataDir: temporary });
  const diskAfter = fs.readdirSync(revisionDirectory).sort();

  assert.deepEqual(diskAfter, diskBefore, 'the exporter must not create or change session revisions');
  assert.equal(audit.schemaVersion, 'open-historia-playtest-audit/1');
  assert.equal(audit.game.gameId, gameId);
  assert.equal(audit.current.date, '1805-01-01');
  assert.equal(audit.replay.length, 3);
  assert.equal(audit.ledger.length, audit.replay.length);
  assert.match(audit.replayChecksum, /^sha256:[a-f0-9]{64}$/);
  assert.match(audit.auditChecksum, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(audit.modelMetadata, [{
    role: 'utility', provider: 'codex-subscription', model: 'gpt-5.6-luna', effort: 'low',
  }]);
  assert.equal(JSON.stringify(audit).includes('must-not-be-persisted'), false);
  assert.equal(audit.privacy.rawPromptsOrResponsesIncluded, false);
});

test('rejects an unsafe game identifier before reading a save', () => {
  assert.throws(() => buildPlaytestAudit({ gameId: '../escape', dataDir: temporary }), /safe directory/i);
});
