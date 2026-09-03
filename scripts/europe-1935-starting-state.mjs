import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  compileHistoricalProjection,
  currentPoliticalStrategy,
  initState,
  parseScenario,
  populationWeightedInfrastructureBp,
  resolveMonth,
  startingStateValueChecksum,
} from '@open-historia/engine';

export const SCENARIO_ID = 'scenario:europe-1935-benchmark';
export const START_MONTH = '1935-01-01';
export const SUPPORTED_REGION_RANGE = Object.freeze({ minimum: 10, maximum: 25 });
export const REQUIRED_INERT_POLITIES = Object.freeze([
  { polityId: 'polity:danzig', displayName: 'Freie Stadt Danzig' },
  { polityId: 'polity:saar', displayName: 'Saargebiet' },
]);
export const POLAND_1931_CENSUS = Object.freeze({
  sourceId: 'source:europe-1935-benchmark:poland-census-1931',
  sourceContentHash: 'sha256:877259f5a9218ea54225902a6caf4eacd82d70ba418eb6262b06b8ff7b68986c',
  censusDate: '1931-12-09',
  nationalPopulationIncludingBarrackedMilitary: 32_107_252,
  barrackedMilitaryExcludedFromVoivodeshipRows: 191_473,
  targetPopulation: 34_000_000,
  rows: Object.freeze([
    { relationId: 2_696_109, nativeName: 'Województwo wileńskie', sourcePopulation: 1_275_939 },
    { relationId: 2_698_169, nativeName: 'Województwo wołyńskie', sourcePopulation: 2_085_574 },
    { relationId: 2_698_170, nativeName: 'Województwo poleskie', sourcePopulation: 1_131_939 },
    { relationId: 2_741_463, nativeName: 'Województwo lubelskie', sourcePopulation: 2_464_936 },
    { relationId: 2_741_466, nativeName: 'Województwo nowogródzkie', sourcePopulation: 1_057_147 },
    { relationId: 2_741_468, nativeName: 'Województwo białostockie', sourcePopulation: 1_643_844 },
    {
      relationId: 2_741_469,
      nativeName: 'Województwo warszawskie',
      sourcePopulation: 3_701_126,
      sourceComponents: Object.freeze([
        { nativeName: 'Województwo warszawskie', population: 2_529_228 },
        { nativeName: 'M. st. Warszawa', population: 1_171_898 },
      ]),
    },
    { relationId: 2_741_470, nativeName: 'Województwo kieleckie', sourcePopulation: 2_935_697 },
    { relationId: 2_741_471, nativeName: 'Województwo śląskie', sourcePopulation: 1_295_027 },
    { relationId: 2_741_475, nativeName: 'Województwo łódzkie', sourcePopulation: 2_632_010 },
    { relationId: 2_741_476, nativeName: 'Województwo poznańskie', sourcePopulation: 2_106_500 },
    { relationId: 2_741_477, nativeName: 'Województwo pomorskie', sourcePopulation: 1_080_138 },
    { relationId: 2_927_190, nativeName: 'Województwo krakowskie', sourcePopulation: 2_297_802 },
    { relationId: 2_927_191, nativeName: 'Województwo lwowskie', sourcePopulation: 3_127_409 },
    { relationId: 2_929_589, nativeName: 'Województwo tarnopolskie', sourcePopulation: 1_600_406 },
    { relationId: 2_930_186, nativeName: 'Województwo stanisławowskie', sourcePopulation: 1_480_285 },
  ]),
});
export const POLAND_1935_REGIONAL_ECONOMY = Object.freeze({
  sourceRefs: Object.freeze([
    POLAND_1931_CENSUS.sourceId,
    'source:europe-1935-benchmark:world-production',
  ]),
  populationQuantum: 5,
  capacityQuantum: 100,
  maxCapacityReconciliationUnits: 15,
  processingRelationId: 2_741_475,
  coalRelationIds: Object.freeze([2_741_470, 2_741_471, 2_927_190]),
  externalSupplyLinks: Object.freeze({
    'region:benchmark-1:CS': 2_927_190,
    'region:benchmark-1:DE': 2_741_476,
    'region:benchmark-1:SU': 2_696_109,
  }),
});
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

/** Historical rows whose complete authored object must have exact-value
 * provenance before the owner checkpoint can be reviewed. Economy and region
 * totals use the stronger dedicated national/regional control contract. */
export const STARTING_STATE_PROVENANCE_COLLECTIONS = Object.freeze([
  '/diplomacy/relations',
  '/diplomacy/tradeRoutes',
  '/diplomacy/startingAgreements',
  '/military/polities',
  '/military/commanders',
  '/military/formations',
  '/military/supplyLinks',
  '/campaign/goals',
  '/campaign/crisisTemplates',
  '/campaign/legacyBaselines',
  '/statecraft/finance',
  '/statecraft/capacities',
  '/statecraft/projectTemplates',
  '/statecraft/intelligenceFacts',
  '/statecraft/knowledgeSeeds',
  '/politics/polities',
  '/politics/factions',
  '/politics/characters',
  '/capabilities/catalog',
  '/capabilities/starting',
  '/identity/cultures',
  '/identity/religions',
  '/identity/regions',
  '/identity/polities',
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
    agreementType: 'defensive-alliance',
    sourceAnchorIds: ['anchor:czechoslovakia-security', 'anchor:france-containment'],
  },
  {
    commitmentId: 'commitment:poland-france-security',
    polityIds: ['polity:poland', 'polity:france'],
    agreementType: 'defensive-alliance',
    sourceAnchorIds: ['anchor:poland-balance', 'anchor:france-containment'],
  },
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_ROOT = path.join(ROOT, 'packages', 'data-packs', 'fixtures', 'europe-1935-benchmark');
const DEFAULT_OUTPUT = path.join(ROOT, 'runs', 'campaign-lab', 'europe-1935-starting-state-checkpoint');
const BASELINE_PATH = path.join(FIXTURE_ROOT, 'engine', 'first-month-baseline.json');
const POLAND_ADJACENCY_CONTROL_PATH = path.join(FIXTURE_ROOT, 'geography', 'poland-land-adjacency.json');
const POLAND_POLITICS_CANDIDATE_PATH = path.join(FIXTURE_ROOT, 'starting-state', 'poland-politics.json');

const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(canonical(value)).digest('hex')}`;
const sum = (rows, selector) => rows.reduce((total, row) => total + selector(row), 0);
const byId = (rows, selector) => new Map(rows.map((row) => [selector(row), row]));

/** Largest-remainder apportionment over checked non-negative integers.
 * Output is sorted by id, so input order can never affect authored values. */
export function apportionIntegerTotal(rows, targetTotal) {
  if (!Number.isSafeInteger(targetTotal) || targetTotal < 0) {
    throw new RangeError(`target total must be a non-negative safe integer: ${targetTotal}`);
  }
  const ordered = rows.map((row) => ({ id: row.id, weight: row.weight }));
  if (ordered.length === 0) throw new RangeError('apportionment requires at least one row');
  const ids = new Set();
  let weightTotal = 0;
  for (const row of ordered) {
    if (typeof row.id !== 'string' || row.id.length === 0) throw new TypeError('apportionment id must be non-empty');
    if (ids.has(row.id)) throw new Error(`duplicate apportionment id: ${row.id}`);
    ids.add(row.id);
    if (!Number.isSafeInteger(row.weight) || row.weight <= 0) {
      throw new RangeError(`apportionment weight for ${row.id} must be a positive safe integer: ${row.weight}`);
    }
    weightTotal += row.weight;
    if (!Number.isSafeInteger(weightTotal)) throw new RangeError('apportionment weight total is not a safe integer');
  }
  const apportioned = ordered.map((row) => {
    const numerator = targetTotal * row.weight;
    if (!Number.isSafeInteger(numerator)) throw new RangeError(`apportionment product for ${row.id} is not a safe integer`);
    const amount = Math.floor(numerator / weightTotal);
    return { ...row, amount, remainder: numerator - amount * weightTotal };
  });
  let remaining = targetTotal - sum(apportioned, (row) => row.amount);
  for (const row of apportioned.toSorted((left, right) => right.remainder - left.remainder
    || left.id.localeCompare(right.id))) {
    if (remaining === 0) break;
    row.amount += 1;
    remaining -= 1;
  }
  if (remaining !== 0) throw new Error(`apportionment left ${remaining} units unresolved`);
  return apportioned.toSorted((left, right) => left.id.localeCompare(right.id))
    .map(({ id, weight, amount }) => ({ id, weight, amount }));
}

export function buildPolandPopulationAllocation() {
  const sourcePopulationTotal = sum(POLAND_1931_CENSUS.rows, (row) => row.sourcePopulation);
  if (sourcePopulationTotal + POLAND_1931_CENSUS.barrackedMilitaryExcludedFromVoivodeshipRows
    !== POLAND_1931_CENSUS.nationalPopulationIncludingBarrackedMilitary) {
    throw new Error('Poland census voivodeship rows do not reconcile to the published national total');
  }
  const allocationById = new Map(apportionIntegerTotal(POLAND_1931_CENSUS.rows.map((row) => ({
    id: `region:ohm-1935:${row.relationId}`,
    weight: row.sourcePopulation,
  })), POLAND_1931_CENSUS.targetPopulation).map((row) => [row.id, row]));
  const rows = POLAND_1931_CENSUS.rows.map((row) => {
    const regionId = `region:ohm-1935:${row.relationId}`;
    return {
      regionId,
      relationId: row.relationId,
      nativeName: row.nativeName,
      sourcePopulation: row.sourcePopulation,
      ...(row.sourceComponents ? { sourceComponents: row.sourceComponents } : {}),
      population: allocationById.get(regionId).amount,
    };
  }).toSorted((left, right) => left.regionId.localeCompare(right.regionId));
  const body = {
    schemaVersion: 'open-historia-regional-population-allocation/1',
    polityId: 'polity:poland',
    censusDate: POLAND_1931_CENSUS.censusDate,
    scenarioSnapshotDate: START_MONTH,
    sourceRefs: [POLAND_1931_CENSUS.sourceId],
    sourceContentHash: POLAND_1931_CENSUS.sourceContentHash,
    sourcePopulationTotal,
    publishedNationalPopulation: POLAND_1931_CENSUS.nationalPopulationIncludingBarrackedMilitary,
    barrackedMilitaryExcludedFromRows: POLAND_1931_CENSUS.barrackedMilitaryExcludedFromVoivodeshipRows,
    targetPopulation: POLAND_1931_CENSUS.targetPopulation,
    method: 'Combine the separate M. st. Warszawa census row with the containing OHM Warszawskie polygon, then apply largest-remainder proportional scaling from the 1931 resident civilian rows to the approved 1935 benchmark total.',
    confidence: 'medium',
    todo: 'Owner-review the 1931-to-1935 normalization and replace proportional growth with sourced intercensal regional estimates where available.',
    rows,
  };
  return { ...body, checksum: sha256(body) };
}

const taxForOutput = (output, accountingValue, taxRateBp) =>
  Math.floor((output * accountingValue * taxRateBp) / 10000);

function reconcileCapacityUnits(rows, targetUnits, targetTax, outputPerUnit, accountingValue, taxRateBp) {
  let states = new Map([['0:0', { cost: 0, units: [] }]]);
  for (const row of rows) {
    const next = new Map();
    const minimum = Math.max(1, row.amount - POLAND_1935_REGIONAL_ECONOMY.maxCapacityReconciliationUnits);
    const maximum = row.amount + POLAND_1935_REGIONAL_ECONOMY.maxCapacityReconciliationUnits;
    for (const [key, state] of states) {
      const [usedUnits, usedTax] = key.split(':').map(Number);
      for (let units = minimum; units <= maximum; units += 1) {
        const totalUnits = usedUnits + units;
        const totalTax = usedTax + taxForOutput(units * outputPerUnit, accountingValue, taxRateBp);
        if (totalUnits > targetUnits || totalTax > targetTax) continue;
        const candidate = { cost: state.cost + Math.abs(units - row.amount), units: [...state.units, units] };
        const candidateKey = `${totalUnits}:${totalTax}`;
        const current = next.get(candidateKey);
        if (!current || candidate.cost < current.cost) next.set(candidateKey, candidate);
      }
    }
    states = next;
  }
  const result = states.get(`${targetUnits}:${targetTax}`);
  if (!result) throw new Error(`no bounded capacity allocation preserves ${targetUnits} units and tax ${targetTax}`);
  return rows.map((row, index) => ({ ...row, amount: result.units[index] }));
}

function buildPolandCandidateScenario(engineScenario) {
  const scenario = structuredClone(engineScenario);
  const macroRegionId = 'region:benchmark-1:PL';
  const macro = scenario.regions.find((entry) => entry.regionId === macroRegionId);
  if (!macro) throw new Error(`missing Poland macro-region ${macroRegionId}`);
  if (macro.activities?.length !== 3) throw new Error('Poland macro-region must retain the approved 50/30/20 activity control');

  const populationRows = apportionIntegerTotal(POLAND_1931_CENSUS.rows.map((row) => ({
    id: `region:ohm-1935:${row.relationId}`,
    weight: row.sourcePopulation,
  })), POLAND_1931_CENSUS.targetPopulation / POLAND_1935_REGIONAL_ECONOMY.populationQuantum)
    .map((row) => ({ ...row, amount: row.amount * POLAND_1935_REGIONAL_ECONOMY.populationQuantum }));
  const populationById = new Map(populationRows.map((row) => [row.id, row]));

  // The smallest five-person-quantum transfer which preserves the macro
  // region's month-one demographic rounding. Ties are resolved by region id.
  populationById.get('region:ohm-1935:2696109').amount -= 35;
  populationById.get('region:ohm-1935:2741469').amount += 35;

  const processingIds = new Set([POLAND_1935_REGIONAL_ECONOMY.processingRelationId]);
  const coalIds = new Set(POLAND_1935_REGIONAL_ECONOMY.coalRelationIds);
  const activityRows = macro.activities.map((allocated) => {
    const family = allocated.activity.kind === 'processing' ? 'goods' : allocated.activity.resource;
    const relationIds = POLAND_1931_CENSUS.rows.map((row) => row.relationId).filter((relationId) =>
      family === 'goods' ? processingIds.has(relationId) : family === 'coal' ? coalIds.has(relationId)
        : !processingIds.has(relationId) && !coalIds.has(relationId));
    const targetCapacity = Math.floor((macro.baseMonthlyCapacity * allocated.allocationBp) / 10000);
    const targetUnits = targetCapacity / POLAND_1935_REGIONAL_ECONOMY.capacityQuantum;
    const base = apportionIntegerTotal(relationIds.map((relationId) => ({
      id: `region:ohm-1935:${relationId}`,
      weight: populationById.get(`region:ohm-1935:${relationId}`).amount,
    })), targetUnits);
    const outputPerUnit = Math.floor((POLAND_1935_REGIONAL_ECONOMY.capacityQuantum * macro.infrastructureBp) / 10000);
    const resource = family === 'goods' ? 'goods' : family;
    const params = scenario.economy.resourceParams.find((entry) => entry.resource === resource);
    const targetOutput = Math.floor((targetCapacity * macro.infrastructureBp) / 10000);
    const targetTax = taxForOutput(targetOutput, params.accountingValue, params.taxRateBp);
    const reconciled = reconcileCapacityUnits(base, targetUnits, targetTax, outputPerUnit,
      params.accountingValue, params.taxRateBp);
    return { family, allocated, targetCapacity, rows: reconciled };
  });
  const capacityById = new Map(activityRows.flatMap((group) => group.rows.map((row) => [row.id, {
    capacity: row.amount * POLAND_1935_REGIONAL_ECONOMY.capacityQuantum,
    activity: group.allocated.activity,
  }])));
  const censusByRelation = new Map(POLAND_1931_CENSUS.rows.map((row) => [row.relationId, row]));
  const regions = [...populationById.values()].map((populationRow) => {
    const relationId = Number(populationRow.id.split(':').at(-1));
    const census = censusByRelation.get(relationId);
    const economic = capacityById.get(populationRow.id);
    return {
      regionId: populationRow.id,
      controllerId: 'polity:poland',
      displayName: { en: census.nativeName, ru: census.nativeName },
      activity: economic.activity,
      population: populationRow.amount,
      annualBirthRateBp: macro.annualBirthRateBp,
      annualDeathRateBp: macro.annualDeathRateBp,
      workforceRateBp: macro.workforceRateBp,
      infrastructureBp: macro.infrastructureBp,
      damageBp: macro.damageBp,
      baseMonthlyCapacity: economic.capacity,
      outputPerWorker: macro.outputPerWorker,
      capacityCeiling: Math.floor((economic.capacity * 3) / 2),
    };
  }).toSorted((left, right) => left.regionId.localeCompare(right.regionId));
  scenario.regions = scenario.regions.flatMap((entry) => entry.regionId === macroRegionId ? regions : [entry]);
  scenario.military.supplyLinks = scenario.military.supplyLinks.map((link) => {
    if (!link.regions.includes(macroRegionId)) return link;
    const externalRegionId = link.regions.find((regionId) => regionId !== macroRegionId);
    const relationId = POLAND_1935_REGIONAL_ECONOMY.externalSupplyLinks[externalRegionId];
    if (!relationId) throw new Error(`unreviewed external Poland supply link: ${externalRegionId}`);
    return { ...link, regions: [externalRegionId, `region:ohm-1935:${relationId}`].sort() };
  });
  return { scenario, regions, activityRows };
}

export function buildPolandRegionalProjectionCandidate(engineScenario) {
  const { scenario, regions, activityRows } = buildPolandCandidateScenario(engineScenario);
  const firstMonth = buildFirstMonthBaseline(resolveMonth(initState(scenario), { commands: [] }));
  const adjacency = JSON.parse(fs.readFileSync(POLAND_ADJACENCY_CONTROL_PATH, 'utf8'));
  const relationIds = new Set(regions.map((entry) => Number(entry.regionId.split(':').at(-1))));
  if (adjacency.sourceNormalizedChecksum !== 'sha256:9ebf6e3f1c6cca66bdca58b110f78d3c2115c0c3c398820c3bea29da37078cfe'
    || adjacency.edges.length !== 30 || adjacency.edges.some((edge) => edge.relationIds.some((relationId) => !relationIds.has(relationId)))) {
    throw new Error('Poland economy candidate does not match the pinned land-adjacency control');
  }
  const body = {
    schemaVersion: 'open-historia-regional-projection-candidate/1',
    polityId: 'polity:poland',
    status: 'economy-ready-geography-pending-owner-review',
    sourceRefs: POLAND_1935_REGIONAL_ECONOMY.sourceRefs,
    method: 'Population is census-weighted in five-person quanta; the smallest deterministic transfer preserves month-one demographic rounding. Capacity preserves the approved national 50/30/20 activity totals, uses one Łódzkie processing region as required by Canon 04, and applies bounded tax-rounding reconciliation after population-weighted allocation.',
    confidence: 'low',
    todo: 'Owner-review the geography overlay and replace national-scale specialization estimates with table-level regional production evidence before publishing the 16-region runtime projection.',
    nationalControls: {
      population: sum(regions, (entry) => entry.population),
      workforce: sum(regions, (entry) => Math.floor((entry.population * entry.workforceRateBp) / 10000)),
      industrialCapacity: sum(regions, (entry) => entry.baseMonthlyCapacity),
      infrastructureIndexBp: populationWeightedInfrastructureBp(regions),
    },
    activityCapacity: Object.fromEntries(activityRows.map((group) => [group.family, group.targetCapacity])),
    processingRegionCount: regions.filter((entry) => entry.activity.kind === 'processing').length,
    landAdjacency: {
      status: adjacency.status,
      method: adjacency.method,
      edgeCount: adjacency.edges.length,
      checksum: adjacency.adjacencyChecksum,
    },
    externalSupplyLinks: Object.entries(POLAND_1935_REGIONAL_ECONOMY.externalSupplyLinks).map(([externalRegionId, relationId]) => ({
      externalRegionId, candidateRegionId: `region:ohm-1935:${relationId}`,
    })),
    firstMonth,
    rows: regions,
  };
  return { ...body, checksum: sha256(body) };
}

export function buildPoliticsCandidateAudit(engineScenario, sources, candidatePath = POLAND_POLITICS_CANDIDATE_PATH) {
  const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
  if (candidate.schemaVersion !== 'open-historia-politics-candidate/1'
    || candidate.polityId !== 'polity:poland' || candidate.effectiveAt !== START_MONTH
    || candidate.provenance?.basis !== 'authored-estimate' || candidate.provenance?.confidence !== 'low') {
    throw new Error('invalid Poland politics candidate header or provenance');
  }
  const sourceIds = new Set(sources.map((entry) => entry.id));
  const unknownSources = candidate.sourceRefs.filter((sourceId) => !sourceIds.has(sourceId));
  if (unknownSources.length) throw new Error(`Poland politics candidate has unknown sources: ${unknownSources.join(', ')}`);
  const raw = structuredClone(engineScenario);
  raw.politics = candidate.politics;
  parseScenario(raw);
  const strategy = currentPoliticalStrategy(candidate.politics, candidate.polityId);
  const factions = candidate.politics.factions.filter((entry) => entry.polityId === candidate.polityId);
  const characters = candidate.politics.characters.filter((entry) => entry.polityId === candidate.polityId);
  const unknownCardSources = characters.flatMap((entry) => entry.leaderCard?.sourceRefs ?? [])
    .filter((sourceId) => !sourceIds.has(sourceId));
  if (unknownCardSources.length) throw new Error(`Poland politics fact cards have unknown sources: ${unknownCardSources.join(', ')}`);
  if (factions.length < 3 || factions.length > 6 || characters.some((entry) => !entry.leaderCard?.historical)) {
    throw new Error('Poland politics candidate requires 3-6 factions and fact cards for every historical character');
  }
  const body = {
    schemaVersion: candidate.schemaVersion,
    status: candidate.status,
    polityId: candidate.polityId,
    effectiveAt: candidate.effectiveAt,
    sourceRefs: candidate.sourceRefs,
    provenance: candidate.provenance,
    headOfState: { characterId: strategy.headOfState.characterId, name: strategy.headOfState.displayName.en },
    headOfGovernment: { characterId: strategy.headOfGovernment.characterId, name: strategy.headOfGovernment.displayName.en },
    decisionAuthority: { characterId: strategy.decisionAuthority.characterId, name: strategy.decisionAuthority.displayName.en },
    rulingFaction: { factionId: strategy.rulingFaction.factionId, name: strategy.rulingFaction.displayName.en },
    politicalIdentity: strategy.identity,
    currentConstraints: strategy.currentConstraints,
    factionCount: factions.length,
    characterCount: characters.length,
    politics: candidate.politics,
  };
  return { ...body, checksum: sha256(body) };
}

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
    infrastructureIndexBp: populationWeightedInfrastructureBp(regions),
    treasury: engineScenario.polities.find((entry) => entry.id === polityId)?.treasury ?? null,
    stockpile,
  };
  const fields = ['population', 'workforce', 'industrialCapacity', 'infrastructureIndexBp', 'treasury', 'stockpile'];
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

function valueAtPath(root, pointer) {
  let value = root;
  for (const segment of pointer.slice(1).split('/')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}

export function auditStartingStateProvenance(engineScenario, authoring) {
  const claims = new Map((authoring.startingStateProvenance ?? []).map((entry) => [entry.scenarioPath, entry]));
  const rows = STARTING_STATE_PROVENANCE_COLLECTIONS.flatMap((collectionPath) => {
    const collection = valueAtPath(engineScenario, collectionPath);
    if (!Array.isArray(collection)) return [];
    return collection.map((value, index) => {
      const scenarioPath = `${collectionPath}/${index}`;
      const expectedChecksum = startingStateValueChecksum(value);
      const claim = claims.get(scenarioPath);
      return {
        scenarioPath,
        expectedChecksum,
        claimId: claim?.claimId ?? null,
        status: !claim ? 'missing' : claim.valueChecksum === expectedChecksum ? 'covered' : 'checksum-mismatch',
      };
    });
  });
  return {
    totalRows: rows.length,
    coveredRows: rows.filter((entry) => entry.status === 'covered').length,
    missingRows: rows.filter((entry) => entry.status === 'missing').length,
    checksumMismatches: rows.filter((entry) => entry.status === 'checksum-mismatch').length,
    rows,
  };
}

export function buildStartingStateAudit({ manifest, scenario, sources, authoring, engineScenario, firstMonth }) {
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
  const provenance = auditStartingStateProvenance(engineScenario, authoring);
  const polandPopulation = buildPolandPopulationAllocation();
  const polandProjection = buildPolandRegionalProjectionCandidate(engineScenario);
  const polandProjectionFirstMonth = {
    matches: polandProjection.firstMonth.checksum === firstMonth.expectedChecksum,
    expectedChecksum: firstMonth.expectedChecksum,
    actualChecksum: polandProjection.firstMonth.checksum,
  };
  const politicsCandidates = [buildPoliticsCandidateAudit(engineScenario, sources)];

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
    const politicalPolity = politicalPolities.get(polityId);
    const authority = politicalPolity?.strategyAuthority;
    const strategyReady = Boolean(authority
      && characters.some((entry) => entry.characterId === authority.headOfStateCharacterId && entry.leaderCard)
      && characters.some((entry) => entry.characterId === authority.headOfGovernmentCharacterId && entry.leaderCard)
      && characters.some((entry) => entry.characterId === authority.decisionAuthorityCharacterId && entry.leaderCard)
      && factions.some((entry) => entry.factionId === authority.rulingFactionId && entry.politicalIdentity));
    const agreements = (engineScenario.diplomacy?.startingAgreements ?? []).filter((entry) =>
      entry.terms.fromPolityId === polityId || entry.terms.toPolityId === polityId);
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
    } else if (fidelity === 'Supported' && !strategyReady) {
      issues.push(issue('strategic-authority-incomplete', 'blocking', `/polities/${polityId}/politics/strategyAuthority`, 'requires three leader cards, a ruling-faction political identity and current constraints'));
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
      government: strategyReady,
      factions: factions.length,
      characters: characters.length,
      agreements: agreements.length,
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
    const agreement = (engineScenario.diplomacy?.startingAgreements ?? []).find((entry) => entry.terms.agreementType === expectation.agreementType
      && expectation.polityIds.every((polityId) => [entry.terms.fromPolityId, entry.terms.toPolityId].includes(polityId)));
    if (!agreement) {
      issues.push(issue('executable-agreement-missing', 'blocking', `/commitments/${expectation.commitmentId}`, 'authored security relationship has no executable starting agreement'));
    }
    const conflictingGoal = engineScenario.campaign?.goals?.find((entry) => entry.initiallyActive
      && entry.kind === 'secure-alliance'
      && expectation.polityIds.includes(entry.polityId)
      && expectation.polityIds.includes(entry.targetPolityId));
    if (conflictingGoal) {
      issues.push(issue('goal-conflicts-with-existing-commitment', 'blocking', `/engine/campaign/goals/${conflictingGoal.goalId}`, 'an in-force relationship must be a commitment/constraint, not a goal to conclude it'));
    }
  }

  if (!engineScenario.statecraft) issues.push(issue('statecraft-missing', 'blocking', '/engine/statecraft', 'finance, capacities, projects and intelligence need authored seeds'));
  if (!engineScenario.politics) issues.push(issue('politics-missing', 'blocking', '/engine/politics', 'governments, leaders and factions need authored seeds'));
  if (!engineScenario.capabilities) issues.push(issue('capabilities-missing', 'blocking', '/engine/capabilities', 'technology catalog and starting capabilities need authored seeds'));
  if (!engineScenario.identity) issues.push(issue('identity-missing', 'blocking', '/engine/identity', 'society and identity inputs need authored seeds'));
  for (const row of provenance.rows) {
    if (row.status === 'missing') {
      issues.push(issue('starting-state-provenance-missing', 'blocking', `/engine${row.scenarioPath}`, 'exact authored row has no source-derived or authored-estimate provenance claim'));
    } else if (row.status === 'checksum-mismatch') {
      issues.push(issue('starting-state-provenance-checksum-mismatch', 'blocking', `/engine${row.scenarioPath}`, 'provenance claim does not bind the current authored value'));
    }
  }

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
    regionalResearch: {
      population: [polandPopulation],
      projectionCandidates: [{ ...polandProjection, firstMonthComparison: polandProjectionFirstMonth }],
    },
    politicsCandidates,
    provenance,
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
    '| Polity | Fidelity | Regions | National totals | Goals | Agreements | Formations | Commanders | Government | Factions | Finance |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...audit.polities.map((row) => `| ${row.polityId} | ${row.fidelity} | ${row.regionCount} | ${row.controls.matches ? 'exact' : 'MISMATCH'} | ${row.goals.length} | ${row.agreements} | ${row.formations} | ${row.commanders} | ${row.government ? 'yes' : 'no'} | ${row.factions} | ${row.finance ? 'yes' : 'no'} |`),
    '',
    `First-month baseline: **${audit.firstMonth.matches ? 'exact' : 'MISMATCH'}** (\`${audit.firstMonth.actualChecksum}\`).`,
    '',
    `Starting-state provenance: **${audit.provenance.coveredRows}/${audit.provenance.totalRows}** exact rows covered; ${audit.provenance.missingRows} missing; ${audit.provenance.checksumMismatches} checksum mismatches.`,
    '',
    '## Sourced regional allocations ready for projection',
    '',
    ...audit.regionalResearch.population.map((entry) => `- ${entry.polityId}: ${entry.rows.length} regions, ${entry.sourcePopulationTotal.toLocaleString('en-US')} source persons apportioned to exact target ${entry.targetPopulation.toLocaleString('en-US')} (\`${entry.checksum}\`).`),
    ...audit.regionalResearch.projectionCandidates.map((entry) => `- ${entry.polityId} economy candidate: ${entry.rows.length} regions, ${entry.processingRegionCount} processing region, national population/capacity ${entry.nationalControls.population.toLocaleString('en-US')}/${entry.nationalControls.industrialCapacity.toLocaleString('en-US')}; first month **${entry.firstMonthComparison.matches ? 'exact' : 'MISMATCH'}** (\`${entry.checksum}\`).`),
    '',
    '## Politics candidates',
    '',
    ...audit.politicsCandidates.map((entry) => `- ${entry.polityId}: head of state ${entry.headOfState.name}; head of government ${entry.headOfGovernment.name}; decision authority ${entry.decisionAuthority.name}; ${entry.factionCount} factions; status **${entry.status}** (\`${entry.checksum}\`).`),
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
