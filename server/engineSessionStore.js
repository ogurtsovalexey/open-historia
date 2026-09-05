/*! Open Historia — content-addressed, atomically published engine sessions. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { worldV2 } from "@open-historia/engine";

export const ENGINE_SESSION_SCHEMA = "open-historia-engine-session/1";
export const ENGINE_SESSION_SCHEMA_V2 = "open-historia-engine-session/2";
export const ENGINE_SESSION_SCHEMA_V3 = "open-historia-engine-session/3";
const POINTER_FILE = "current.json";
const MANIFEST_FILE = "manifest.json";
const FILES_V1 = Object.freeze({ state: "state.json", lastTurn: "last-turn.json", ownership: "ownership.json" });
const FILES_V2 = Object.freeze({
  ...FILES_V1,
  agentState: "agent-state.json",
  agentTurn: "agent-turn.json",
});
const FILES_V3 = Object.freeze({
  state: "world-state.json",
  lastTransition: "last-transition.json",
  strategicState: "strategic-state.json",
  agentTurn: "agent-turn.json",
  playerIntent: "player-intent.json",
});
const filesForSchema = (schema) => {
  if (schema === ENGINE_SESSION_SCHEMA_V3) return FILES_V3;
  if (schema === ENGINE_SESSION_SCHEMA_V2) return FILES_V2;
  return FILES_V1;
};

export class EngineSessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EngineSessionError";
    this.code = code;
  }
}

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const sha256 = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const jsonBytes = (value) => `${canonical(value)}\n`;
const assertToken = (value, field) => {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\\/\0]/.test(value) || value === "." || value === "..") {
    throw new EngineSessionError("INVALID_PATH_TOKEN", `${field} is not a safe path token`);
  }
};

const rootFor = (gameDir) => path.join(gameDir, "engine-session");
const revisionsFor = (gameDir) => path.join(rootFor(gameDir), "revisions");
const pointerFor = (gameDir) => path.join(rootFor(gameDir), POINTER_FILE);
const revisionDiskToken = (revision) => revision.replace(":", "-");
const revisionFor = (gameDir, revision) => {
  if (!/^sha256:[a-f0-9]{64}$/.test(revision)) {
    throw new EngineSessionError("INVALID_PATH_TOKEN", "session revision must be a SHA-256 content id");
  }
  // ':' is not a legal Windows filename character. Keep it in the public
  // content id but use a portable directory token on disk.
  return path.join(revisionsFor(gameDir), revisionDiskToken(revision));
};

let hooks = Object.freeze({});
export const setEngineSessionTestHooks = (next = {}) => {
  const previous = hooks;
  hooks = Object.freeze({ ...next });
  return () => { hooks = previous; };
};
const hook = (name, context) => {
  if (hooks[name]) hooks[name](Object.freeze({ ...context }));
};

const descriptor = (bytes) => ({ sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) });
const parseJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const verifyDirectoryFiles = (dir, manifest) => {
  for (const [key, filename] of Object.entries(filesForSchema(manifest.schema))) {
    const bytes = fs.readFileSync(path.join(dir, filename), "utf8");
    const expected = manifest.files?.[key];
    if (!expected || expected.sha256 !== sha256(bytes) || expected.bytes !== Buffer.byteLength(bytes)) {
      throw new EngineSessionError("CORRUPT_SESSION", `engine session ${key} hash does not match`);
    }
  }
};

const verifyManifest = (gameDir, manifest, visited = new Set()) => {
  if (!manifest || ![ENGINE_SESSION_SCHEMA, ENGINE_SESSION_SCHEMA_V2, ENGINE_SESSION_SCHEMA_V3].includes(manifest.schema) || typeof manifest.revision !== "string") {
    throw new EngineSessionError("CORRUPT_SESSION", "engine session manifest has an invalid schema");
  }
  const { revision, ...content } = manifest;
  if (sha256(canonical(content)) !== revision) {
    throw new EngineSessionError("CORRUPT_SESSION", "engine session manifest revision hash does not match");
  }
  if (visited.has(revision)) throw new EngineSessionError("CORRUPT_SESSION", "engine session parent chain contains a cycle");
  visited.add(revision);
  const dir = revisionFor(gameDir, revision);
  verifyDirectoryFiles(dir, manifest);
  if (manifest.parentRevision) {
    const parentPath = path.join(revisionFor(gameDir, manifest.parentRevision), MANIFEST_FILE);
    if (!fs.existsSync(parentPath)) {
      throw new EngineSessionError("CORRUPT_SESSION", "engine session parent revision is missing");
    }
    const parent = parseJson(parentPath);
    if (parent.revision !== manifest.parentRevision) throw new EngineSessionError("CORRUPT_SESSION", "engine session parent revision does not match");
    verifyManifest(gameDir, parent, visited);
  }
  return manifest;
};

export const readEngineSession = (gameDir) => {
  const pointerPath = pointerFor(gameDir);
  if (!fs.existsSync(pointerPath)) return null;
  let pointer;
  try {
    pointer = parseJson(pointerPath);
    assertToken(pointer?.revision, "session revision");
    const dir = revisionFor(gameDir, pointer.revision);
    const manifest = verifyManifest(gameDir, parseJson(path.join(dir, MANIFEST_FILE)));
    if (manifest.revision !== pointer.revision) throw new Error("pointer mismatch");
    if (manifest.schema === ENGINE_SESSION_SCHEMA_V3) {
      const state = worldV2.parseWorldStateV2(parseJson(path.join(dir, FILES_V3.state)));
      if (state.revision !== manifest.worldRevision
        || state.scenarioId !== manifest.scenarioId
        || state.revisionLineage.seedRevision !== manifest.seedChecksum
        || state.month !== manifest.gameDate
        || state.turn !== manifest.turn) {
        throw new EngineSessionError("CORRUPT_SESSION", "living-world manifest does not match its canonical WorldStateV2");
      }
      return {
        manifest,
        state,
        playerDecisionIndex: Number.isSafeInteger(manifest.playerDecisionIndex) && manifest.playerDecisionIndex >= 0
          ? manifest.playerDecisionIndex : 0,
        lastTurn: parseJson(path.join(dir, FILES_V3.lastTransition)),
        ownership: null,
        agentState: parseJson(path.join(dir, FILES_V3.strategicState)),
        agentTurn: parseJson(path.join(dir, FILES_V3.agentTurn)),
        playerIntent: parseJson(path.join(dir, FILES_V3.playerIntent)),
      };
    }
    return {
      manifest,
      state: parseJson(path.join(dir, FILES_V1.state)),
      lastTurn: parseJson(path.join(dir, FILES_V1.lastTurn)),
      ownership: parseJson(path.join(dir, FILES_V1.ownership)),
      agentState: manifest.schema === ENGINE_SESSION_SCHEMA_V2 ? parseJson(path.join(dir, FILES_V2.agentState)) : null,
      agentTurn: manifest.schema === ENGINE_SESSION_SCHEMA_V2 ? parseJson(path.join(dir, FILES_V2.agentTurn)) : null,
      playerIntent: null,
    };
  } catch (error) {
    if (error instanceof EngineSessionError) throw error;
    throw new EngineSessionError("CORRUPT_SESSION", `engine session is unreadable: ${error.message}`);
  }
};

const writeExclusive = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: "wx" });
};

const publishSessionRevision = (gameDir, { actual, gameId, manifest, payloads }) => {
  const root = rootFor(gameDir);
  const staging = path.join(root, "staging", revisionDiskToken(manifest.revision));
  const finalDir = revisionFor(gameDir, manifest.revision);
  fs.mkdirSync(path.dirname(staging), { recursive: true });
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    hook("beforeFiles", { gameId, revision: manifest.revision });
    for (const [key, filename] of Object.entries(filesForSchema(manifest.schema))) {
      writeExclusive(path.join(staging, filename), payloads[key]);
    }
    hook("afterFiles", { gameId, revision: manifest.revision });
    writeExclusive(path.join(staging, MANIFEST_FILE), `${canonical(manifest)}\n`);
    hook("afterManifest", { gameId, revision: manifest.revision });
    verifyDirectoryFiles(staging, manifest);
    hook("beforeRevisionPublish", { gameId, revision: manifest.revision });
    fs.mkdirSync(revisionsFor(gameDir), { recursive: true });
    if (!fs.existsSync(finalDir)) fs.renameSync(staging, finalDir);
    hook("beforePointerPublish", { gameId, revision: manifest.revision });
    const tempPointer = path.join(root, `.current-${process.pid}.tmp`);
    fs.writeFileSync(tempPointer, `${canonical({ revision: manifest.revision })}\n`, "utf8");
    fs.renameSync(tempPointer, pointerFor(gameDir));
    hook("afterPointerPublish", { gameId, revision: manifest.revision });
    return readEngineSession(gameDir);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(path.join(root, `.current-${process.pid}.tmp`), { force: true });
    let candidateWasPublished = false;
    try { candidateWasPublished = parseJson(pointerFor(gameDir))?.revision === manifest.revision; } catch { /* rollback below */ }
    if (candidateWasPublished) {
      if (actual) {
        const rollback = path.join(root, `.rollback-${process.pid}.tmp`);
        fs.writeFileSync(rollback, `${canonical({ revision: actual })}\n`, "utf8");
        fs.renameSync(rollback, pointerFor(gameDir));
      } else {
        fs.rmSync(pointerFor(gameDir), { force: true });
      }
    }
    throw error;
  }
};

export const commitEngineSession = (gameDir, {
  expectedRevision = null, gameId, engineScenario, gameDate, round, state,
  lastTurn = null, ownership = {}, monthlyTicks = 0, agentState, agentTurn,
}) => {
  const current = readEngineSession(gameDir);
  const actual = current?.manifest.revision ?? null;
  if (expectedRevision !== actual) {
    throw new EngineSessionError("STALE_SESSION", `stale engine session: expected ${expectedRevision ?? "none"}, current is ${actual ?? "none"}`);
  }
  if (state?.schemaVersion === worldV2.WORLD_STATE_V2_SCHEMA_VERSION) {
    throw new EngineSessionError("WRONG_WRITER", "WorldStateV2 must use the living-world writer");
  }
  if (current?.manifest.schema === ENGINE_SESSION_SCHEMA_V3) {
    throw new EngineSessionError("WRONG_WRITER", "living-world sessions cannot be mutated by the legacy engine writer");
  }

  const useV2 = agentState !== undefined || agentTurn !== undefined || current?.manifest.schema === ENGINE_SESSION_SCHEMA_V2;
  const effectiveAgentState = agentState ?? current?.agentState ?? { schemaVersion: "open-historia-agent-state/1", polities: [] };
  const effectiveAgentTurn = agentTurn ?? current?.agentTurn ?? null;
  const payloads = {
    state: jsonBytes(state), lastTurn: jsonBytes(lastTurn), ownership: jsonBytes(ownership),
    ...(useV2 ? { agentState: jsonBytes(effectiveAgentState), agentTurn: jsonBytes(effectiveAgentTurn) } : {}),
  };
  const content = {
    schema: useV2 ? ENGINE_SESSION_SCHEMA_V2 : ENGINE_SESSION_SCHEMA,
    gameId,
    engineScenario,
    parentRevision: actual,
    engineRevision: state.revision,
    gameDate,
    round,
    monthlyTicks,
    files: Object.fromEntries(Object.entries(payloads).map(([key, bytes]) => [key, descriptor(bytes)])),
  };
  const manifest = { ...content, revision: sha256(canonical(content)) };
  return publishSessionRevision(gameDir, { actual, gameId, manifest, payloads });
};

/**
 * Commit a living-world session. WorldStateV2 is the only canonical material
 * state; all other files are revision-bound explanations, plans or pending
 * intent and can never shadow territory, population, personnel or economy.
 */
export const commitLivingWorldSession = (gameDir, {
  expectedRevision = null,
  gameId,
  scenarioId,
  seedChecksum,
  state: stateInput,
  lastTransition,
  strategicState,
  agentTurn,
  playerIntent,
  playerDecisionIndex,
}) => {
  const current = readEngineSession(gameDir);
  const actual = current?.manifest.revision ?? null;
  if (expectedRevision !== actual) {
    throw new EngineSessionError("STALE_SESSION", `stale engine session: expected ${expectedRevision ?? "none"}, current is ${actual ?? "none"}`);
  }
  if (current && current.manifest.schema !== ENGINE_SESSION_SCHEMA_V3) {
    throw new EngineSessionError("INCOMPATIBLE_SESSION", "a legacy engine session must be migrated explicitly before living-world commits");
  }
  let state;
  try {
    state = worldV2.parseWorldStateV2(stateInput);
  } catch (error) {
    throw new EngineSessionError("INVALID_WORLD_STATE", `invalid WorldStateV2: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (state.scenarioId !== scenarioId) {
    throw new EngineSessionError("SCENARIO_MISMATCH", "WorldStateV2 scenario does not match the session scenario");
  }
  if (state.revisionLineage.seedRevision !== seedChecksum) {
    throw new EngineSessionError("SEED_MISMATCH", "WorldStateV2 seed lineage does not match the compiled scenario seed");
  }
  if (current && (current.manifest.gameId !== gameId
    || current.manifest.scenarioId !== scenarioId
    || current.manifest.seedChecksum !== seedChecksum)) {
    throw new EngineSessionError("SESSION_IDENTITY_MISMATCH", "living-world session identity cannot change after initialization");
  }
  const prior = current ?? {};
  const valueOrPrior = (value, key, fallback) => value !== undefined ? value : (prior[key] ?? fallback);
  const payloadValues = {
    state,
    lastTransition: valueOrPrior(lastTransition, "lastTurn", null),
    strategicState: valueOrPrior(strategicState, "agentState", { schemaVersion: "open-historia-strategic-memory/1", polities: [] }),
    agentTurn: valueOrPrior(agentTurn, "agentTurn", null),
    playerIntent: valueOrPrior(playerIntent, "playerIntent", null),
  };
  const payloads = Object.fromEntries(Object.entries(payloadValues).map(([key, value]) => [key, jsonBytes(value)]));
  const content = {
    schema: ENGINE_SESSION_SCHEMA_V3,
    gameId,
    scenarioId,
    seedChecksum,
    parentRevision: actual,
    worldRevision: state.revision,
    gameDate: state.month,
    turn: state.turn,
    playerDecisionIndex: Number.isSafeInteger(playerDecisionIndex) && playerDecisionIndex >= 0
      ? playerDecisionIndex
      : (current?.manifest.playerDecisionIndex ?? 0),
    files: Object.fromEntries(Object.entries(payloads).map(([key, bytes]) => [key, descriptor(bytes)])),
  };
  const manifest = { ...content, revision: sha256(canonical(content)) };
  return publishSessionRevision(gameDir, { actual, gameId, manifest, payloads });
};

export const backupLegacyEconomySave = (gameDir) => {
  const legacy = path.join(gameDir, "economy");
  if (!fs.existsSync(legacy) || fs.existsSync(pointerFor(gameDir))) return null;
  const backups = path.join(gameDir, "backups");
  fs.mkdirSync(backups, { recursive: true });
  let index = 1;
  let destination;
  do {
    destination = path.join(backups, `economy-engine-v0-${String(index).padStart(3, "0")}`);
    index += 1;
  } while (fs.existsSync(destination));
  fs.renameSync(legacy, destination);
  return destination;
};
