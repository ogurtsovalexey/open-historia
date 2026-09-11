import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { buildPlaytestAudit } from '../scripts/playtest-audit.mjs';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const descriptor = (bytes) => ({ sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) });

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

test('audits a hash-verified historical V2 revision through the same narrow migration as the live server', () => {
  const legacyGame = library.createGame({
    scenarioId: 'scenario:napoleonic-europe-1805',
    playerPolityId: 'polity:france',
    name: 'Legacy audit export test',
  }).game;
  const sessionRoot = path.join(library.getGameDirectory(legacyGame.id), 'engine-session');
  const pointer = JSON.parse(fs.readFileSync(path.join(sessionRoot, 'current.json'), 'utf8'));
  const originalDirectory = path.join(sessionRoot, 'revisions', pointer.revision.replace(':', '-'));
  const originalManifest = JSON.parse(fs.readFileSync(path.join(originalDirectory, 'manifest.json'), 'utf8'));
  const legacyState = JSON.parse(fs.readFileSync(path.join(originalDirectory, 'world-state.json'), 'utf8'));
  for (const region of legacyState.regions) delete region.adjacentRegionIds;
  for (const type of legacyState.catalogs.relationshipTypes) delete type.playerProposable;
  const { revision: _oldRevision, ...legacyContent } = legacyState;
  void _oldRevision;
  legacyState.revision = sha256(canonical(legacyContent));
  const payloads = {
    state: `${JSON.stringify(legacyState)}\n`,
    lastTransition: fs.readFileSync(path.join(originalDirectory, 'last-transition.json'), 'utf8'),
    strategicState: fs.readFileSync(path.join(originalDirectory, 'strategic-state.json'), 'utf8'),
    agentTurn: fs.readFileSync(path.join(originalDirectory, 'agent-turn.json'), 'utf8'),
    playerIntent: fs.readFileSync(path.join(originalDirectory, 'player-intent.json'), 'utf8'),
  };
  const manifestContent = {
    ...originalManifest,
    revision: undefined,
    worldRevision: legacyState.revision,
    files: Object.fromEntries(Object.entries(payloads).map(([key, bytes]) => [key, descriptor(bytes)])),
  };
  delete manifestContent.revision;
  const legacyManifest = { ...manifestContent, revision: sha256(canonical(manifestContent)) };
  const legacyDirectory = path.join(sessionRoot, 'revisions', legacyManifest.revision.replace(':', '-'));
  fs.mkdirSync(legacyDirectory);
  for (const [key, filename] of Object.entries({
    state: 'world-state.json', lastTransition: 'last-transition.json', strategicState: 'strategic-state.json',
    agentTurn: 'agent-turn.json', playerIntent: 'player-intent.json',
  })) fs.writeFileSync(path.join(legacyDirectory, filename), payloads[key]);
  fs.writeFileSync(path.join(legacyDirectory, 'manifest.json'), `${canonical(legacyManifest)}\n`);
  fs.writeFileSync(path.join(sessionRoot, 'current.json'), `${canonical({ revision: legacyManifest.revision })}\n`);

  const audit = buildPlaytestAudit({ gameId: legacyGame.id, dataDir: temporary });
  assert.equal(audit.current.sessionRevision, legacyManifest.revision);
  assert.notEqual(audit.current.worldRevision, legacyState.revision);
  assert.equal(audit.current.groundedSnapshot.revision, audit.current.worldRevision);
});
