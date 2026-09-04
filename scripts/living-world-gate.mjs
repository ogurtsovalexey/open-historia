#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EUROPE_FIXTURE = path.join(
  ROOT,
  "packages/data-packs/fixtures/europe-1935-benchmark/engine",
);

export const LIVING_WORLD_CONTRACTS = Object.freeze({
  baseline: Object.freeze({
    world: "open-historia-engine-econ/1",
    scenario: "open-historia-engine-scenario/1",
    interpreter: "InterpretedActionV1",
    strategicBrief: "open-historia-strategic-brief/4",
    strategicDecision: "open-historia-strategic-decision/3",
  }),
  target: Object.freeze({
    world: "open-historia-world/2",
    scenario: "open-historia-scenario/3",
    interpreter: "PlayerInputInterpretationV2",
    strategicBrief: "open-historia-strategic-brief/5",
    strategicDecision: "StrategicDecisionV4",
  }),
});

export const EUROPE_1935_BASELINE = Object.freeze({
  scenarioChecksum: "sha256:d913b01185f9ef3b96db9a206d248f023bf15c06a072ce7dfde16d2f5eb5dc61",
  startStateChecksum: "sha256:a62a01c0ee94f040871081c8213cb6d586d0213f973a377fde9146bbe67e3af4",
  firstMonthChecksum: "sha256:209d64e8a4e25fac211aa5343f276f4da1f3fa7fb4c19e5f1fad6cff9b09d9a1",
});

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export const requireGateFile = (file) => {
  if (!fs.existsSync(file)) throw new Error(`required fixture or build output is missing: ${path.relative(ROOT, file)}`);
  return file;
};

export function assertContractVersion(actual, expected, contract) {
  if (actual !== expected) throw new Error(`${contract} contract changed: expected ${expected}, received ${actual ?? "missing"}`);
}

const loadRuntime = async () => {
  const engineFile = requireGateFile(path.join(ROOT, "packages/engine/dist/index.js"));
  const agentFile = requireGateFile(path.join(ROOT, "packages/agent-runtime/dist/index.js"));
  const [engine, agent] = await Promise.all([
    import(pathToFileURL(engineFile).href),
    import(pathToFileURL(agentFile).href),
  ]);
  return { engine, agent };
};

/** Compare complete deterministic snapshots, rather than trusting a turn count. */
export function compareReplaySnapshots(expected, actual, canonicalOf, sha256OfString) {
  const length = Math.max(expected.length, actual.length);
  const mismatches = [];
  for (let index = 0; index < length; index += 1) {
    const expectedValue = expected[index];
    const actualValue = actual[index];
    const expectedChecksum = expectedValue === undefined
      ? "missing"
      : sha256OfString(canonicalOf(expectedValue));
    const actualChecksum = actualValue === undefined
      ? "missing"
      : sha256OfString(canonicalOf(actualValue));
    if (expectedChecksum !== actualChecksum) {
      mismatches.push({ turn: index, expectedChecksum, actualChecksum });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function assertBaselineContracts(engine, agent, scenario, initialState) {
  assertContractVersion(scenario.schemaVersion, LIVING_WORLD_CONTRACTS.baseline.scenario, "baseline scenario");
  assertContractVersion(initialState.schemaVersion, LIVING_WORLD_CONTRACTS.baseline.world, "baseline world");
  agent.interpretedActionSchema.parse({
    actionId: "baseline-contract",
    summary: "No state mutation",
    command: null,
    disposition: "unsupported",
  });
  agent.strategicDecisionV3Schema.parse({
    polityId: "polity:baseline",
    revision: initialState.revision,
    objective: { domain: "campaign", summary: "Hold baseline", horizon: "short" },
    selectedChoices: [],
    triggerCoverage: [],
    rejectedChoices: [],
    durablePlan: { objective: "Hold baseline", futureSteps: [], commitments: [] },
    contingency: "Reassess after a material state change.",
    hold: { reason: "no-legal-action", detail: "Contract probe only.", revisitAfterMonths: 1 },
  });
  if (typeof engine.runCampaign !== "function" || typeof engine.stateChecksum !== "function") {
    throw new Error("engine checksum/replay helpers are missing");
  }
}

const TARGET_FILES = Object.freeze([
  ["world", "packages/engine/src/world/schema.ts", LIVING_WORLD_CONTRACTS.target.world],
  ["scenario", "packages/data-packs/src/v3/schemas.ts", LIVING_WORLD_CONTRACTS.target.scenario],
  ["interpreter", "packages/agent-runtime/src/playerInputV2.ts", "PlayerInputInterpretation"],
  ["strategic", "packages/agent-runtime/src/strategicV5.ts", LIVING_WORLD_CONTRACTS.target.strategicBrief],
  ["strategic decision", "packages/agent-runtime/src/strategicV5.ts", LIVING_WORLD_CONTRACTS.target.strategicDecision],
]);

export function checkTargetContracts(rootDirectory = ROOT) {
  const missing = [];
  for (const [contract, relativeFile, marker] of TARGET_FILES) {
    const file = path.join(rootDirectory, relativeFile);
    if (!fs.existsSync(file)) {
      missing.push(`${contract}: missing ${relativeFile}`);
      continue;
    }
    if (!fs.readFileSync(file, "utf8").includes(marker)) {
      missing.push(`${contract}: ${relativeFile} lacks ${marker}`);
    }
  }
  return { ok: missing.length === 0, missing };
}

export async function runBaselineGate() {
  const { engine, agent } = await loadRuntime();
  const scenarioFile = requireGateFile(path.join(EUROPE_FIXTURE, "scenario.json"));
  const firstMonthFile = requireGateFile(path.join(EUROPE_FIXTURE, "first-month-baseline.json"));
  const scenarioRaw = readJson(scenarioFile);
  const scenario = engine.parseScenario(scenarioRaw);
  const initialState = engine.initState(scenario);
  assertBaselineContracts(engine, agent, scenario, initialState);

  const scenarioChecksum = engine.sha256OfString(engine.canonicalOf(scenarioRaw));
  const startStateChecksum = engine.stateChecksum(initialState);
  const firstMonth = readJson(firstMonthFile);
  const { checksum: recordedFirstMonthChecksum, ...firstMonthBody } = firstMonth;
  const firstMonthChecksum = engine.sha256OfString(engine.canonicalOf(firstMonthBody));
  const checksums = { scenarioChecksum, startStateChecksum, firstMonthChecksum };
  for (const [name, expected] of Object.entries(EUROPE_1935_BASELINE)) {
    if (checksums[name] !== expected) throw new Error(`${name} drift: expected ${expected}, received ${checksums[name]}`);
  }
  if (recordedFirstMonthChecksum !== firstMonthChecksum) {
    throw new Error(`first-month fixture self-check failed: expected ${recordedFirstMonthChecksum}, received ${firstMonthChecksum}`);
  }

  const run = () => engine.runCampaign({
    scenarioRaw,
    turns: 3,
    commandsFor: engine.directoryCommandsProvider(undefined),
  });
  const left = run();
  const right = run();
  const replay = compareReplaySnapshots(
    [left.initialState, ...left.turns.map((turn) => turn.result.state)],
    [right.initialState, ...right.turns.map((turn) => turn.result.state)],
    engine.canonicalOf,
    engine.sha256OfString,
  );
  if (!replay.ok) throw new Error(`deterministic replay mismatch: ${JSON.stringify(replay.mismatches)}`);

  return {
    ok: true,
    mode: "baseline",
    contracts: LIVING_WORLD_CONTRACTS.baseline,
    checksums,
    replay: { turns: left.turns.length, snapshots: left.turns.length + 1 },
    target: { required: false, ...checkTargetContracts() },
  };
}

export async function runTargetGate() {
  const baseline = await runBaselineGate();
  const target = checkTargetContracts();
  if (!target.ok) throw new Error(`living-world target contracts are incomplete:\n- ${target.missing.join("\n- ")}`);
  return { ...baseline, mode: "target", target: { required: true, ...target } };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const target = process.argv.slice(2).includes("--target");
  try {
    const result = target ? await runTargetGate() : await runBaselineGate();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`living-world gate failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
