import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  compileHistoricalProjection,
  initState,
  resolveMonth,
} from '@open-historia/engine';

export const SCENARIO_ID = 'scenario:europe-1935-benchmark';
export const START_MONTH = '1935-01-01';
export const SUPPORTED_REGION_RANGE = Object.freeze({ minimum: 10, maximum: 25 });
export const REQUIRED_INERT_POLITIES = Object.freeze([
  { polityId: 'polity:danzig', displayName: 'Freie Stadt Danzig' },
  { polityId: 'polity:saar', displayName: 'Saargebiet' },
]);
export const REQUIRED_MODULES = Object.freeze([
  'armedForces',
  'budget',
  'campaign',
  'combat',
  'diplomacy',
  'finance',
  'intelligence',
  'politics',
  'projects',
  'shortages',
  'societyAndIdentity',
  'technology',
  'trade',
  'unrest',
]);

/**
 * These are not new runtime facts. They are deterministic audit expectations
 * extracted from the authored causal anchors named below. They remain
 * candidates until the owner approves the complete starting-state table.
 */
export const AUTHORED_COMMITMENT_EXPECTATIONS = Object.freeze([
  {
    commitmentId: 'commitment:czechoslovakia-france-security',
    polityIds: ['polity:czechoslovakia', 'polity:france'],
    sourceAnchorIds: ['anchor:czechoslovakia-security', 'anchor:france-containment'],
    matchingGoalId: 'goal:czechoslovakia-france',
  },
  {
    commitmentId: 'commitment:poland-france-security',
    polityIds: ['polity:poland', 'polity:france'],
    sourceAnchorIds: ['anchor:poland-balance', 'anchor:france-containment'],
    matchingGoalId: 'goal:poland-france',
  },
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_ROOT = path.join(ROOT, 'packages', 'data-packs', 'fixtures', 'europe-1935-benchmark');
const DEFAULT_OUTPUT = path.join(ROOT, 'runs', 'campaign-lab', 'europe-1935-starting-state-checkpoint');
const BASELINE_PATH = path.join(FIXTURE_ROOT, 'engine', 'first-month-baseline.json');

const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(canonical(value)).digest('hex')}`;
const sum = (rows, selector) => rows.reduce((total, row) => total + selector(row), 0);
const byId = (rows, selector) => new Map(rows.map((row) => [selector(row), row]));

export function buildFirstMonthBaseline(turnResult) {
  const polities = turnResult.ledger.polities.map((entry) => ({
    polityId: entry.polityId,
    populationOpening: entry.populationOpening,
    populationClosing: entry.populationClosing,
    production: entry.production.map(({ resource, total }) => ({ resource, total })),
    taxTotal: entry.taxTotal,
    food: {
      need: entry.food.need,
      consumed: entry.food.consumed,
      shortfall: entry.food.shortfall,
    },
    treasuryOpening: entry.treasuryOpening,
    treasuryClosing: entry.treasuryClosing,
    stockpileClosing: entry.stockMovements.map(({ resource, closing }) => ({ resource, amount: closing })),
  }));
  const aggregate = {
    schemaVersion: 'open-historia-first-month-baseline/1',
    scenarioId: turnResult.state.scenarioId,
    openingMonth: turnResult.ledger.month,
    closingMonth: turnResult.state.month,
    turn: turnResult.ledger.turn,
    polities,
  };
  return { ...aggregate, checksum: sha256(aggregate) };
}

export function compareFirstMonthBaseline(expected, actual) {
  return canonical(expected) === canonical(actual)
    ? { matches: true, expectedChecksum: expected.checksum, actualChecksum: actual.checksum }
    : { matches: false, expectedChecksum: expected.checksum, actualChecksum: actual.checksum };
}

function controlsForPolity(polityId, engineScenario, authoring) {
  const national = authoring.nationalControls.find((entry) => entry.polityId === polityId);
  const regions = engineScenario.regions.filter((entry) => entry.controllerId === polityId);
  const stockpile = Object.fromEntries((engineScenario.polities.find((entry) => entry.id === polityId)?.stockpile ?? [])
    .map((entry) => [entry.resource, entry.amount]));
  const computed = {
    population: sum(regions, (entry) => entry.population),
    workforce: sum(regions, (entry) => Math.floor((entry.population * entry.workforceRateBp) / 10000)),
    industrialCapacity: sum(regions, (entry) => entry.baseMonthlyCapacity),
    infrastructureCapacity: sum(regions, (entry) => entry.infrastructureBp),
    treasury: engineScenario.polities.find((entry) => entry.id === polityId)?.treasury ?? null,
    stockpile,
  };
  const fields = ['population', 'workforce', 'industrialCapacity', 'infrastructureCapacity', 'treasury', 'stockpile'];
  const matches = national !== undefined && fields.every((field) => canonical(national[field]) === canonical(computed[field]));
  return {
    authored: national ? Object.fromEntries(fields.map((field) => [field, national[field]])) : null,
    computed,
    matches,
    provenance: national ? {
      sourceRefs: national.sourceRefs,
      method: national.method,
      confidence: national.confidence,
      todo: national.todo,
    } : null,
  };
}

const issue = (code, severity, path, detail) => ({ code, severity, path, detail });

export function buildStartingStateAudit({ manifest, scenario, authoring, engineScenario, firstMonth }) {
  const issues = [];
  const polityLevels = scenario.fidelity?.polityLevels ?? {};
  const supportedIds = Object.entries(polityLevels).filter(([, level]) => level === 'Supported').map(([id]) => id).sort();
  const baselineIds = Object.entries(polityLevels).filter(([, level]) => level === 'Baseline').map(([id]) => id).sort();
  const enginePolityIds = new Set(engineScenario.polities.map((entry) => entry.id));
  const goalsByPolity = new Map(supportedIds.map((polityId) => [polityId,
    (engineScenario.campaign?.goals ?? []).filter((goal) => goal.polityId === polityId)]));
  const formations = engineScenario.military?.formations ?? [];
  const commanders = engineScenario.military?.commanders ?? [];
  const politicalPolities = byId(engineScenario.politics?.polities ?? [], (entry) => entry.polityId);

  if (manifest.id !== SCENARIO_ID || engineScenario.scenarioId !== SCENARIO_ID || authoring.scenarioId !== SCENARIO_ID) {
    issues.push(issue('scenario-id-drift', 'blocking', '/', `expected every projection to use ${SCENARIO_ID}`));
  }
  if (engineScenario.startMonth !== START_MONTH || scenario.game?.startDate !== START_MONTH) {
    issues.push(issue('start-month-drift', 'blocking', '/game/startDate', `expected ${START_MONTH}`));
  }
  if (Number.parseInt(String(manifest.contentVersion).split('.')[0], 10) < 1) {
    issues.push(issue('major-content-version-pending', 'blocking', '/manifest/contentVersion', `current ${manifest.contentVersion}; replacement package requires a new major`));
  }
  for (const moduleName of REQUIRED_MODULES) {
    if (engineScenario.modules?.[moduleName] !== true) {
      issues.push(issue('mature-module-disabled', 'blocking', `/engine/modules/${moduleName}`, `${moduleName} must be audited and enabled`));
    }
  }
  for (const inert of REQUIRED_INERT_POLITIES) {
    if (!enginePolityIds.has(inert.polityId)) {
      issues.push(issue('inert-polity-missing', 'blocking', `/polities/${inert.polityId}`, `${inert.displayName} needs an engine row without AI turns`));
    }
  }

  const polityRows = [...supportedIds, ...baselineIds].map((polityId) => {
    const fidelity = polityLevels[polityId];
    const regionCount = engineScenario.regions.filter((entry) => entry.controllerId === polityId).length;
    const polityGoals = goalsByPolity.get(polityId) ?? (engineScenario.campaign?.goals ?? []).filter((goal) => goal.polityId === polityId);
    const activeGoals = polityGoals.filter((goal) => goal.initiallyActive);
    const polityFormations = formations.filter((entry) => entry.polityId === polityId);
    const polityCommanders = commanders.filter((entry) => entry.polityId === polityId);
    const factions = (engineScenario.politics?.factions ?? []).filter((entry) => entry.polityId === polityId);
    const characters = (engineScenario.politics?.characters ?? []).filter((entry) => entry.polityId === polityId);
    const controls = controlsForPolity(polityId, engineScenario, authoring);

    if (!controls.matches) issues.push(issue('national-control-mismatch', 'blocking', `/polities/${polityId}/controls`, 'authored national controls do not equal engine aggregates'));
    if (fidelity === 'Supported' && (regionCount < SUPPORTED_REGION_RANGE.minimum || regionCount > SUPPORTED_REGION_RANGE.maximum)) {
      issues.push(issue('supported-region-count', 'blocking', `/polities/${polityId}/regions`, `${regionCount} regions; expected ${SUPPORTED_REGION_RANGE.minimum}–${SUPPORTED_REGION_RANGE.maximum}`));
    }
    if (fidelity === 'Supported' && (polityGoals.length < 2 || polityGoals.length > 4)) {
      issues.push(issue('ranked-goal-count', 'blocking', `/polities/${polityId}/goals`, `${polityGoals.length} goals; expected 2–4 ranked goals`));
    }
    if (fidelity === 'Supported' && polityFormations.length === 0) {
      issues.push(issue('formation-missing', 'blocking', `/polities/${polityId}/formations`, 'requires conservative theatre-level peacetime formations'));
    }
    if (fidelity === 'Supported' && polityCommanders.length === 0) {
      issues.push(issue('commander-missing', 'blocking', `/polities/${polityId}/commanders`, 'requires authored commanders for the starting formations'));
    }
    if (fidelity === 'Supported' && !politicalPolities.has(polityId)) {
      issues.push(issue('government-missing', 'blocking', `/polities/${polityId}/politics`, 'requires head of state, head of government and decision authority'));
    }
    if (fidelity === 'Supported' && (factions.length < 3 || factions.length > 6)) {
      issues.push(issue('faction-count', 'blocking', `/polities/${polityId}/factions`, `${factions.length} factions; expected 3–6`));
    }

    return {
      polityId,
      fidelity,
      regionCount,
      controls,
      goals: polityGoals.map((goal, index) => ({
        rank: index + 1,
        goalId: goal.goalId,
        kind: goal.kind,
        active: goal.initiallyActive,
      })),
      formations: polityFormations.length,
      commanders: polityCommanders.length,
      government: politicalPolities.has(polityId),
      factions: factions.length,
      characters: characters.length,
      finance: Boolean(engineScenario.statecraft?.finance?.some((entry) => entry.polityId === polityId)),
      capacities: Boolean(engineScenario.statecraft?.capacities?.some((entry) => entry.polityId === polityId)),
      activeGoalCount: activeGoals.length,
    };
  });

  for (const expectation of AUTHORED_COMMITMENT_EXPECTATIONS) {
    const missingAnchors = expectation.sourceAnchorIds.filter((anchorId) => !authoring.causalAnchors.some((entry) => entry.anchorId === anchorId));
    if (missingAnchors.length) {
      issues.push(issue('commitment-anchor-missing', 'blocking', `/commitments/${expectation.commitmentId}`, `missing anchors: ${missingAnchors.join(', ')}`));
      continue;
    }
    issues.push(issue('executable-agreement-missing', 'blocking', `/commitments/${expectation.commitmentId}`, 'authored security relationship has no executable starting agreement'));
    const goal = engineScenario.campaign?.goals?.find((entry) => entry.goalId === expectation.matchingGoalId);
    if (goal?.initiallyActive) {
      issues.push(issue('goal-conflicts-with-existing-commitment', 'blocking', `/engine/campaign/goals/${goal.goalId}`, 'an in-force relationship must be a commitment/constraint, not a goal to conclude it'));
    }
  }

  if (!engineScenario.statecraft) issues.push(issue('statecraft-missing', 'blocking', '/engine/statecraft', 'finance, capacities, projects and intelligence need authored seeds'));
  if (!engineScenario.politics) issues.push(issue('politics-missing', 'blocking', '/engine/politics', 'governments, leaders and factions need authored seeds'));
  if (!engineScenario.capabilities) issues.push(issue('capabilities-missing', 'blocking', '/engine/capabilities', 'technology catalog and starting capabilities need authored seeds'));
  if (!engineScenario.identity) issues.push(issue('identity-missing', 'blocking', '/engine/identity', 'society and identity inputs need authored seeds'));

  const sortedIssues = issues.toSorted((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  const body = {
    schemaVersion: 'open-historia-starting-state-audit/1',
    scenarioId: SCENARIO_ID,
    snapshotMonth: START_MONTH,
    generatedFrom: {
      manifestContentVersion: manifest.contentVersion,
      scenarioSchemaVersion: scenario.schemaVersion,
      engineSchemaVersion: engineScenario.schemaVersion,
    },
    gate: {
      status: sortedIssues.some((entry) => entry.severity === 'blocking') ? 'blocked' : 'ready-for-owner-review',
      blockingIssues: sortedIssues.filter((entry) => entry.severity === 'blocking').length,
      supportedPolities: supportedIds.length,
      baselinePolities: baselineIds.length,
    },
    modules: Object.fromEntries(REQUIRED_MODULES.map((moduleName) => [moduleName, engineScenario.modules?.[moduleName] === true])),
    inertPolities: REQUIRED_INERT_POLITIES.map((entry) => ({ ...entry, present: enginePolityIds.has(entry.polityId) })),
    commitments: AUTHORED_COMMITMENT_EXPECTATIONS,
    firstMonth,
    polities: polityRows,
    issues: sortedIssues,
  };
  return { ...body, checksum: sha256(body) };
}

export function renderOwnerTable(audit) {
  const lines = [
    '# Europe 1935 starting-state checkpoint',
    '',
    `Status: **${audit.gate.status}** (${audit.gate.blockingIssues} blocking issues)`,
    '',
    `Scenario: \`${audit.scenarioId}\`; snapshot: \`${audit.snapshotMonth}\`; audit checksum: \`${audit.checksum}\`.`,
    '',
    '| Polity | Fidelity | Regions | National totals | Goals | Formations | Commanders | Government | Factions | Finance |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...audit.polities.map((row) => `| ${row.polityId} | ${row.fidelity} | ${row.regionCount} | ${row.controls.matches ? 'exact' : 'MISMATCH'} | ${row.goals.length} | ${row.formations} | ${row.commanders} | ${row.government ? 'yes' : 'no'} | ${row.factions} | ${row.finance ? 'yes' : 'no'} |`),
    '',
    `First-month baseline: **${audit.firstMonth.matches ? 'exact' : 'MISMATCH'}** (\`${audit.firstMonth.actualChecksum}\`).`,
    '',
    '## Blocking issues',
    '',
    ...audit.issues.map((entry) => `- \`${entry.code}\` at \`${entry.path}\`: ${entry.detail}`),
    '',
    '> This is a production-derived diagnostic table, not an owner approval artifact. Approval follows only after every blocking row has sourced replacement data.',
    '',
  ];
  return lines.join('\n');
}

export function loadFixture(root = FIXTURE_ROOT) {
  const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  return {
    manifest: read('manifest.json'),
    scenario: read('scenario.json'),
    sources: read('sources.json'),
    authoring: read('authoring.json'),
    engineScenario: read('engine/scenario.json'),
    mapLink: read('engine/map-link.json'),
  };
}

export function calculateCheckpoint(fixture, expectedBaseline) {
  const projection = compileHistoricalProjection({
    bundle: { manifest: fixture.manifest, scenario: fixture.scenario, sources: fixture.sources },
    authoring: fixture.authoring,
    engineScenario: fixture.engineScenario,
    mapLink: fixture.mapLink,
  });
  const actualBaseline = buildFirstMonthBaseline(resolveMonth(initState(projection.scenario), { commands: [] }));
  const firstMonth = compareFirstMonthBaseline(expectedBaseline, actualBaseline);
  return { audit: buildStartingStateAudit({ ...fixture, firstMonth }), actualBaseline };
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : DEFAULT_OUTPUT;
  const fixture = loadFixture();
  const expectedBaseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const { audit } = calculateCheckpoint(fixture, expectedBaseline);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'starting-state-audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  fs.writeFileSync(path.join(output, 'starting-state-owner-table.md'), renderOwnerTable(audit));
  process.stdout.write(`${JSON.stringify({ output, gate: audit.gate, checksum: audit.checksum, firstMonth: audit.firstMonth }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
