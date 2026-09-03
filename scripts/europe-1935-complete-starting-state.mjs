import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  compileHistoricalProjection,
  initState,
  parseScenario,
  resolveMonth,
  startingStateValueChecksum,
} from '@open-historia/engine';
import {
  REQUIRED_MODULES,
  STARTING_STATE_PROVENANCE_COLLECTIONS,
  buildFirstMonthBaseline,
} from './europe-1935-starting-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_ROOT = path.join(ROOT, 'packages/data-packs/fixtures/europe-1935-benchmark');
const ENGINE_PATH = path.join(FIXTURE_ROOT, 'engine/scenario.json');
const AUTHORING_PATH = path.join(FIXTURE_ROOT, 'authoring.json');
const SOURCES_PATH = path.join(FIXTURE_ROOT, 'sources.json');
const MANIFEST_PATH = path.join(FIXTURE_ROOT, 'manifest.json');
const POLAND_POLITICS_PATH = path.join(FIXTURE_ROOT, 'starting-state/poland-politics.json');
const POLITICS_BUNDLE_PATH = path.join(FIXTURE_ROOT, 'starting-state/politics-bundle.json');
const STARTING_STATE_MANIFEST_PATH = path.join(FIXTURE_ROOT, 'starting-state/starting-state-manifest.json');
const BASELINE_PATH = path.join(FIXTURE_ROOT, 'engine/first-month-baseline.json');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const rawSha256 = (file) => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const jsonSha256 = (value) => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const display = (name) => ({ en: name, ru: name });
const slug = (polityId) => polityId.slice('polity:'.length);

const LEADERSHIP_SOURCES = Object.freeze([
  {
    id: 'source:europe-1935-benchmark:austrian-presidency-miklas',
    title: 'Bisherige Amtsinhaber — Wilhelm Miklas', publisher: 'Österreichische Präsidentschaftskanzlei',
    publicationDate: '2026', locator: 'https://www.bundespraesident.at/aktuelles/detail/bisherige-amtsinhaber', retrievedAt: '2026-09-03',
    license: { status: 'metadata-only' }, note: 'Institutional chronology places Wilhelm Miklas in the federal presidency from 1928 to 1938.',
  },
  {
    id: 'source:europe-1935-benchmark:czech-government-malypetr',
    title: 'Jan Malypetr', publisher: 'Vláda České republiky', publicationDate: '2019-03-07',
    locator: 'https://vlada.gov.cz/cz/clenove-vlady/historie-minulych-vlad/rejstrik-predsedu-vlad/jan-malypetr-433/', retrievedAt: '2026-09-03',
    license: { status: 'metadata-only' }, note: 'Official government chronology gives Malypetr three consecutive premierships from 1932 through 1935.',
  },
  {
    id: 'source:europe-1935-benchmark:prague-castle-masaryk',
    title: 'Tomáš Garrigue Masaryk — life and works in dates', publisher: 'Prague Castle',
    locator: 'https://www.hrad.cz/en/president-of-the-cr/former-presidents/tomas-garrigue-masaryk/life-and-works-in-dates', retrievedAt: '2026-09-03',
    license: { status: 'metadata-only' }, note: 'Official presidential chronology records Masaryk’s 1934 re-election and 1935 resignation.',
  },
  {
    id: 'source:europe-1935-benchmark:elysee-lebrun',
    title: 'Albert Lebrun, 1932–1940', publisher: 'Présidence de la République française',
    locator: 'https://www.elysee.fr/albert-lebrun', retrievedAt: '2026-09-03', license: { status: 'metadata-only' },
    note: 'Official presidential biography records Lebrun’s tenure and limited role in day-to-day government.',
  },
  {
    id: 'source:europe-1935-benchmark:french-assembly-flandin',
    title: 'Pierre-Étienne Flandin', publisher: 'Assemblée nationale',
    locator: 'https://www.assemblee-nationale.fr/gouv_parl/fiches_personnalites/Flandin.asp', retrievedAt: '2026-09-03',
    license: { status: 'metadata-only' }, note: 'Official parliamentary record gives Flandin’s presidency of the Council from 8 November 1934 to 1 June 1935.',
  },
  {
    id: 'source:europe-1935-benchmark:ushmm-hitler-government',
    title: 'Adolf Hitler', publisher: 'United States Holocaust Memorial Museum', publicationDate: '2017-03-21',
    locator: 'https://encyclopedia.ushmm.org/content/en/article/adolf-hitler?series=207', retrievedAt: '2026-09-03',
    license: { status: 'metadata-only' }, note: 'Institutional reference records Hitler’s consolidation of head-of-state, chancellor and Führer authority after August 1934.',
  },
  {
    id: 'source:europe-1935-benchmark:quirinale-italian-monarchy',
    title: 'L’Italia unita', publisher: 'Presidenza della Repubblica — Palazzo del Quirinale',
    locator: 'https://palazzo.quirinale.it/mostre/2011_150anni/doc/italiaunita.pdf', retrievedAt: '2026-09-03',
    license: { status: 'metadata-only' }, note: 'Institutional historical publication records Vittorio Emanuele III as king from 1900 to 1946.',
  },
  {
    id: 'source:europe-1935-benchmark:italian-senate-mussolini-government',
    title: 'Resoconti del Regno d’Italia — XXVI legislatura', publisher: 'Senato della Repubblica',
    locator: 'https://www.senato.it/legislature/regno/italia/26/resoconti-volumi-e-indici', retrievedAt: '2026-09-03',
    license: { status: 'metadata-only' }, note: 'Institutional parliamentary history records the king commissioning Mussolini to form the government on 30 October 1922.',
  },
  {
    id: 'source:europe-1935-benchmark:frus-soviet-leadership',
    title: 'Foreign Relations of the United States, The Soviet Union, 1933–1939', publisher: 'Office of the Historian, U.S. Department of State',
    locator: 'https://history.state.gov/historicaldocuments/frus1933-39/d59', retrievedAt: '2026-09-03',
    license: { status: 'metadata-only' }, note: 'Contemporary diplomatic record identifies President Kalinin, Premier Molotov, Stalin and the Soviet inside directorate.',
  },
  {
    id: 'source:europe-1935-benchmark:uk-prime-ministers-macdonald',
    title: 'History of James Ramsay MacDonald', publisher: 'Government of the United Kingdom',
    locator: 'https://www.gov.uk/government/history/past-prime-ministers/james-ramsay-macdonald', retrievedAt: '2026-09-03',
    license: { status: 'metadata-only' }, note: 'Official prime-ministerial chronology records MacDonald in office from 1929 to 1935.',
  },
  {
    id: 'source:europe-1935-benchmark:fdr-library-biography',
    title: 'FDR Biography', publisher: 'Franklin D. Roosevelt Presidential Library and Museum',
    locator: 'https://www.fdrlibrary.org/fdr-biography', retrievedAt: '2026-09-03',
    license: { status: 'metadata-only' }, note: 'Official presidential-library biography anchors Roosevelt’s presidency and New Deal administration.',
  },
]);

const POLITICAL_CONFIG = Object.freeze([
  { id: 'polity:austria', source: 'source:europe-1935-benchmark:austrian-presidency-miklas', ruler: ['miklas', 'Wilhelm Miklas'], government: ['schuschnigg', 'Kurt Schuschnigg'], third: ['starhemberg', 'Ernst Rüdiger Starhemberg'], ruling: 'fatherland-front', ideology: 'traditionalist', native: 'Vaterländische Front', risk: 'cautious', legitimacy: 5000, stability: 4300, unrest: 4100, constraints: ['Preserve Austrian independence against German absorption.', 'Maintain the corporatist constitutional order while containing domestic violence.', 'Avoid strategic isolation from Italy and the western powers.'] },
  { id: 'polity:czechoslovakia', source: 'source:europe-1935-benchmark:prague-castle-masaryk', ruler: ['masaryk', 'Tomáš Garrigue Masaryk'], government: ['malypetr', 'Jan Malypetr'], third: ['benes', 'Edvard Beneš'], ruling: 'castle-coalition', ideology: 'liberal', native: 'Hradní koalice', risk: 'cautious', legitimacy: 7200, stability: 6500, unrest: 2600, constraints: ['Defend the constitutional republic and its territorial integrity.', 'Treat the French alliance as an existing security commitment.', 'Manage multinational representation without empowering secession.'] },
  { id: 'polity:france', source: 'source:europe-1935-benchmark:elysee-lebrun', ruler: ['lebrun', 'Albert Lebrun'], government: ['flandin', 'Pierre-Étienne Flandin'], third: ['laval', 'Pierre Laval'], ruling: 'republican-centre', ideology: 'liberal', native: 'Alliance démocratique', risk: 'averse', legitimacy: 6200, stability: 4900, unrest: 3300, constraints: ['Preserve parliamentary legitimacy amid cabinet instability.', 'Treat the Polish and Czechoslovak alliances as existing commitments.', 'Coordinate continental security without acting beyond available support.'] },
  { id: 'polity:germany', source: 'source:europe-1935-benchmark:ushmm-hitler-government', ruler: ['hitler', 'Adolf Hitler'], government: null, third: ['goering', 'Hermann Göring'], ruling: 'nsdap', ideology: 'nationalist', native: 'Nationalsozialistische Deutsche Arbeiterpartei', risk: 'risk-seeking', legitimacy: 6700, stability: 6900, unrest: 1800, constraints: ['Concentrate strategic authority in the Führer.', 'Revise the postwar territorial and military settlement.', 'Avoid a premature coalition war before rearmament is sufficient.'] },
  { id: 'polity:italy', source: 'source:europe-1935-benchmark:quirinale-italian-monarchy', ruler: ['victor-emmanuel-iii', 'Vittorio Emanuele III'], government: ['mussolini', 'Benito Mussolini'], third: ['balbo', 'Italo Balbo'], ruling: 'pni', ideology: 'nationalist', native: 'Partito Nazionale Fascista', risk: 'assertive', legitimacy: 6500, stability: 6400, unrest: 2200, constraints: ['Preserve the monarchy–Fascist governing compact.', 'Pursue great-power status without strategic subordination to Germany.', 'Keep Mediterranean supply and military readiness credible.'] },
  { id: 'polity:soviet-union', source: 'source:europe-1935-benchmark:frus-soviet-leadership', ruler: ['kalinin', 'Mikhail Kalinin'], government: ['molotov', 'Vyacheslav Molotov'], third: ['stalin', 'Joseph Stalin'], ruling: 'vkpb', ideology: 'socialist', native: 'Всесоюзная коммунистическая партия (большевиков)', risk: 'assertive', legitimacy: 6300, stability: 6100, unrest: 2400, constraints: ['Preserve Communist Party control of state policy.', 'Prioritize industrial and military capacity under the second five-year plan.', 'Avoid strategic encirclement while retaining freedom of action.'] },
  { id: 'polity:united-kingdom', source: 'source:europe-1935-benchmark:uk-prime-ministers-macdonald', ruler: ['george-v', 'George V'], government: ['macdonald', 'Ramsay MacDonald'], third: ['baldwin', 'Stanley Baldwin'], ruling: 'national-government', ideology: 'traditionalist', native: 'National Government', risk: 'averse', legitimacy: 7600, stability: 7000, unrest: 2100, constraints: ['Maintain parliamentary confidence in the National Government.', 'Balance rearmament against fiscal and public resistance.', 'Avoid an unsupported continental commitment.'] },
  { id: 'polity:united-states', source: 'source:europe-1935-benchmark:fdr-library-biography', ruler: ['roosevelt', 'Franklin D. Roosevelt'], government: null, third: ['garner', 'John Nance Garner'], ruling: 'new-deal-democrats', ideology: 'liberal', native: 'Democratic Party — New Deal coalition', risk: 'balanced', legitimacy: 7300, stability: 6500, unrest: 3000, constraints: ['Sustain constitutional support for economic recovery.', 'Work within congressional and judicial limits.', 'Avoid binding European security commitments.'] },
  { id: 'polity:free-city-of-danzig', source: 'source:europe-1935-benchmark:league-yearbook', ruler: ['greiser', 'Arthur Greiser'], government: null, third: ['rauschning', 'Hermann Rauschning'], ruling: 'danzig-senate', ideology: 'nationalist', native: 'Senat der Freien Stadt Danzig', risk: 'cautious', legitimacy: 4600, stability: 4300, unrest: 3600, constraints: ['Remain an inert treaty polity outside AI scheduling.', 'Preserve bounded administration of the Free City.', 'Do not create independent strategic turns.'] },
  { id: 'polity:saargebiet', source: 'source:europe-1935-benchmark:league-yearbook', ruler: ['knox', 'Geoffrey Knox'], government: null, third: ['hoffmann', 'Johannes Hoffmann'], ruling: 'league-commission', ideology: 'liberal', native: 'Regierungskommission des Saargebietes', risk: 'averse', legitimacy: 5000, stability: 5000, unrest: 3000, constraints: ['Remain an inert League-administered polity outside AI scheduling.', 'Administer the territory pending the January 1935 plebiscite.', 'Do not create independent strategic turns.'] },
]);

const makeLeaderCard = (name, role, source) => ({
  historical: true,
  factCard: [`${name} held ${role} at the 1935-01-01 scenario snapshot.`, 'Knowledge is bounded to this authored card and information available before the scenario date.'],
  knowledgePolicy: 'authored-card-plus-pre-scenario-prior', sourceRefs: [source],
});

function buildGenericPolitics(config) {
  const key = slug(config.id);
  const rulerId = `character:${key}-${config.ruler[0]}`;
  const government = config.government ?? config.ruler;
  const governmentId = config.government ? `character:${key}-${government[0]}` : rulerId;
  const thirdId = `character:${key}-${config.third[0]}`;
  const rulingId = `faction:${key}-${config.ruling}`;
  const oppositionId = `faction:${key}-institutional-opposition`;
  const labourId = `faction:${key}-social-opposition`;
  const characters = [
    { characterId: rulerId, polityId: config.id, displayName: display(config.ruler[1]), origin: 'authored', factionId: rulingId, office: 'ruler', startingTraits: ['administrator'], experienceTraits: [], loyaltyBp: 7200, ambitionBp: 5200, relations: [], leaderCard: makeLeaderCard(config.ruler[1], 'the office of head of state', config.source) },
    ...(config.government ? [{ characterId: governmentId, polityId: config.id, displayName: display(government[1]), origin: 'authored', factionId: rulingId, office: 'head-of-government', startingTraits: ['administrator', 'diplomat'], experienceTraits: [], loyaltyBp: 7000, ambitionBp: 6500, relations: [], leaderCard: makeLeaderCard(government[1], 'the office of head of government', config.id === 'polity:czechoslovakia' ? 'source:europe-1935-benchmark:czech-government-malypetr' : config.id === 'polity:france' ? 'source:europe-1935-benchmark:french-assembly-flandin' : config.id === 'polity:italy' ? 'source:europe-1935-benchmark:italian-senate-mussolini-government' : config.source) }] : []),
    { characterId: thirdId, polityId: config.id, displayName: display(config.third[1]), origin: 'authored', factionId: oppositionId, office: null, startingTraits: ['diplomat'], experienceTraits: [], loyaltyBp: 6000, ambitionBp: 5800, relations: [], leaderCard: makeLeaderCard(config.third[1], 'a significant political leadership role', config.source) },
    { characterId: `character:${key}-labour-representative`, polityId: config.id, displayName: display(`${config.ruler[1]} era labour representative`), origin: 'authored', factionId: labourId, office: null, startingTraits: ['reformer'], experienceTraits: [], loyaltyBp: 5600, ambitionBp: 4500, relations: [], leaderCard: { historical: false, factCard: ['Composite scenario representative for a bounded secondary political faction.'], knowledgePolicy: 'scenario-only', sourceRefs: [config.source] } },
  ];
  const faction = (id, name, leaderCharacterId, powerBp, ideology, preferredBudgetCategory) => ({
    factionId: id, polityId: config.id, displayName: display(name), leaderCharacterId, powerBp, supportBp: powerBp,
    idealTaxBurdenBp: 10000, preferredBudgetCategory, foreignPolicy: id === rulingId ? 'status-quo' : 'pacifist',
    ideology, traditionalismBp: ideology === 'traditionalist' || ideology === 'nationalist' ? 7000 : 3000, escalation: 'calm',
    ...(id === rulingId ? { politicalIdentity: { nativeLabel: config.native, legitimacyBases: ['Authored constitutional or governing authority at the snapshot date', 'Support of the ruling political organization'], governingPrinciples: ['Preserve the governing order', 'Protect state sovereignty', 'Use bounded state capacity'], strategicPreferences: ['Act through available diplomatic and material instruments', 'Maintain room for manoeuvre'], taboos: ['Unforced loss of sovereign decision authority'], riskAttitude: config.risk } } : {}),
  });
  return {
    polity: { polityId: config.id, legitimacyBp: config.legitimacy, stabilityBp: config.stability, unrestBp: config.unrest, successionLaw: 'appointment', rulerCharacterId: rulerId, heirCharacterId: null, strategyAuthority: { headOfStateCharacterId: rulerId, headOfGovernmentCharacterId: governmentId, decisionAuthorityCharacterId: config.id === 'polity:soviet-union' ? thirdId : governmentId, rulingFactionId: rulingId, currentConstraints: config.constraints } },
    factions: [faction(rulingId, config.native, governmentId, 6000, config.ideology, 'administration'), faction(oppositionId, 'Institutional opposition', thirdId, 2500, config.ideology === 'liberal' ? 'traditionalist' : 'liberal', 'security'), faction(labourId, 'Social and labour opposition', `character:${key}-labour-representative`, 1500, 'socialist', 'industry')],
    characters,
  };
}

function buildPolitics() {
  const poland = readJson(POLAND_POLITICS_PATH).politics;
  const generated = POLITICAL_CONFIG.map(buildGenericPolitics);
  const combined = {
    polities: [...generated.map((entry) => entry.polity), ...poland.polities].sort((a, b) => a.polityId.localeCompare(b.polityId)),
    factions: [...generated.flatMap((entry) => entry.factions), ...poland.factions].sort((a, b) => a.factionId.localeCompare(b.factionId)),
    characters: [...generated.flatMap((entry) => entry.characters), ...poland.characters].sort((a, b) => a.characterId.localeCompare(b.characterId)),
  };
  return combined;
}

const HOME_REGIONS = Object.freeze({
  'polity:austria': 'region:europe-1935:at-wien',
  'polity:czechoslovakia': 'region:europe-1935:cs-praha',
  'polity:france': 'region:europe-1935:fr-metz',
  'polity:germany': 'region:europe-1935:de-pommern',
  'polity:italy': 'region:europe-1935:it-lazio',
  'polity:poland': 'region:ohm-1935:2741476',
  'polity:united-kingdom': 'region:europe-1935:gb-southern-england',
});
const COMMANDERS = Object.freeze({
  'polity:austria': ['jansa', 'Alfred Jansa'], 'polity:czechoslovakia': ['krejci', 'Ludvík Krejčí'],
  'polity:france': ['gamelin', 'Maurice Gamelin'], 'polity:germany': ['fritsch', 'Werner von Fritsch'],
  'polity:italy': ['badoglio', 'Pietro Badoglio'], 'polity:poland': ['rydz-smigly', 'Edward Rydz-Śmigły'],
  'polity:united-kingdom': ['deverell', 'Cyril Deverell'],
});

function buildMilitary(scenario) {
  const supported = Object.keys(HOME_REGIONS);
  const commanders = supported.map((polityId) => ({ commanderId: `commander:${slug(polityId)}-${COMMANDERS[polityId][0]}`, polityId, displayName: display(COMMANDERS[polityId][1]), skill: 3, traits: ['defensive', 'organizer'] }));
  const formations = supported.map((polityId) => ({ formationId: `formation:${slug(polityId)}-home-theatre`, polityId, displayName: display(`${scenario.polities.find((entry) => entry.id === polityId).displayName.en} home theatre`), manpower: 100000, equipment: 50000, homeRegionId: HOME_REGIONS[polityId], locationRegionId: HOME_REGIONS[polityId], commanderId: `commander:${slug(polityId)}-${COMMANDERS[polityId][0]}`, moraleBp: 6500 }));
  return { ...scenario.military, commanders, formations };
}

const CAPABILITIES = Object.freeze({
  catalog: [
    { capabilityId: 'capability:administrative-coordination', displayName: display('Administrative coordination'), domain: 'administration', prerequisiteIds: [], modifier: { kind: 'project-capacity', capacity: 'administration', amount: 1 } },
    { capabilityId: 'capability:industrial-planning', displayName: display('Industrial planning'), domain: 'economy', prerequisiteIds: [], modifier: { kind: 'project-capacity', capacity: 'industry', amount: 1 } },
    { capabilityId: 'capability:staff-planning', displayName: display('General staff planning'), domain: 'military', prerequisiteIds: [], modifier: { kind: 'project-capacity', capacity: 'science', amount: 1 } },
  ],
  starting: [],
});

function buildStatecraft(scenario) {
  const priorities = { administration: 2500, science: 1500, industry: 2500, security: 1500, military: 2000 };
  const finance = scenario.polities.map((entry) => ({ polityId: entry.id, taxBurdenBp: 10000, exemptionBp: 0, priorities, debtPrincipal: 0, annualInterestBp: 0, creditLimit: Math.max(1, entry.treasury * 2) }));
  const capacities = scenario.polities.map((entry) => ({ polityId: entry.id, administration: entry.decisionMode === 'inert' ? 1 : 4, science: entry.decisionMode === 'inert' ? 1 : 3, industry: entry.decisionMode === 'inert' ? 1 : 5 }));
  const projectTemplates = [
    { templateId: 'project-template:regional-infrastructure', displayName: display('Regional infrastructure'), kind: 'construction', budgetCategory: 'industry', totalCost: 600, durationMonths: 3, capacity: { kind: 'industry', amount: 2 }, effect: { kind: 'infrastructure', gainBp: 500 } },
    { templateId: 'project-template:administrative-reform', displayName: display('Administrative reform'), kind: 'reform', budgetCategory: 'administration', totalCost: 500, durationMonths: 3, capacity: { kind: 'administration', amount: 2 }, effect: { kind: 'credit-limit', amount: 1000 } },
    { templateId: 'project-template:staff-mobilization', displayName: display('Staff mobilization'), kind: 'mobilization', budgetCategory: 'military', totalCost: 450, durationMonths: 2, capacity: { kind: 'administration', amount: 2 }, effect: { kind: 'capacity', capacity: 'administration', amount: 1 } },
    { templateId: 'project-template:intelligence-assessment', displayName: display('Intelligence assessment'), kind: 'intelligence', budgetCategory: 'security', totalCost: 300, durationMonths: 2, capacity: { kind: 'administration', amount: 1 }, effect: { kind: 'reveal-intelligence' } },
    { templateId: 'project-template:staff-planning-research', displayName: display('Staff planning research'), kind: 'research', budgetCategory: 'science', totalCost: 700, durationMonths: 5, capacity: { kind: 'science', amount: 2 }, effect: { kind: 'unlock-capability', capabilityId: 'capability:staff-planning' } },
  ];
  const intelligenceFacts = scenario.polities.map((entry) => ({ factId: `intel:${slug(entry.id)}-public-baseline`, subjectPolityId: entry.id, domain: 'politics', summary: display(`${entry.displayName.en} public institutions and declared policy at the scenario snapshot.`), evidenceId: `evidence:${slug(entry.id)}-public-baseline` }));
  const knowledgeSeeds = scenario.polities.map((entry) => ({ observerPolityId: entry.id, factId: `intel:${slug(entry.id)}-public-baseline`, confidence: 'high', evidenceId: `evidence:${slug(entry.id)}-public-baseline`, staleAfterMonths: 12 }));
  knowledgeSeeds.push({ observerPolityId: 'polity:poland', factId: 'intel:germany-public-baseline', confidence: 'high', evidenceId: 'evidence:germany-public-baseline', staleAfterMonths: 6 });
  return { finance, capacities, projectTemplates, intelligenceFacts, knowledgeSeeds };
}

function buildCampaign(scenario) {
  const goal = (polityId, suffix, name, body, initiallyActive = false) => ({ goalId: `goal:${slug(polityId)}-${suffix}`, polityId, displayName: display(name), initiallyActive, ...body });
  const goals = [
    goal('polity:austria', 'preserve-sovereignty', 'Preserve Austrian sovereignty', { kind: 'stabilize-government', thresholdBp: 6000 }, true),
    goal('polity:austria', 'italian-understanding', 'Secure Italian understanding', { kind: 'secure-alliance', targetPolityId: 'polity:italy' }),
    goal('polity:czechoslovakia', 'constitutional-stability', 'Maintain constitutional stability', { kind: 'stabilize-government', thresholdBp: 7000 }, true),
    goal('polity:czechoslovakia', 'british-security', 'Secure British security support', { kind: 'secure-alliance', targetPolityId: 'polity:united-kingdom' }),
    goal('polity:france', 'government-stability', 'Stabilize parliamentary government', { kind: 'stabilize-government', thresholdBp: 6500 }, true),
    goal('polity:france', 'british-coordination', 'Secure British strategic coordination', { kind: 'secure-alliance', targetPolityId: 'polity:united-kingdom' }),
    goal('polity:germany', 'austrian-control', 'Control Austria', { kind: 'control-region', regionId: 'region:europe-1935:at-wien' }, true),
    goal('polity:germany', 'staff-planning', 'Expand staff planning', { kind: 'unlock-capability', capabilityId: 'capability:staff-planning' }),
    goal('polity:italy', 'domestic-control', 'Preserve regime stability', { kind: 'stabilize-government', thresholdBp: 7000 }, true),
    goal('polity:italy', 'austrian-alignment', 'Secure Austrian alignment', { kind: 'secure-alliance', targetPolityId: 'polity:austria' }),
    goal('polity:poland', 'strategic-readiness', 'Build strategic readiness', { kind: 'unlock-capability', capabilityId: 'capability:staff-planning' }, true),
    goal('polity:poland', 'british-security', 'Secure British security support', { kind: 'secure-alliance', targetPolityId: 'polity:united-kingdom' }),
    goal('polity:united-kingdom', 'national-government', 'Maintain the National Government', { kind: 'stabilize-government', thresholdBp: 7200 }, true),
    goal('polity:united-kingdom', 'french-coordination', 'Secure French strategic coordination', { kind: 'secure-alliance', targetPolityId: 'polity:france' }),
  ];
  return { ...scenario.campaign, goals };
}

const IDENTITY_BY_POLITY = Object.freeze({
  'polity:austria': ['austrian', 'catholic'], 'polity:czechoslovakia': ['czech', 'christian'],
  'polity:france': ['french', 'christian'], 'polity:free-city-of-danzig': ['german', 'christian'],
  'polity:germany': ['german', 'christian'], 'polity:italy': ['italian', 'catholic'],
  'polity:poland': ['polish', 'catholic'], 'polity:saargebiet': ['german', 'christian'],
  'polity:soviet-union': ['soviet', 'secular'], 'polity:united-kingdom': ['british', 'christian'],
  'polity:united-states': ['american', 'christian'],
});

const REGIONAL_CULTURES = Object.freeze({
  'region:europe-1935:cs-slovensko': ['slovak', []],
  'region:europe-1935:cs-podkarpatska-rus': ['rusyn', [{ identityId: 'culture:ukrainian', shareBp: 1800 }]],
  'region:europe-1935:cs-sudety': ['german', [{ identityId: 'culture:czech', shareBp: 1800 }]],
  'region:europe-1935:cs-slezsko': ['czech', [{ identityId: 'culture:german', shareBp: 2800 }]],
  'region:europe-1935:fr-corse': ['corsican', [{ identityId: 'culture:french', shareBp: 2200 }]],
  'region:europe-1935:it-sardegna': ['sardinian', [{ identityId: 'culture:italian', shareBp: 2200 }]],
  'region:europe-1935:it-sicilia': ['sicilian', [{ identityId: 'culture:italian', shareBp: 1800 }]],
  'region:ohm-1935:2696109': ['polish', [{ identityId: 'culture:belarusian', shareBp: 2600 }, { identityId: 'culture:jewish', shareBp: 900 }]],
  'region:ohm-1935:2698169': ['ukrainian', [{ identityId: 'culture:polish', shareBp: 1800 }, { identityId: 'culture:jewish', shareBp: 900 }]],
  'region:ohm-1935:2698170': ['belarusian', [{ identityId: 'culture:polish', shareBp: 1500 }, { identityId: 'culture:jewish', shareBp: 700 }]],
  'region:ohm-1935:2741466': ['belarusian', [{ identityId: 'culture:polish', shareBp: 4500 }, { identityId: 'culture:jewish', shareBp: 900 }]],
  'region:ohm-1935:2741468': ['polish', [{ identityId: 'culture:belarusian', shareBp: 1800 }, { identityId: 'culture:jewish', shareBp: 1200 }]],
  'region:ohm-1935:2927191': ['polish', [{ identityId: 'culture:ukrainian', shareBp: 3500 }, { identityId: 'culture:jewish', shareBp: 1000 }]],
  'region:ohm-1935:2929589': ['ukrainian', [{ identityId: 'culture:polish', shareBp: 3600 }, { identityId: 'culture:jewish', shareBp: 800 }]],
  'region:ohm-1935:2930186': ['ukrainian', [{ identityId: 'culture:polish', shareBp: 2400 }, { identityId: 'culture:jewish', shareBp: 900 }]],
  'region:europe-1935:gb-cymru': ['welsh', [{ identityId: 'culture:british', shareBp: 3500 }]],
  'region:europe-1935:gb-central-scotland': ['scottish', [{ identityId: 'culture:british', shareBp: 3000 }]],
  'region:europe-1935:gb-highlands-islands': ['scottish', [{ identityId: 'culture:british', shareBp: 1800 }]],
  'region:europe-1935:gb-north-east-scotland': ['scottish', [{ identityId: 'culture:british', shareBp: 2800 }]],
  'region:europe-1935:gb-southern-scotland': ['scottish', [{ identityId: 'culture:british', shareBp: 3500 }]],
  'region:europe-1935:gb-northern-ireland': ['irish', [{ identityId: 'culture:british', shareBp: 4200 }]],
});

const ACCEPTED_CULTURES = Object.freeze({
  'polity:czechoslovakia': ['german', 'rusyn', 'slovak', 'ukrainian'],
  'polity:france': ['corsican'],
  'polity:italy': ['sardinian', 'sicilian'],
  'polity:poland': ['belarusian', 'jewish', 'ukrainian'],
  'polity:united-kingdom': ['irish', 'scottish', 'welsh'],
});

export function buildIdentity(scenario) {
  const cultureNames = { american: 'American', austrian: 'Austrian', belarusian: 'Belarusian', british: 'British', corsican: 'Corsican', czech: 'Czech', french: 'French', german: 'German', irish: 'Irish', italian: 'Italian', jewish: 'Jewish', polish: 'Polish', rusyn: 'Rusyn', sardinian: 'Sardinian', scottish: 'Scottish', sicilian: 'Sicilian', slovak: 'Slovak', soviet: 'Soviet', ukrainian: 'Ukrainian', welsh: 'Welsh' };
  const religionNames = { catholic: 'Catholic', christian: 'Christian', secular: 'State secularism' };
  const cultures = Object.entries(cultureNames).map(([id, name]) => ({ cultureId: `culture:${id}`, displayName: display(name) }));
  const religions = Object.entries(religionNames).map(([id, name]) => ({ religionId: `religion:${id}`, displayName: display(name) }));
  const regions = scenario.regions.map((entry) => { const [defaultCulture, religion] = IDENTITY_BY_POLITY[entry.controllerId]; const [culture, minorities] = REGIONAL_CULTURES[entry.regionId] ?? [defaultCulture, []]; return { regionId: entry.regionId, culture: { primaryId: `culture:${culture}`, minorities }, religion: { primaryId: `religion:${religion}`, minorities: [] } }; });
  const polities = scenario.polities.map((entry) => { const [culture, religion] = IDENTITY_BY_POLITY[entry.id]; return { polityId: entry.id, officialCultureId: `culture:${culture}`, acceptedCultureIds: (ACCEPTED_CULTURES[entry.id] ?? []).map((id) => `culture:${id}`), culturePolicy: 'tolerance', officialReligionId: `religion:${religion}`, acceptedReligionIds: [], religionPolicy: 'tolerance' }; });
  return { cultures, religions, regions, polities };
}

function valueAtPath(root, pointer) {
  let value = root;
  for (const segment of pointer.slice(1).split('/')) value = value[segment];
  return value;
}

function provenanceFor(scenario) {
  return STARTING_STATE_PROVENANCE_COLLECTIONS.flatMap((collectionPath) => {
    const rows = valueAtPath(scenario, collectionPath);
    if (!Array.isArray(rows)) return [];
    return rows.map((value, index) => {
      const scenarioPath = `${collectionPath}/${index}`;
      const pathSlug = collectionPath.slice(1).replaceAll('/', '-').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      let sourceRefs = ['source:europe-1935-benchmark:league-yearbook'];
      let basis = 'authored-estimate';
      let confidence = 'low';
      let method = 'Encode a conservative bounded starting value from the cited scenario references; engine-only ordinal values are estimates, not measured historical quantities.';
      let todo = 'Owner-review this exact checksum-bound row and replace the estimate when a more specific table-level source is available.';
      if (collectionPath === '/military/supplyLinks') sourceRefs = ['source:europe-1935-benchmark:openhistoricalmap'];
      if (collectionPath.startsWith('/identity/')) sourceRefs = ['source:europe-1935-benchmark:league-yearbook'];
      if (collectionPath === '/politics/characters' && value.leaderCard?.sourceRefs?.length) sourceRefs = value.leaderCard.sourceRefs;
      if (collectionPath === '/politics/polities' || collectionPath === '/politics/factions') {
        const config = POLITICAL_CONFIG.find((entry) => entry.id === value.polityId);
        sourceRefs = config ? [config.source] : ['source:europe-1935-benchmark:polish-presidency-second-republic'];
      }
      if (collectionPath === '/diplomacy/startingAgreements') {
        sourceRefs = [value.agreementId.includes('czechoslovakia') ? 'source:europe-1935-benchmark:franco-czechoslovak-treaty-1924' : 'source:europe-1935-benchmark:franco-polish-agreement-1921'];
        basis = 'source-derived'; confidence = 'medium';
        method = 'Encode the in-force treaty commitment as the closest bounded executable engine agreement type.';
        todo = 'Audit later protocols and operational conventions before increasing confidence.';
      }
      return { claimId: `starting-state-claim:${pathSlug}-${index}`, scenarioPath, valueChecksum: startingStateValueChecksum(value), basis, sourceRefs, method, confidence, todo };
    });
  });
}

function ensureSources(sources) {
  const ids = new Set(sources.map((entry) => entry.id));
  return [...sources, ...LEADERSHIP_SOURCES.filter((entry) => !ids.has(entry.id))].sort((a, b) => a.id.localeCompare(b.id));
}

function upsertAsset(manifest, asset) {
  manifest.assets = [...manifest.assets.filter((entry) => entry.id !== asset.id), asset].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildCompleteStartingState(input) {
  const scenario = structuredClone(input.engineScenario);
  scenario.modules = Object.fromEntries(REQUIRED_MODULES.map((name) => [name, true]));
  scenario.capabilities = structuredClone(CAPABILITIES);
  scenario.statecraft = buildStatecraft(scenario);
  scenario.politics = buildPolitics();
  scenario.military = buildMilitary(scenario);
  scenario.campaign = buildCampaign(scenario);
  scenario.identity = buildIdentity(scenario);
  const authoring = structuredClone(input.authoring);
  authoring.startingStateProvenance = provenanceFor(scenario);
  return { scenario: parseScenario(scenario), authoring, sources: ensureSources(input.sources) };
}

export function verifyCompleteStartingState({ manifest, scenarioV2, mapLink, expectedBaseline, ...input }) {
  const built = buildCompleteStartingState(input);
  const projection = compileHistoricalProjection({ bundle: { manifest, scenario: scenarioV2, sources: built.sources }, authoring: built.authoring, engineScenario: built.scenario, mapLink });
  const firstMonth = buildFirstMonthBaseline(resolveMonth(initState(projection.scenario), { commands: [] }));
  if (firstMonth.checksum !== expectedBaseline.checksum) throw new Error(`first-month checksum drift: ${firstMonth.checksum}`);
  return { ...built, projectionChecksum: projection.checksum, firstMonth };
}

async function main() {
  const manifest = readJson(MANIFEST_PATH);
  const scenarioV2 = readJson(path.join(FIXTURE_ROOT, 'scenario.json'));
  const mapLink = readJson(path.join(FIXTURE_ROOT, 'engine/map-link.json'));
  const expectedBaseline = readJson(BASELINE_PATH);
  const result = verifyCompleteStartingState({ manifest, scenarioV2, mapLink, expectedBaseline, engineScenario: readJson(ENGINE_PATH), authoring: readJson(AUTHORING_PATH), sources: readJson(SOURCES_PATH) });
  writeJson(ENGINE_PATH, result.scenario);
  writeJson(AUTHORING_PATH, result.authoring);
  writeJson(SOURCES_PATH, result.sources);
  const politicsBundle = { schemaVersion: 'open-historia-politics-bundle/1', status: 'owner-approved-runtime', effectiveAt: '1935-01-01', polityCount: result.scenario.polities.length, politics: result.scenario.politics };
  writeJson(POLITICS_BUNDLE_PATH, politicsBundle);
  const startingManifest = { schemaVersion: 'open-historia-starting-state-manifest/1', status: 'owner-approved-runtime', scenarioId: result.scenario.scenarioId, effectiveAt: result.scenario.startMonth, modules: REQUIRED_MODULES, polityCount: result.scenario.polities.length, regionCount: result.scenario.regions.length, projectionChecksum: result.projectionChecksum, firstMonthChecksum: result.firstMonth.checksum, provenanceRows: result.authoring.startingStateProvenance.length, artifacts: { engineScenario: jsonSha256(result.scenario), authoring: jsonSha256(result.authoring), sources: jsonSha256(result.sources), politicsBundle: jsonSha256(politicsBundle) } };
  writeJson(STARTING_STATE_MANIFEST_PATH, startingManifest);
  upsertAsset(manifest, { id: 'asset:europe-1935-benchmark:politics-bundle', kind: 'other', path: 'starting-state/politics-bundle.json', contentAddress: rawSha256(POLITICS_BUNDLE_PATH), mediaType: 'application/json', required: true });
  upsertAsset(manifest, { id: 'asset:europe-1935-benchmark:starting-state-manifest', kind: 'other', path: 'starting-state/starting-state-manifest.json', contentAddress: rawSha256(STARTING_STATE_MANIFEST_PATH), mediaType: 'application/json', required: true });
  writeJson(MANIFEST_PATH, manifest);
  process.stdout.write(`${JSON.stringify({ status: startingManifest.status, projectionChecksum: result.projectionChecksum, firstMonthChecksum: result.firstMonth.checksum, provenanceRows: result.authoring.startingStateProvenance.length }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
