#!/usr/bin/env node

// Read-only evidence exporter for Living World UI playtests.  It deliberately
// reads immutable session revisions instead of calling the HTTP server, so a
// report can be reproduced after a run and cannot mutate the game it audits.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { worldV2 } from '@open-historia/engine';
import { readEngineSession } from '../server/engineSessionStore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GAME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const checksum = (value) => `sha256:${crypto.createHash('sha256').update(canonical(value)).digest('hex')}`;
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function safeGameDirectory(dataDirectory, gameId) {
  if (!GAME_ID_PATTERN.test(gameId)) throw new Error('game id must be a single safe directory name');
  const gamesDirectory = path.resolve(dataDirectory, 'games');
  const gameDirectory = path.resolve(gamesDirectory, gameId);
  if (path.dirname(gameDirectory) !== gamesDirectory) throw new Error('game id escapes the games directory');
  return gameDirectory;
}

function revisionDirectory(gameDirectory, revision) {
  if (!REVISION_PATTERN.test(revision)) throw new Error(`invalid session revision ${String(revision)}`);
  return path.join(gameDirectory, 'engine-session', 'revisions', revision.replace(':', '-'));
}

function snapshotFor(state, polityId) {
  const derived = worldV2.derivePolitySnapshot(state, polityId);
  const snapshot = derived.value;
  return {
    month: state.month,
    revision: state.revision,
    controlledPopulation: snapshot.controlledPopulation,
    administeredPopulation: snapshot.administeredPopulation,
    workforce: snapshot.workforce,
    treasury: snapshot.treasury,
    regionalOutput: snapshot.regionalOutput,
    fieldedPersonnel: snapshot.fieldedPersonnel,
    availableManpower: snapshot.availableManpower,
    supplyCapacity: snapshot.supplyCapacity,
    evidenceIds: [...derived.evidenceIds].sort(),
  };
}

function readRevisionChain(gameDirectory, latestRevision, polityId) {
  const visited = new Set();
  const reverse = [];
  let revision = latestRevision;
  while (revision) {
    if (visited.has(revision)) throw new Error('engine-session parent chain contains a cycle');
    visited.add(revision);
    const directory = revisionDirectory(gameDirectory, revision);
    const manifest = readJson(path.join(directory, 'manifest.json'));
    if (manifest.revision !== revision) throw new Error('engine-session manifest revision does not match its directory');
    const state = worldV2.parseWorldStateV2(readJson(path.join(directory, 'world-state.json')));
    const transition = readJson(path.join(directory, 'last-transition.json'));
    const playerIntent = readJson(path.join(directory, 'player-intent.json'));
    reverse.push({
      sessionRevision: revision,
      parentRevision: manifest.parentRevision ?? null,
      worldRevision: manifest.worldRevision,
      date: manifest.gameDate,
      turn: manifest.turn,
      playerDecisionIndex: manifest.playerDecisionIndex,
      snapshot: snapshotFor(state, polityId),
      transition,
      playerIntent,
    });
    revision = manifest.parentRevision ?? null;
  }
  return reverse.reverse();
}

function modelProvenance(revisions) {
  const seen = new Set();
  const metadata = [];
  for (const revision of revisions) {
    for (const candidate of [revision.playerIntent?.modelMetadata, revision.transition?.modelMetadata]) {
      if (!candidate) continue;
      const key = canonical(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      metadata.push(candidate);
    }
  }
  return metadata;
}

export function buildPlaytestAudit({ gameId, dataDir = process.env.OH_DATA_DIR ?? path.join(ROOT, 'server', 'data') }) {
  const dataDirectory = path.resolve(dataDir);
  const gameDirectory = safeGameDirectory(dataDirectory, gameId);
  const rawGame = readJson(path.join(gameDirectory, 'game-instance.json'));
  if (rawGame.id !== undefined && rawGame.id !== gameId) {
    throw new Error(`game metadata id does not match requested game id (${String(rawGame.id)} != ${gameId})`);
  }
  // `id` is derived from the storage directory by libraryStore; older and
  // freshly-created metadata files intentionally omit the redundant field.
  const game = { ...rawGame, id: gameId };
  if (game.livingWorld !== true) throw new Error('playtest audit only supports living-world games');

  // This validates manifest hashes, the parent chain and WorldStateV2 before
  // any report data is emitted.
  const session = readEngineSession(gameDirectory);
  if (!session) throw new Error('game has no engine session');
  const revisions = readRevisionChain(gameDirectory, session.manifest.revision, game.playerPolityId);
  const replay = revisions.map((entry) => ({
    sessionRevision: entry.sessionRevision,
    worldRevision: entry.worldRevision,
    date: entry.date,
    turn: entry.turn,
    playerDecisionIndex: entry.playerDecisionIndex,
  }));
  const ledger = revisions.map(({ sessionRevision, transition }) => ({ sessionRevision, transition }));

  const audit = {
    schemaVersion: 'open-historia-playtest-audit/1',
    game: {
      gameId: game.id,
      scenarioId: game.scenarioId,
      playerPolityId: game.playerPolityId,
      seedChecksum: game.seedChecksum,
    },
    current: {
      sessionRevision: session.manifest.revision,
      worldRevision: session.state.revision,
      date: session.state.month,
      turn: session.state.turn,
      playerDecisionIndex: session.playerDecisionIndex,
      groundedSnapshot: snapshotFor(session.state, game.playerPolityId),
    },
    replay,
    replayChecksum: checksum(replay),
    groundedSnapshots: revisions.map(({ sessionRevision, snapshot }) => ({ sessionRevision, ...snapshot })),
    ledger,
    modelMetadata: modelProvenance(revisions),
    privacy: {
      rawPromptsOrResponsesIncluded: false,
      note: 'Only sanitized provider/model/effort provenance and canonical session transitions are exported.',
    },
  };
  return { ...audit, auditChecksum: checksum(audit) };
}

function parseArguments(argv) {
  const options = { gameId: null, dataDir: process.env.OH_DATA_DIR ?? path.join(ROOT, 'server', 'data'), output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--game' || flag === '--data-dir' || flag === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      if (flag === '--game') options.gameId = value;
      if (flag === '--data-dir') options.dataDir = value;
      if (flag === '--output') options.output = value;
      index += 1;
      continue;
    }
    if (flag === '--help') {
      process.stdout.write('Usage: npm run playtest:audit -- --game <game-id> [--data-dir <directory>] [--output <audit.json>]\n');
      process.exit(0);
    }
    throw new Error(`unknown argument ${flag}`);
  }
  if (!options.gameId) throw new Error('--game is required');
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const audit = buildPlaytestAudit(options);
    const bytes = `${JSON.stringify(audit, null, 2)}\n`;
    if (options.output) fs.writeFileSync(path.resolve(options.output), bytes, 'utf8');
    else process.stdout.write(bytes);
  } catch (error) {
    process.stderr.write(`playtest audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
