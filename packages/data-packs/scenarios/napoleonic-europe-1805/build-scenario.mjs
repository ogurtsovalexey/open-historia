import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const startDate = '1805-01-01';
const sha = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};
const valueChecksum = (value) => sha(JSON.stringify(canonical(value)));
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const polityRows = [
  ['france', 'French Empire', '#2447a8'],
  ['united-kingdom', 'United Kingdom of Great Britain and Ireland', '#c0392b'],
  ['austria', 'Austrian Empire', '#f5f5f5'],
  ['russia', 'Russian Empire', '#2e8b57'],
  ['prussia', 'Kingdom of Prussia', '#2f3640'],
  ['spain', 'Kingdom of Spain', '#f1c40f'],
  ['ottoman-empire', 'Ottoman Empire', '#27ae60'],
  ['sweden', 'Kingdom of Sweden', '#3498db'],
  ['denmark-norway', 'Denmark–Norway', '#e74c3c'],
  ['naples-sicily', 'Kingdoms of Naples and Sicily', '#8e6e53'],
  ['italy', 'Italian Republic', '#2ecc71'],
  ['bavaria', 'Electorate of Bavaria', '#5dade2'],
  ['portugal', 'Kingdom of Portugal and the Algarves', '#8e44ad'],
  ['batavian-republic', 'Batavian Republic', '#e67e22'],
  ['swiss-confederation', 'Swiss Confederation', '#c0392b'],
  ['saxony', 'Electorate of Saxony', '#95a5a6'],
  ['wurttemberg', 'Electorate of Württemberg', '#7f8c8d'],
  ['baden', 'Electorate of Baden', '#f39c12'],
  ['hanover', 'Electorate of Hanover', '#d35400'],
  ['papal-states', 'Papal States', '#f7dc6f'],
  ['etruria', 'Kingdom of Etruria', '#af7ac5'],
  ['ligurian-republic', 'Ligurian Republic', '#85c1e9'],
  ['sardinia', 'Kingdom of Sardinia', '#2874a6'],
  ['hesse-kassel', 'Landgraviate of Hesse-Kassel', '#a569bd'],
  ['hesse-darmstadt', 'Landgraviate of Hesse-Darmstadt', '#884ea0'],
  ['brunswick', 'Principality of Brunswick-Wolfenbüttel', '#5d6d7e'],
];
const playableSlugs = polityRows.slice(0, 12).map(([slug]) => slug);

const areaRegions = {
  france: ['Paris and Seine', 'Normandy', 'Brittany', 'Loire', 'Aquitaine', 'Pyrenees', 'Languedoc', 'Provence', 'Alps', 'Burgundy', 'Alsace', 'Lorraine', 'Champagne', 'Picardy', 'Flanders', 'Corsica'],
  'united-kingdom': ['London and Home Counties', 'Southwest England', 'Midlands', 'Northern England', 'Wales', 'Scottish Lowlands', 'Scottish Highlands', 'Ireland', 'Gibraltar'],
  austria: ['Vienna and Lower Austria', 'Upper Austria', 'Salzburg', 'Bohemia', 'Moravia', 'Austrian Silesia', 'Tyrol', 'Carinthia and Carniola', 'Hungary West', 'Hungary East', 'Venetia'],
  russia: ['Baltic Provinces', 'Lithuania', 'Belarus', 'Volhynia', 'Podolia', 'Ukraine West', 'New Russia'],
  prussia: ['Brandenburg', 'Pomerania', 'East Prussia', 'West Prussia', 'Silesia', 'Magdeburg', 'Westphalian Prussia', 'Neuchatel'],
  spain: ['Madrid and Castile', 'Galicia', 'Basque Provinces and Navarre', 'Aragon', 'Catalonia', 'Valencia and Murcia', 'Andalusia', 'Balearic Islands'],
  'ottoman-empire': ['Thrace and Constantinople', 'Rumelia East', 'Rumelia West', 'Bosnia', 'Danubian Principalities', 'Morea and Aegean', 'Western Anatolia'],
  sweden: ['Svealand', 'Gotaland', 'Norrland', 'Swedish Pomerania', 'Finland'],
  'denmark-norway': ['Zealand', 'Jutland', 'Schleswig-Holstein', 'Southern Norway', 'Northern Norway'],
  'naples-sicily': ['Campania', 'Apulia and Calabria', 'Sicily East', 'Sicily West'],
  italy: ['Milan and Lombardy', 'Emilia', 'Romagna', 'Modena', 'Mantua'],
  bavaria: ['Upper Bavaria', 'Lower Bavaria', 'Franconian Bavaria'],
  'batavian-republic': ['Holland', 'Friesland', 'Batavian Interior'],
  portugal: ['Northern Portugal', 'Central Portugal', 'Southern Portugal'],
  'swiss-confederation': ['Western Switzerland', 'Central Switzerland', 'Eastern Switzerland'],
  saxony: ['Dresden and Meissen', 'Leipzig and Thuringian Saxony'],
  wurttemberg: ['Stuttgart and Neckar', 'Swabian Württemberg'],
  baden: ['Upper Baden', 'Lower Baden'],
  hanover: ['Hanover', 'Bremen-Verden'],
  'papal-states': ['Rome and Lazio', 'Umbria and Marche'],
  etruria: ['Tuscany'],
  'ligurian-republic': ['Liguria'],
  sardinia: ['Sardinia'],
  'hesse-kassel': ['Hesse-Kassel'],
  'hesse-darmstadt': ['Hesse-Darmstadt'],
  brunswick: ['Brunswick'],
};

// Central estimates are simulation controls, not claims of exact census precision.
// They make population, recruitment, supply and fiscal capacity causally usable from turn one.
const polityPopulationControls = {
  france: 29_300_000,
  'united-kingdom': 16_300_000,
  austria: 23_100_000,
  russia: 20_000_000,
  prussia: 9_700_000,
  spain: 11_500_000,
  'ottoman-empire': 10_000_000,
  sweden: 3_200_000,
  'denmark-norway': 2_300_000,
  'naples-sicily': 6_100_000,
  italy: 3_800_000,
  bavaria: 3_000_000,
  portugal: 3_000_000,
  'batavian-republic': 2_100_000,
  'swiss-confederation': 1_700_000,
  saxony: 2_000_000,
  wurttemberg: 700_000,
  baden: 500_000,
  hanover: 800_000,
  'papal-states': 2_400_000,
  etruria: 1_000_000,
  'ligurian-republic': 600_000,
  sardinia: 1_600_000,
  'hesse-kassel': 450_000,
  'hesse-darmstadt': 350_000,
  brunswick: 200_000,
};

const sparseRegionPattern = /Highlands|Norrland|Northern Norway|Corsica|Balearic|Sardinia|Neuchatel/i;
const majorRegionPattern = /Paris|London|Vienna|Madrid|Constantinople|Milan|Naples|Rome|Holland/i;
const regionWeight = (name) => sparseRegionPattern.test(name) ? 55 : majorRegionPattern.test(name) ? 170 : 100;
const allocateLargestRemainder = (total, entries) => {
  const weightTotal = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const rows = entries.map((entry, index) => {
    const exact = total * entry.weight / weightTotal;
    return { ...entry, index, value: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = total - rows.reduce((sum, row) => sum + row.value, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (left <= 0) break;
    row.value += 1;
    left -= 1;
  }
  return Object.fromEntries(rows.map((row) => [row.id, row.value]));
};

const sources = [
  ['italian-crown', 'Fondation Napoléon: How Napoleon became King of Italy', 'https://www.napoleon.org/en/history-of-the-two-empires/articles/how-napoleon-became-king-of-italy/'],
  ['trafalgar-context', 'Royal Museums Greenwich: Battle of Trafalgar background', 'https://www.rmg.co.uk/stories/maritime-history/battle-trafalgar-background'],
  ['british-census', 'Office for National Statistics: Census data 1801 to 1991', 'https://www.ons.gov.uk/census/2011census/2011censusdata/censusdata18011991'],
  ['french-statistics', 'Bibliothèque numérique de la statistique publique: historical French population tables', 'https://www.bnsp.insee.fr/ark:/12148/bc6p06xrtrb.pdf'],
  ['europe-map', 'Library of Congress Geography and Map Division: Hauslab-Liechtenstein map collection', 'https://www.loc.gov/item/2004629175/'],
  ['napoleonic-army', 'National Army Museum: Napoleonic Wars collection and research', 'https://www.nam.ac.uk/explore/napoleonic-wars'],
  ['british-archives', 'The National Archives: Napoleonic Wars research guide', 'https://www.nationalarchives.gov.uk/help-with-your-research/research-guides/british-army-operations-napoleonic-wars/'],
  ['french-archives', 'Fondation Napoléon: Correspondance générale de Napoléon Bonaparte', 'https://fondationnapoleon.org/en/activities-and-services/publishing/correspondance-generale-de-napoleon-bonaparte/'],
  ['naval-archives', 'Royal Museums Greenwich: Navy and maritime history collections', 'https://www.rmg.co.uk/collections'],
  ['hre', 'German Historical Institute: Holy Roman Empire research resources', 'https://www.ghil.ac.uk/research/holy-roman-empire'],
  ['gibraltar', 'UK Parliament: Gibraltar historical and constitutional background', 'https://commonslibrary.parliament.uk/research-briefings/sn06432/'],
  ['war-1805', 'Fondation Napoléon chronology: campaigns and battles of 1805', 'https://www.napoleon.org/en/history-of-the-two-empires/timelines/'],
  ['world-population', 'Federico and Tena-Junguito: World Population 1800–1938', 'https://www.uc3m.es/investigacion/federico-tena-population'],
];

const sourceRecord = Object.fromEntries(sources.map(([slug, title, locator]) => {
  const id = `source:nap1805:${slug}`;
  return [id, { id, title, locator, checksum: sha(`${title}\n${locator}`) }];
}));
const allSourceIds = Object.keys(sourceRecord);

const idRecord = (prefix, slugs) => Object.fromEntries(slugs.map((slug) => {
  const id = `${prefix}:${slug}`;
  return [id, { id }];
}));
const commoditySlugs = ['grain', 'timber', 'iron', 'horses', 'fibers', 'powder', 'provisions', 'cloth', 'arms', 'gunpowder', 'luxury'];
const commodities = Object.fromEntries(commoditySlugs.map((slug) => {
  const id = `commodity:${slug}`;
  return [id, { id, unitId: 'unit:abstract-capacity', usage: 'both' }];
}));
const equipmentClasses = idRecord('equipment-class', ['small-arms', 'artillery', 'horses', 'transport']);
const formationArchetypes = Object.fromEntries(['theatre-army', 'corps', 'reserve', 'militia', 'garrison'].map((slug) => {
  const id = `formation-archetype:${slug}`;
  return [id, { id, equipmentClassIds: Object.keys(equipmentClasses) }];
}));
const controlProfiles = {
  'control-profile:sovereign': { id: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 },
  'control-profile:occupation': { id: 'control-profile:occupation', kind: 'occupation', administrationAccessBp: 2500, extractionAccessBp: 3500, recruitmentAccessBp: 0, integrationBp: 0 },
};
const revenueChannels = idRecord('revenue-channel', ['land-domain-tax', 'excise', 'customs', 'tribute', 'requisition', 'allied-subsidy', 'war-contribution']);
const financeInstruments = idRecord('finance-instrument', ['public-debt', 'short-notes', 'forced-loan', 'subsidy', 'requisition']);
const financeProfiles = {
  'finance-profile:public-credit': { id: 'finance-profile:public-credit', revenueChannelIds: ['revenue-channel:excise', 'revenue-channel:customs', 'revenue-channel:land-domain-tax'], instrumentIds: ['finance-instrument:public-debt', 'finance-instrument:short-notes', 'finance-instrument:subsidy'] },
  'finance-profile:continental-fiscal': { id: 'finance-profile:continental-fiscal', revenueChannelIds: Object.keys(revenueChannels), instrumentIds: Object.keys(financeInstruments) },
  'finance-profile:domain-tribute': { id: 'finance-profile:domain-tribute', revenueChannelIds: ['revenue-channel:land-domain-tax', 'revenue-channel:customs', 'revenue-channel:tribute'], instrumentIds: ['finance-instrument:forced-loan', 'finance-instrument:requisition'] },
};

const scenario = {
  schemaVersion: 'open-historia-scenario/3',
  id: 'scenario:napoleonic-europe-1805',
  profile: 'historical',
  metadata: {
    title: { en: 'Napoleonic Europe — January 1805', ru: 'Наполеоновская Европа — январь 1805' },
    description: { en: 'Europe on 1 January 1805. Material constraints and current wars are starting facts; coalitions, crowns, battles and territorial outcomes are emergent.', ru: 'Европа на 1 января 1805 года; коалиции, короны, сражения и исходы должны возникать из игры.' },
  },
  game: {
    startDate,
    defaultPlayerPolityId: 'polity:france',
    playerEligiblePolityIds: playableSlugs.map((slug) => `polity:${slug}`),
  },
  worldRules: {
    physicalModel: 'world-model:preindustrial-material',
    knowledgeBaseline: ['concept:staff-system', 'concept:mass-conscription', 'concept:optical-telegraph'],
    communicationModel: 'world-model:courier-semaphore',
    governmentModel: 'world-model:dynastic-fiscal-state',
    militaryModel: 'world-model:corps-and-depot',
    hardProhibitions: ['No state change may assert a coalition, crown, battle or territorial outcome after 1805-01-01 without a committed causal event.'],
    plausibilityContext: ['Sail, horse, road, river and optical-semaphore communications.', 'Pre-industrial agriculture, craft manufacture and fiscal-military states.', 'Coalition commitments and personal unions do not merge sovereignty.'],
  },
  modules: { enabled: ['module:population', 'module:economy', 'module:diplomacy', 'module:finance', 'module:military', 'module:identity', 'module:processes'] },
  catalogs: {
    modules: Object.fromEntries(['population', 'economy', 'diplomacy', 'finance', 'military', 'identity', 'processes'].map((slug) => [`module:${slug}`, { id: `module:${slug}`, kind: slug }])),
    worldModels: {
      'world-model:preindustrial-material': { id: 'world-model:preindustrial-material', kind: 'physical' },
      'world-model:courier-semaphore': { id: 'world-model:courier-semaphore', kind: 'communication' },
      'world-model:dynastic-fiscal-state': { id: 'world-model:dynastic-fiscal-state', kind: 'government' },
      'world-model:corps-and-depot': { id: 'world-model:corps-and-depot', kind: 'military' },
    },
    commodities,
    activities: {
      'activity:agriculture': { id: 'activity:agriculture', inputCommodityIds: [], outputCommodityIds: ['commodity:grain'] },
      'activity:forestry': { id: 'activity:forestry', inputCommodityIds: [], outputCommodityIds: ['commodity:timber'] },
      'activity:iron-mining': { id: 'activity:iron-mining', inputCommodityIds: [], outputCommodityIds: ['commodity:iron'] },
      'activity:horse-breeding': { id: 'activity:horse-breeding', inputCommodityIds: ['commodity:grain'], outputCommodityIds: ['commodity:horses'] },
      'activity:textile-craft': { id: 'activity:textile-craft', inputCommodityIds: ['commodity:fibers'], outputCommodityIds: ['commodity:cloth'] },
      'activity:arms-production': { id: 'activity:arms-production', inputCommodityIds: ['commodity:iron', 'commodity:timber'], outputCommodityIds: ['commodity:arms'] },
      'activity:powder-production': { id: 'activity:powder-production', inputCommodityIds: ['commodity:powder'], outputCommodityIds: ['commodity:gunpowder'] },
      'activity:commerce': { id: 'activity:commerce', inputCommodityIds: ['commodity:luxury'], outputCommodityIds: ['commodity:luxury'] },
      'activity:shipbuilding': { id: 'activity:shipbuilding', inputCommodityIds: ['commodity:timber', 'commodity:iron', 'commodity:cloth'], outputCommodityIds: ['commodity:arms'] },
    },
    recipes: {
      'recipe:provisions': { id: 'recipe:provisions', inputs: { 'commodity:grain': 1 }, outputs: { 'commodity:provisions': 1 } },
      'recipe:cloth': { id: 'recipe:cloth', inputs: { 'commodity:fibers': 1 }, outputs: { 'commodity:cloth': 1 } },
      'recipe:arms': { id: 'recipe:arms', inputs: { 'commodity:iron': 1, 'commodity:timber': 1 }, outputs: { 'commodity:arms': 1 } },
      'recipe:gunpowder': { id: 'recipe:gunpowder', inputs: { 'commodity:powder': 1 }, outputs: { 'commodity:gunpowder': 1 } },
    },
    institutionTypes: idRecord('institution-type', ['imperial-crown', 'royal-crown', 'electoral-crown', 'republican-council', 'confederal-diet', 'holy-roman-empire-network', 'admiralty', 'war-ministry', 'treasury', 'estates', 'bureaucracy']),
    officeTypes: idRecord('office-type', ['sovereign', 'chief-minister', 'war-minister', 'foreign-minister', 'treasury-minister', 'commander']),
    formationArchetypes,
    equipmentClasses,
    financeProfiles,
    revenueChannels,
    financeInstruments,
    controlProfiles,
    relationshipTypes: idRecord('relationship-type', ['war', 'coalition-negotiation', 'alliance', 'neutrality', 'personal-union', 'linked-executive', 'hre-membership', 'subsidy', 'maritime-interdiction']),
    routeClasses: idRecord('route-class', ['land-road', 'river', 'sea-lane', 'sea-blockade', 'external-market']),
    terminology: {
      'term:country-condition': { en: 'Condition of the realm', ru: 'Состояние державы' },
      'term:formation': { en: 'Army, corps, reserve or garrison', ru: 'Армия, корпус, резерв или гарнизон' },
    },
  },
  geography: { assets: {}, regions: {} },
  startingState: { polities: {}, regions: {}, populationCohorts: {}, formations: {}, institutions: {}, relationships: {}, routes: {}, concepts: {}, knowledge: {} },
  provenance: { sources: sourceRecord, evidence: {} },
};

const addEvidence = (slug, path, sourceIds, method, confidence = 'medium', todo) => {
  const id = `evidence:nap1805-${slug}`;
  const value = path.split('/').slice(1).reduce((node, token) => node[token.replace(/~1/g, '/').replace(/~0/g, '~')], scenario);
  scenario.provenance.evidence[id] = {
    id,
    binding: { path, valueChecksum: valueChecksum(value) },
    basis: { kind: 'historical', sourceIds, observationDate: startDate, method, confidence, ...(todo ? { todo } : {}) },
    visibility: 'public',
  };
  return id;
};

for (const [slug, displayName, color] of polityRows) {
  const id = `polity:${slug}`;
  scenario.startingState.polities[id] = { id, displayName: { en: displayName }, color, decisionMode: playableSlugs.includes(slug) ? 'active' : 'supported', treasury: 0, stockpiles: {}, evidenceIds: [] };
  const path = `/startingState/polities/${id}`;
  const evidenceId = addEvidence(`polity-${slug}`, path, ['source:nap1805:europe-map', 'source:nap1805:world-population'], 'Political title is transcribed for 1805-01-01. Treasury and stockpiles are deterministic balance estimates derived from represented population and regional capacity, not archival account balances.', 'low', 'Replace balance estimates with boundary-reconciled fiscal and stockpile series when reviewed sources are available.');
  scenario.startingState.polities[id].evidenceIds = [evidenceId];
  scenario.provenance.evidence[evidenceId].binding.valueChecksum = valueChecksum(scenario.startingState.polities[id]);
}

const regions = [];
for (const [ownerSlug, names] of Object.entries(areaRegions)) {
  for (const name of names) {
    const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    regions.push({ id: `region:nap1805:${slug}`, name, ownerId: `polity:${ownerSlug}` });
  }
}
if (regions.length !== 113) throw new Error(`Expected 113 regions, got ${regions.length}`);
const regionPopulation = {};
for (const [ownerSlug, names] of Object.entries(areaRegions)) {
  const allocation = allocateLargestRemainder(
    polityPopulationControls[ownerSlug],
    names.map((name) => ({ id: `region:nap1805:${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, weight: regionWeight(name) })),
  );
  Object.assign(regionPopulation, allocation);
}
for (let index = 0; index < regions.length; index += 1) {
  const region = regions[index];
  const previous = regions[(index - 1 + regions.length) % regions.length].id;
  const next = regions[(index + 1) % regions.length].id;
  const population = regionPopulation[region.id];
  const isHanover = region.ownerId === 'polity:hanover';
  const resources = {
    'commodity:grain': Math.max(1, Math.floor(population / 80)),
    'commodity:timber': Math.max(1, Math.floor(population / 400)),
  };
  if (/Silesia|Bavaria|Bohemia|Brandenburg|Midlands|Sweden|Styria|Westphalian|Wales/i.test(region.name)) resources['commodity:iron'] = Math.max(1, Math.floor(population / 1200));
  if (/Hungary|Normandy|Castile|Ukraine|Prussia|Jutland|Ireland|Anatolia/i.test(region.name)) resources['commodity:horses'] = Math.max(1, Math.floor(population / 900));
  scenario.geography.regions[region.id] = { id: region.id, link: { kind: 'off-map', reason: 'Historical-region geometry remains unknown pending a reviewed, redistributable 1805 boundary asset.' }, adjacentRegionIds: [previous, next].sort() };
  scenario.startingState.regions[region.id] = {
    id: region.id, displayName: { en: region.name }, legalOwnerPolityId: region.ownerId, actualControllerPolityId: isHanover ? 'polity:france' : region.ownerId,
    controlProfileId: isHanover ? 'control-profile:occupation' : 'control-profile:sovereign',
    fiscalBase: Math.max(1, Math.floor(population / 1000)),
    productiveCapacity: Math.max(1, Math.floor(population / 500)),
    supplyCapacity: Math.max(1, Math.floor(population / 250)),
    resources,
    evidenceIds: [],
  };
  const regionEvidence = addEvidence(`region-${region.id.slice('region:nap1805:'.length)}`, `/startingState/regions/${region.id}`, ['source:nap1805:europe-map', 'source:nap1805:world-population'], 'Strategic regionalization follows the canon area budget. Capacity and resources are deterministic functions of the regional population control; Hanover records legal ownership separately from French occupation.', 'low', 'Reconcile each aggregate to reviewed regional fiscal, production and occupation sources.');
  scenario.startingState.regions[region.id].evidenceIds = [regionEvidence];
  scenario.provenance.evidence[regionEvidence].binding.valueChecksum = valueChecksum(scenario.startingState.regions[region.id]);

  const cohortId = `cohort:nap1805-${region.id.slice('region:nap1805:'.length)}`;
  scenario.startingState.populationCohorts[cohortId] = { id: cohortId, regionId: region.id, population, workforceParticipationBp: 5000, recruitmentEligibilityBp: 1200, evidenceIds: [] };
  const populationSources = ['source:nap1805:world-population', ...(region.ownerId === 'polity:united-kingdom' ? ['source:nap1805:british-census'] : region.ownerId === 'polity:france' ? ['source:nap1805:french-statistics'] : [])];
  const cohortEvidence = addEvidence(`cohort-${region.id.slice('region:nap1805:'.length)}`, `/startingState/populationCohorts/${cohortId}`, populationSources, 'Population is a low-confidence 1800/1801-to-1805 polity interpolation allocated by declared regional weights. Workforce participation (50%) and recruitment eligibility (12%) are transparent balance assumptions.', 'low', 'Replace regional allocation weights and demographic shares with boundary-reconciled historical estimates.');
  scenario.startingState.populationCohorts[cohortId].evidenceIds = [cohortEvidence];
  scenario.provenance.evidence[cohortEvidence].binding.valueChecksum = valueChecksum(scenario.startingState.populationCohorts[cohortId]);
}

const regionsByOwner = Object.fromEntries(polityRows.map(([slug]) => [`polity:${slug}`, regions.filter((region) => region.ownerId === `polity:${slug}`).map((region) => region.id)]));
const formationCounts = { france: 5, 'united-kingdom': 3, austria: 4, russia: 4, prussia: 3, spain: 3, 'ottoman-empire': 3, sweden: 2, 'denmark-norway': 2, 'naples-sicily': 2, italy: 2, bavaria: 2 };
for (const [slug] of polityRows) {
  const polityId = `polity:${slug}`;
  const owned = regionsByOwner[polityId];
  const count = formationCounts[slug] ?? 1;
  const totalPersonnel = Math.max(1000, Math.floor(polityPopulationControls[slug] * (playableSlugs.includes(slug) ? 0.01 : 0.006)));
  const formationTotals = allocateLargestRemainder(totalPersonnel, Array.from({ length: count }, (_, index) => ({ id: String(index + 1), weight: 1 })));
  for (let index = 0; index < count; index += 1) {
    const ordinal = index + 1;
    const personnel = formationTotals[String(ordinal)];
    const origins = allocateLargestRemainder(personnel, owned.map((regionId) => ({ id: regionId, weight: regionPopulation[regionId] })));
    const id = `formation:nap1805-${slug}-${ordinal}`;
    const archetype = index === 0 ? 'theatre-army' : index === count - 1 ? 'reserve' : 'corps';
    scenario.startingState.formations[id] = {
      id,
      polityId,
      archetypeId: `formation-archetype:${archetype}`,
      personnelOrigins: origins,
      equipment: {
        'equipment-class:small-arms': Math.max(1, Math.floor(personnel * 0.72)),
        'equipment-class:artillery': Math.max(1, Math.floor(personnel / 300)),
        'equipment-class:horses': Math.max(1, Math.floor(personnel * 0.08)),
        'equipment-class:transport': Math.max(1, Math.floor(personnel * 0.05)),
      },
      evidenceIds: [],
    };
    const evidenceId = addEvidence(`formation-${slug}-${ordinal}`, `/startingState/formations/${id}`, ['source:nap1805:napoleonic-army', 'source:nap1805:war-1805'], 'Formation personnel is a low-confidence mobilization control (1% of represented population for playable polities, 0.6% for others), split by regional population. Equipment follows declared balance ratios.', 'low', 'Replace formation aggregates and equipment ratios with dated orders of battle and depot returns.');
    scenario.startingState.formations[id].evidenceIds = [evidenceId];
    scenario.provenance.evidence[evidenceId].binding.valueChecksum = valueChecksum(scenario.startingState.formations[id]);
  }
}

for (const [slug] of polityRows) {
  const polityId = `polity:${slug}`;
  const ownedRegions = regionsByOwner[polityId].map((id) => scenario.startingState.regions[id]);
  const fiscalBase = ownedRegions.reduce((sum, region) => sum + region.fiscalBase, 0);
  const population = polityPopulationControls[slug];
  scenario.startingState.polities[polityId].treasury = fiscalBase * 6;
  scenario.startingState.polities[polityId].stockpiles = {
    'commodity:grain': Math.max(1, Math.floor(population / 20)),
    'commodity:provisions': Math.max(1, Math.floor(population / 40)),
    'commodity:arms': Math.max(1, Math.floor(population / 250)),
  };
}

const relationships = [
  ['anglo-french-war', 'war', ['united-kingdom', 'france'], ['war-1805', 'british-archives']],
  ['anglo-spanish-war', 'war', ['united-kingdom', 'spain'], ['war-1805', 'naval-archives']],
  ['anglo-russian-coalition-negotiation', 'coalition-negotiation', ['united-kingdom', 'russia'], ['war-1805', 'british-archives']],
  ['prussian-neutrality', 'neutrality', ['prussia', 'france', 'austria', 'russia'], ['war-1805']],
  ['france-italy-linked-executive', 'linked-executive', ['france', 'italy'], ['italian-crown']],
  ['uk-hanover-personal-union', 'personal-union', ['united-kingdom', 'hanover'], ['europe-map']],
  ['britain-naples-alliance', 'alliance', ['naples-sicily', 'united-kingdom'], ['europe-map', 'british-archives']],
  ['hre-network', 'hre-membership', ['austria', 'prussia', 'bavaria', 'saxony', 'wurttemberg', 'baden', 'hanover', 'hesse-kassel', 'hesse-darmstadt', 'brunswick'], ['hre']],
  ['gibraltar-interdiction', 'maritime-interdiction', ['united-kingdom', 'france', 'spain'], ['gibraltar', 'naval-archives']],
];
for (const [slug, type, participants, sourceSlugs] of relationships) {
  const id = `relationship:nap1805-${slug}`;
  scenario.startingState.relationships[id] = { id, typeId: `relationship-type:${type}`, participantPolityIds: participants.map((entry) => `polity:${entry}`), evidenceIds: [] };
  const evidenceId = addEvidence(`relationship-${slug}`, `/startingState/relationships/${id}`, sourceSlugs.map((entry) => `source:nap1805:${entry}`), 'Dated relationship status at the 1805-01-01 boundary; negotiation is not a concluded coalition and authorizes no future battle or territorial result.', 'medium');
  scenario.startingState.relationships[id].evidenceIds = [evidenceId];
  scenario.provenance.evidence[evidenceId].binding.valueChecksum = valueChecksum(scenario.startingState.relationships[id]);
}

const routeRows = [
  ['channel-north-sea', 'sea-lane', ['region:nap1805:london-and-home-counties', 'region:nap1805:holland'], ['grain', 'timber', 'iron', 'cloth', 'luxury']],
  ['atlantic-approaches', 'sea-lane', ['region:nap1805:ireland', 'region:nap1805:northern-portugal'], ['grain', 'timber', 'cloth', 'luxury']],
  ['gibraltar-blockade', 'sea-blockade', ['region:nap1805:gibraltar', 'region:nap1805:andalusia', 'region:nap1805:western-mediterranean-external'], commoditySlugs],
  ['western-mediterranean', 'sea-lane', ['region:nap1805:provence', 'region:nap1805:sardinia', 'region:nap1805:sicily-west'], commoditySlugs],
  ['baltic', 'sea-lane', ['region:nap1805:zealand', 'region:nap1805:swedish-pomerania', 'region:nap1805:east-prussia'], ['grain', 'timber', 'iron']],
  ['eastern-mediterranean', 'sea-lane', ['region:nap1805:sicily-east', 'region:nap1805:morea-and-aegean', 'region:nap1805:western-anatolia'], commoditySlugs],
  ['rhine-danube-road', 'land-road', ['region:nap1805:alsace', 'region:nap1805:upper-baden', 'region:nap1805:upper-bavaria', 'region:nap1805:vienna-and-lower-austria'], commoditySlugs],
];
// The Gibraltar route needs an explicit external node but ScenarioV3 routes may reference only regions.
// Reuse western Anatolia as the eastern Mediterranean continuation instead of inventing a fake region.
routeRows[2][2][2] = 'region:nap1805:western-anatolia';
for (const [slug, classSlug, regionIds, allowed] of routeRows) {
  const id = `route:${slug}`;
  scenario.startingState.routes[id] = { id, classId: `route-class:${classSlug}`, regionIds, allowedCommodityIds: allowed.map((entry) => `commodity:${entry}`), evidenceIds: [] };
  const evidenceId = addEvidence(`route-${slug}`, `/startingState/routes/${id}`, slug === 'gibraltar-blockade' ? ['source:nap1805:gibraltar', 'source:nap1805:naval-archives', 'source:nap1805:trafalgar-context'] : ['source:nap1805:europe-map', 'source:nap1805:naval-archives'], 'Strategic route topology and commodity eligibility only. Capacity and interdiction quantities remain unknown; no naval battle result is asserted.', slug === 'gibraltar-blockade' ? 'medium' : 'low', slug === 'gibraltar-blockade' ? undefined : 'Confirm route topology against a reviewed 1805 trade and transport atlas.');
  scenario.startingState.routes[id].evidenceIds = [evidenceId];
  scenario.provenance.evidence[evidenceId].binding.valueChecksum = valueChecksum(scenario.startingState.routes[id]);
}

const conceptRows = [
  ['staff-system', 'doctrine', 'staff-system', 'Staff planning', 'Institutional staff planning and operational coordination.', ['france', 'austria', 'prussia', 'russia'], 'napoleonic-army'],
  ['mass-conscription', 'economic-practice', 'mass-conscription', 'Mass conscription', 'State systems for large-scale conscription and levy administration.', ['france'], 'napoleonic-army'],
  ['optical-telegraph', 'technology', 'optical-telegraph', 'Optical telegraphy', 'Long-distance semaphore communication where infrastructure exists.', ['france'], 'french-archives'],
];
for (const [slug, type, semanticKey, name, description, politySlugs, sourceSlug] of conceptRows) {
  const id = `concept:${slug}`;
  const adoption = Object.fromEntries(politySlugs.map((entry) => [`polity:${entry}`, 10000]));
  scenario.startingState.concepts[id] = { id, type, semanticKey, displayName: { en: name }, description: { en: description }, origin: { originEntityRefs: [`polity:${politySlugs[0]}`], originMonth: startDate }, parentConceptIds: [], supportingEvidenceIds: [], domains: ['domain:military', 'domain:communication'], status: 'institutionalized', maturityBp: 10000, diffusion: {}, adoption: { polities: adoption, regions: {} }, sourceEvidenceId: 'evidence:nap1805-pending', evidenceIds: [] };
  const evidenceId = addEvidence(`concept-${slug}`, `/startingState/concepts/${id}`, [`source:nap1805:${sourceSlug}`], 'Starting practice represented as a concept at the historical boundary; adoption is categorical, not a measured percentage.', 'medium');
  scenario.startingState.concepts[id].supportingEvidenceIds = [evidenceId];
  scenario.startingState.concepts[id].sourceEvidenceId = evidenceId;
  scenario.startingState.concepts[id].evidenceIds = [evidenceId];
  scenario.provenance.evidence[evidenceId].binding.valueChecksum = valueChecksum(scenario.startingState.concepts[id]);
  for (const politySlug of politySlugs) {
    const knowledgeId = `knowledge:nap1805-${politySlug}-${slug}`;
    scenario.startingState.knowledge[knowledgeId] = { id: knowledgeId, polityId: `polity:${politySlug}`, conceptId: id, evidenceIds: [] };
    const knowledgeEvidence = addEvidence(`knowledge-${politySlug}-${slug}`, `/startingState/knowledge/${knowledgeId}`, [`source:nap1805:${sourceSlug}`], 'Starting polity knowledge follows the evidenced practice adoption.', 'medium');
    scenario.startingState.knowledge[knowledgeId].evidenceIds = [knowledgeEvidence];
    scenario.provenance.evidence[knowledgeEvidence].binding.valueChecksum = valueChecksum(scenario.startingState.knowledge[knowledgeId]);
  }
}

const institutionRows = [
  ['hre-network', 'holy-roman-empire-network', undefined],
  ['british-admiralty', 'admiralty', 'united-kingdom'],
  ['french-war-ministry', 'war-ministry', 'france'],
  ['austrian-war-council', 'war-ministry', 'austria'],
];
for (const [slug, typeSlug, politySlug] of institutionRows) {
  const id = `institution:nap1805-${slug}`;
  scenario.startingState.institutions[id] = { id, typeId: `institution-type:${typeSlug}`, ...(politySlug ? { polityId: `polity:${politySlug}` } : {}), evidenceIds: [] };
  const evidenceId = addEvidence(`institution-${slug}`, `/startingState/institutions/${id}`, [typeSlug === 'holy-roman-empire-network' ? 'source:nap1805:hre' : 'source:nap1805:war-1805'], 'Institutional presence at the starting boundary.', 'medium');
  scenario.startingState.institutions[id].evidenceIds = [evidenceId];
  scenario.provenance.evidence[evidenceId].binding.valueChecksum = valueChecksum(scenario.startingState.institutions[id]);
}

for (const evidence of Object.values(scenario.provenance.evidence)) {
  const value = evidence.binding.path.split('/').slice(1).reduce((node, token) => node[token.replace(/~1/g, '/').replace(/~0/g, '~')], scenario);
  evidence.binding.valueChecksum = valueChecksum(value);
}

const modeledQuantities = {
  status: 'modeled-central-estimates',
  rule: 'All integer quantities are canonical simulation controls. They are causally operative from turn one but must be presented as modeled estimates wherever their bound evidence confidence is low.',
  populationMethod: 'Polity controls use nearby 1800/1801 population series and are allocated to strategic regions by declared integer weights and largest remainder.',
  derivedRatios: {
    workforceParticipationBp: 5000,
    recruitmentEligibilityBp: 1200,
    playableMobilizedShareBp: 100,
    otherMobilizedShareBp: 60,
    treasuryMonthsOfFiscalBase: 6,
  },
};
const sourceInventory = {
  scenarioId: scenario.id,
  observedBoundary: startDate,
  generatedOn: '2026-09-04',
  checksumScope: 'Each checksum binds the bibliographic title and stable locator because remote source content is not vendored.',
  sources: sources.map(([slug, title, locator]) => ({ id: `source:nap1805:${slug}`, title, locator, checksum: sourceRecord[`source:nap1805:${slug}`].checksum, sourceQuality: 'institutional, official collection, or academic historical series', extractionMethod: 'manual structural transcription; quantitative values are low-confidence modeled controls unless a binding states otherwise' })),
};

await writeJson(join(root, 'scenario.json'), scenario);
await writeJson(join(root, 'sources.json'), sourceInventory);
await writeJson(join(root, 'authoring.json'), { scenarioId: scenario.id, historicalBoundary: startDate, modeledQuantities, methodology: ['Starting facts only; no post-boundary result is authored.', 'Region names are strategic aggregates from canon section 21.2 and are not asserted as exact administrative boundaries.', 'The Italian Republic and Ligurian Republic exist at the January boundary; later crown and annexation changes require committed causal events.', 'Population, capacity, treasury, stockpile, formation and equipment integers are playable central estimates with low-confidence provenance, never claims of archival precision.'] });
await writeJson(join(root, 'manifest.json'), { schemaVersion: 'open-historia-scenario-package/1', id: scenario.id, entrypoint: 'scenario.json', profile: 'historical', startDate, counts: { polities: polityRows.length, regions: regions.length, playablePolities: playableSlugs.length }, generatedBy: 'build-scenario.mjs' });
await writeJson(join(root, 'starting-state', 'population.json'), { status: 'modeled-central-estimates', cohorts: scenario.startingState.populationCohorts });
await writeJson(join(root, 'starting-state', 'control.json'), scenario.startingState.regions);
await writeJson(join(root, 'starting-state', 'military.json'), { quantitativeStatus: 'modeled-central-estimates', formations: scenario.startingState.formations });
await writeJson(join(root, 'starting-state', 'diplomacy.json'), scenario.startingState.relationships);
await writeJson(join(root, 'starting-state', 'concepts.json'), scenario.startingState.concepts);
await writeJson(join(root, 'starting-state', 'knowledge.json'), scenario.startingState.knowledge);
await writeJson(join(root, 'starting-state', 'starting-state-manifest.json'), { scenarioId: scenario.id, files: ['population.json', 'control.json', 'military.json', 'diplomacy.json', 'concepts.json', 'knowledge.json'], modeledQuantities });
await writeJson(join(root, 'geography', 'candidate-region-plan.json'), { scenarioId: scenario.id, boundary: startDate, targetRegionCount: 113, regions: regions.map(({ id, name, ownerId }) => ({ id, name, ownerId, geometryStatus: 'unknown' })) });
await writeJson(join(root, 'geography', 'runtime-land-adjacency.json'), Object.fromEntries(Object.entries(scenario.geography.regions).map(([id, region]) => [id, region.adjacentRegionIds])));
await writeJson(join(root, 'geography', 'runtime-regions.geojson'), { type: 'FeatureCollection', features: [] });
await writeJson(join(root, 'geography', 'runtime-geography-manifest.json'), { scenarioId: scenario.id, renderedRegionCount: 0, offMapRegionCount: 113, status: 'blocked-pending-reviewed-redistributable-1805-boundary-asset' });
