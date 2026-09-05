import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url));
const sort = (values) => [...values].sort((a, b) => a.localeCompare(b));
const sortedRecord = (record) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonicalize(entry)]))
    : value;
const canonicalStringify = (value) => JSON.stringify(canonicalize(value));
const checksum = (value) => `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonicalStringify(value), 'utf8').digest('hex')}`;
const evidenceChecksum = (value) => {
  const normalize = (entry) => Array.isArray(entry)
    ? entry.map(normalize).sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)))
    : entry && typeof entry === 'object'
      ? Object.fromEntries(Object.entries(entry).map(([key, nested]) => [key, normalize(nested)]))
      : entry;
  return checksum(normalize(value));
};
const pointerToken = (value) => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
const atPointer = (root, pointer) => pointer.slice(1).split('/').reduce((value, token) => value[token.replace(/~1/g, '/').replace(/~0/g, '~')], root);
const slug = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const sourceRows = [
  ['source:meso1450:met-triple-alliance', 'The Metropolitan Museum of Art — Mexico, 1400–1600 A.D.', 'https://www.metmuseum.org/toah/ht/08/canm.html'],
  ['source:meso1450:cambridge-altepetl', 'Cambridge University Press — altepetl and political-economic organization excerpt', 'https://assets.cambridge.org/97810093/68094/excerpt/9781009368094_excerpt.pdf'],
  ['source:meso1450:cambridge-economic-world', 'Cambridge University Press — The Aztec Economic World excerpt', 'https://assets.cambridge.org/97811071/42770/excerpt/9781107142770_excerpt.pdf'],
  ['source:meso1450:inah-tlatelolco', 'INAH — Zona arqueológica de Tlatelolco', 'https://lugares.inah.gob.mx/es/mundial/6438'],
  ['source:meso1450:inah-tlaxcallan', 'INAH — Tlaxcala de Xicohténcatl', 'https://lugares.inah.gob.mx/es/node/4818'],
  ['source:meso1450:inah-tzintzuntzan', 'INAH — Tzintzuntzan', 'https://lugares.inah.gob.mx/es/node/4481'],
  ['source:meso1450:inah-ihuatzio', 'INAH — Ihuatzio', 'https://lugares.inah.gob.mx/es/node/4418'],
  ['source:meso1450:inah-tututepec', 'INAH — Códice de Tututepec', 'https://www.codices.inah.gob.mx/movil/contenido.php?id=11'],
  ['source:meso1450:inah-matricula', 'INAH — Matrícula de Tributos', 'https://www.codices.inah.gob.mx/pc/contenido.php?id=54'],
  ['source:meso1450:bodleian-mendoza', 'Bodleian Libraries — Codex Mendoza', 'https://digital.bodleian.ox.ac.uk/objects/2fea788e-2aa2-4f08-b6d9-648c00486220/'],
  ['source:meso1450:inah-population-uncertainty', 'INAH repository — Mexico: From the Olmecs to the Aztecs (demographic uncertainty)', 'https://deas.inah.gob.mx/pdf/biblioteca/repositorio/repositorio%2821040%29-4563.pdf'],
];
const sources = Object.fromEntries(sourceRows.map(([id, title, locator]) => [id, { id, title, locator, checksum: checksum({ title, locator }) }]));

const activePolities = [
  ['polity:tenochtitlan', 'Mexico-Tenochtitlan', '#2f7d32'],
  ['polity:texcoco', 'Tetzcoco', '#567d46'],
  ['polity:tlacopan', 'Tlacopan', '#826b36'],
  ['polity:tlatelolco', 'Mexico-Tlatelolco', '#755037'],
  ['polity:tlaxcallan', 'Tlaxcallan', '#a13d3d'],
  ['polity:purepecha', 'Purépecha state', '#4b4f8c'],
  ['polity:cholollan', 'Cholollan', '#b0762d'],
  ['polity:chalco', 'Chalco', '#4b83a6'],
  ['polity:huexotzinco', 'Huexotzinco', '#8d5a91'],
  ['polity:tututepec', 'Yucu Dzaa (Tututepec)', '#176b68'],
];
const supportedPolities = [
  ['polity:xochimilco', 'Xochimilco'], ['polity:azcapotzalco', 'Azcapotzalco'],
  ['polity:cuauhtitlan', 'Cuauhtitlan'], ['polity:tepeaca', 'Tepeaca'],
  ['polity:cuauhtinchan', 'Cuauhtinchan'], ['polity:cuauhnahuac', 'Cuauhnahuac'],
  ['polity:yautepec', 'Yauhtepec'], ['polity:coixtlahuaca', 'Coixtlahuaca'],
  ['polity:tilantongo', 'Tilantongo'], ['polity:tlaxiaco', 'Tlaxiaco'],
  ['polity:teozacoalco', 'Teozacoalco'], ['polity:nochistlan', 'Nochistlan'],
  ['polity:yanhuitlan', 'Yanhuitlan'], ['polity:huajuapan', 'Huajuapan'],
  ['polity:tochtepec', 'Tochtepec corridor'], ['polity:soconusco', 'Soconusco corridor'],
].map(([id, name], index) => [id, name, `#${(0x354c55 + index * 0x050909).toString(16).slice(-6)}`]);

const regionRows = [
  // Mexican Basin (12)
  ['tenochtitlan', 'Mexico-Tenochtitlan', 'polity:tenochtitlan'], ['tlatelolco', 'Mexico-Tlatelolco', 'polity:tlatelolco'],
  ['texcoco', 'Tetzcoco', 'polity:texcoco'], ['tlacopan', 'Tlacopan', 'polity:tlacopan'],
  ['xochimilco', 'Xochimilco', 'polity:xochimilco'], ['culhuacan', 'Culhuacan', 'polity:tenochtitlan'],
  ['coyoacan', 'Coyoacan', 'polity:tlacopan'], ['azcapotzalco', 'Azcapotzalco', 'polity:azcapotzalco'],
  ['cuauhtitlan', 'Cuauhtitlan', 'polity:cuauhtitlan'], ['otompan', 'Otompan', 'polity:texcoco'],
  ['teotihuacan', 'Teotihuacan', 'polity:texcoco'], ['acolman', 'Acolman', 'polity:texcoco'],
  // Puebla–Tlaxcala (8)
  ['tepeticpac', 'Tepeticpac', 'polity:tlaxcallan'], ['ocotelulco', 'Ocotelulco', 'polity:tlaxcallan'],
  ['quiahuiztlan', 'Quiahuiztlan', 'polity:tlaxcallan'], ['tizatlan', 'Tizatlan', 'polity:tlaxcallan'],
  ['cholollan', 'Cholollan', 'polity:cholollan'], ['huexotzinco', 'Huexotzinco', 'polity:huexotzinco'],
  ['tepeaca', 'Tepeaca', 'polity:tepeaca'], ['cuauhtinchan', 'Cuauhtinchan', 'polity:cuauhtinchan'],
  // Chalco, Morelos and eastern frontier (6)
  ['chalco', 'Chalco', 'polity:chalco'], ['amecameca', 'Amecameca', 'polity:chalco'],
  ['cuauhnahuac', 'Cuauhnahuac', 'polity:cuauhnahuac'], ['yautepec', 'Yauhtepec', 'polity:yautepec'],
  ['huaxtepec', 'Huaxtepec', 'polity:yautepec'], ['tlayacapan', 'Tlayacapan', 'polity:chalco'],
  // Purépecha and western frontier (8)
  ['tzintzuntzan', 'Tzintzuntzan', 'polity:purepecha'], ['patzcuaro', 'Pátzcuaro', 'polity:purepecha'],
  ['ihuatzio', 'Ihuatzio', 'polity:purepecha'], ['uruapan', 'Uruapan', 'polity:purepecha'],
  ['zacapu', 'Zacapu', 'polity:purepecha'], ['cuitzeo', 'Cuitzeo', 'polity:purepecha'],
  ['ucareo-zinapecuaro', 'Ucareo–Zinapécuaro', 'polity:purepecha'], ['balsas-frontier', 'Balsas frontier', 'polity:purepecha'],
  // Mixteca and Oaxaca (8)
  ['tututepec', 'Yucu Dzaa (Tututepec)', 'polity:tututepec'], ['coixtlahuaca', 'Coixtlahuaca', 'polity:coixtlahuaca'],
  ['tilantongo', 'Tilantongo', 'polity:tilantongo'], ['tlaxiaco', 'Tlaxiaco', 'polity:tlaxiaco'],
  ['teozacoalco', 'Teozacoalco', 'polity:teozacoalco'], ['nochistlan', 'Nochistlan', 'polity:nochistlan'],
  ['yanhuitlan', 'Yanhuitlan', 'polity:yanhuitlan'], ['huajuapan', 'Huajuapan', 'polity:huajuapan'],
  // External exchange corridors (2)
  ['tochtepec-corridor', 'Tochtepec exchange corridor', 'polity:tochtepec'], ['soconusco-corridor', 'Soconusco exchange corridor', 'polity:soconusco'],
];

// These central estimates are playable simulation controls. They are deliberately
// lower-confidence than the structural records and must never be presented as an exact census.
const polityPopulationControls = {
  'polity:tenochtitlan': 160_000, 'polity:texcoco': 180_000, 'polity:tlacopan': 90_000,
  'polity:tlatelolco': 70_000, 'polity:tlaxcallan': 300_000, 'polity:purepecha': 900_000,
  'polity:cholollan': 100_000, 'polity:chalco': 180_000, 'polity:huexotzinco': 90_000,
  'polity:tututepec': 150_000, 'polity:xochimilco': 100_000, 'polity:azcapotzalco': 40_000,
  'polity:cuauhtitlan': 60_000, 'polity:tepeaca': 80_000, 'polity:cuauhtinchan': 40_000,
  'polity:cuauhnahuac': 100_000, 'polity:yautepec': 100_000, 'polity:coixtlahuaca': 80_000,
  'polity:tilantongo': 50_000, 'polity:tlaxiaco': 50_000, 'polity:teozacoalco': 50_000,
  'polity:nochistlan': 40_000, 'polity:yanhuitlan': 50_000, 'polity:huajuapan': 50_000,
  'polity:tochtepec': 25_000, 'polity:soconusco': 25_000,
};
const populationWeight = (name) => /Tenochtitlan|Tetzcoco|Tzintzuntzan|Ocotelulco|Chalco|Tututepec/i.test(name) ? 150
  : /frontier|corridor|Teotihuacan/i.test(name) ? 55 : 100;
const allocateLargestRemainder = (total, entries) => {
  const denominator = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const rows = entries.map((entry, index) => {
    const exact = total * entry.weight / denominator;
    return { ...entry, index, value: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = total - rows.reduce((sum, row) => sum + row.value, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining === 0) break;
    row.value += 1;
    remaining -= 1;
  }
  return Object.fromEntries(rows.map((row) => [row.id, row.value]));
};

const lowUnknown = (sourceIds, method, todo) => ({
  kind: 'historical', sourceIds: sort(sourceIds), observationDate: '1450-01-01', method, confidence: 'low', todo,
});
const structural = (sourceIds, method, observationDate = '1450-01-01') => ({
  kind: 'historical', sourceIds: sort(sourceIds), observationDate, method, confidence: 'medium',
});

const scenario = {
  schemaVersion: 'open-historia-scenario/3',
  id: 'scenario:central-mesoamerica-1450',
  profile: 'historical',
  metadata: {
    title: { en: 'Central Mesoamerica, 1450', ru: 'Центральная Мезоамерика, 1450' },
    description: { en: 'Tributary, city-polity and ecological networks at the 1450 boundary; material quantities are playable low-confidence estimates rather than exact census claims.', ru: 'Дань, города-политии и экологические сети на начало 1450 года; материальные величины — игровые оценки с низкой уверенностью, а не точная перепись.' },
  },
  game: {
    startDate: '1450-01-01', defaultPlayerPolityId: 'polity:tenochtitlan',
    playerEligiblePolityIds: activePolities.map(([id]) => id),
  },
  worldRules: {
    physicalModel: 'world-model:mesoamerican-ecology',
    knowledgeBaseline: ['concept:altepetl-governance', 'concept:tribute-accounting', 'concept:market-exchange', 'concept:pictorial-records'],
    communicationModel: 'world-model:runner-canoe-portage',
    governmentModel: 'world-model:altepetl-dynastic-authority',
    militaryModel: 'world-model:household-levy-and-obligation',
    hardProhibitions: ['No command may create an unsupported past event or exact unknown quantity.'],
    plausibilityContext: [
      'Authority is local and dynastic; tribute receipt does not itself transfer land or direct administration.',
      'Military service depends on households, allied obligations, provisions, porters, route access, distance and season.',
      'No overseas contact is a required or scheduled outcome.',
    ],
  },
  modules: { enabled: ['module:population', 'module:tribute', 'module:local-production', 'module:institutions', 'module:knowledge', 'module:identity', 'module:military'] },
  catalogs: {
    modules: Object.fromEntries(['population', 'tribute', 'local-production', 'institutions', 'knowledge', 'identity', 'military'].map((kind) => [`module:${kind}`, { id: `module:${kind}`, kind }])),
    worldModels: {
      'world-model:mesoamerican-ecology': { id: 'world-model:mesoamerican-ecology', kind: 'physical' },
      'world-model:runner-canoe-portage': { id: 'world-model:runner-canoe-portage', kind: 'communication' },
      'world-model:altepetl-dynastic-authority': { id: 'world-model:altepetl-dynastic-authority', kind: 'government' },
      'world-model:household-levy-and-obligation': { id: 'world-model:household-levy-and-obligation', kind: 'military' },
    },
    commodities: Object.fromEntries([
      ['maize', 'both'], ['food-basket', 'both'], ['obsidian', 'both'], ['cotton', 'both'], ['cacao', 'both'],
      ['timber', 'both'], ['stone', 'both'], ['clay', 'both'], ['salt', 'both'], ['maguey-fiber', 'both'],
      ['mantles', 'stockpile'], ['pottery', 'stockpile'], ['paper', 'stockpile'], ['feathers', 'both'],
      ['copal', 'both'], ['shell', 'both'], ['greenstone', 'both'], ['gold', 'both'], ['copper', 'both'],
      ['weapons', 'stockpile'], ['shields', 'stockpile'], ['cotton-armour', 'stockpile'], ['provisions', 'stockpile'],
    ].map(([name, usage]) => [`commodity:${name}`, { id: `commodity:${name}`, unitId: 'unit:abstract-capacity', usage }])),
    activities: Object.fromEntries([
      ['rainfed-agriculture', [], ['commodity:maize', 'commodity:food-basket']],
      ['chinampa-agriculture', [], ['commodity:maize', 'commodity:food-basket']],
      ['obsidian-blade-craft', ['commodity:obsidian'], ['commodity:weapons']],
      ['cotton-weaving', ['commodity:cotton'], ['commodity:mantles', 'commodity:cotton-armour']],
      ['maguey-weaving', ['commodity:maguey-fiber'], ['commodity:mantles']],
      ['pottery-craft', ['commodity:clay'], ['commodity:pottery']],
      ['stone-craft', ['commodity:stone'], ['commodity:stone']],
      ['paper-craft', [], ['commodity:paper']],
      ['feather-lapidary-craft', ['commodity:feathers', 'commodity:greenstone', 'commodity:shell'], ['commodity:mantles']],
      ['western-copper-working', ['commodity:copper'], ['commodity:weapons']],
      ['provision-preparation', ['commodity:maize', 'commodity:food-basket'], ['commodity:provisions']],
    ].map(([id, inputCommodityIds, outputCommodityIds]) => [`activity:${id}`, { id: `activity:${id}`, inputCommodityIds, outputCommodityIds }])),
    recipes: {},
    institutionTypes: Object.fromEntries(['altepetl', 'nuu', 'purepecha-polity', 'calpolli', 'tlaxilacalli', 'dynastic-house', 'tribute-collectors', 'pochteca-market-authority', 'temple-priesthood', 'telpochcalli', 'calmecac', 'tlaxcallan-four-centers', 'uacusecha-authority'].map((name) => [`institution-type:${name}`, { id: `institution-type:${name}` }])),
    officeTypes: Object.fromEntries(['tlatoani', 'cihuacoatl', 'council-speaker', 'tribute-collector', 'market-judge', 'irecha-cazonci'].map((name) => [`office-type:${name}`, { id: `office-type:${name}` }])),
    formationArchetypes: {
      'formation-archetype:household-levy': { id: 'formation-archetype:household-levy', equipmentClassIds: ['equipment-class:projectile-and-close-weapons', 'equipment-class:shields', 'equipment-class:cotton-armour', 'equipment-class:provisions-and-porters'] },
      'formation-archetype:elite-retinue': { id: 'formation-archetype:elite-retinue', equipmentClassIds: ['equipment-class:projectile-and-close-weapons', 'equipment-class:shields', 'equipment-class:cotton-armour', 'equipment-class:provisions-and-porters'] },
      'formation-archetype:tributary-contingent': { id: 'formation-archetype:tributary-contingent', equipmentClassIds: ['equipment-class:projectile-and-close-weapons', 'equipment-class:shields', 'equipment-class:cotton-armour', 'equipment-class:provisions-and-porters'] },
    },
    equipmentClasses: Object.fromEntries(['projectile-and-close-weapons', 'shields', 'cotton-armour', 'provisions-and-porters'].map((name) => [`equipment-class:${name}`, { id: `equipment-class:${name}` }])),
    financeProfiles: { 'finance-profile:tribute-and-domain': { id: 'finance-profile:tribute-and-domain', revenueChannelIds: ['revenue-channel:tribute-goods', 'revenue-channel:labor-service', 'revenue-channel:market-dues', 'revenue-channel:domain-production'], instrumentIds: [] } },
    revenueChannels: Object.fromEntries(['tribute-goods', 'labor-service', 'market-dues', 'domain-production'].map((name) => [`revenue-channel:${name}`, { id: `revenue-channel:${name}` }])),
    financeInstruments: {},
    controlProfiles: {
      'control-profile:sovereign-altepetl': { id: 'control-profile:sovereign-altepetl', kind: 'sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 },
      'control-profile:indirect-tributary': { id: 'control-profile:indirect-tributary', kind: 'indirect', administrationAccessBp: 0, extractionAccessBp: 0, recruitmentAccessBp: 0, integrationBp: 0 },
    },
    relationshipTypes: Object.fromEntries(['tribute-alliance', 'tribute-obligation', 'shared-war-obligation', 'active-conflict', 'dynastic-relation', 'market-access'].map((name) => [`relationship-type:${name}`, { id: `relationship-type:${name}` }])),
    routeClasses: Object.fromEntries(['canoe', 'road-portage', 'runner-relay', 'long-distance-market'].map((name) => [`route-class:${name}`, { id: `route-class:${name}` }])),
    terminology: {
      'term:polity': { en: 'altepetl / ñuu / polity', ru: 'альтепетль / ньуу / полития' },
      'term:revenue': { en: 'tribute and domain receipts', ru: 'дань и домениальные поступления' },
      'term:formation': { en: 'levy or obligated contingent', ru: 'ополчение или обязанный контингент' },
      'term:transport': { en: 'canoe, porter and runner capacity', ru: 'каноэ, носильщики и гонцы' },
    },
  },
  geography: { assets: {}, regions: {} },
  startingState: { polities: {}, regions: {}, populationCohorts: {}, formations: {}, institutions: {}, relationships: {}, diplomaticProposals: {}, tributeObligations: {}, routes: {}, concepts: {}, knowledge: {} },
  provenance: { sources: sortedRecord(sources), evidence: {} },
};

const addEvidence = (id, path, basis, visibility = 'public', visibleToPolityIds) => {
  scenario.provenance.evidence[id] = {
    id, binding: { path, valueChecksum: `sha256:${'0'.repeat(64)}` }, basis, visibility,
    ...(visibleToPolityIds ? { visibleToPolityIds } : {}),
  };
};

const activePolityIdsForDecisions = new Set(activePolities.map(([id]) => id));
for (const [id, displayName, color] of [...activePolities, ...supportedPolities]) {
  const evidenceId = `evidence:meso1450-polity-${slug(id.slice(7))}`;
  scenario.startingState.polities[id] = { id, displayName: { en: displayName }, color, decisionMode: activePolityIdsForDecisions.has(id) ? 'active' : 'supported', treasury: 0, stockpiles: {}, evidenceIds: [evidenceId] };
  const specialized = id === 'polity:tlatelolco' ? ['source:meso1450:inah-tlatelolco']
    : id === 'polity:tlaxcallan' ? ['source:meso1450:inah-tlaxcallan']
      : id === 'polity:purepecha' ? ['source:meso1450:inah-tzintzuntzan', 'source:meso1450:inah-ihuatzio']
        : id === 'polity:tututepec' ? ['source:meso1450:inah-tututepec']
          : ['source:meso1450:cambridge-economic-world'];
  addEvidence(evidenceId, `/startingState/polities/${pointerToken(id)}`, lowUnknown(specialized, 'The source identifies the named political community or regional polity. Treasury and stockpiles are deterministic balance estimates derived from represented population and local productive capacity, not modern national accounts.', 'Replace the central balance estimates with reviewed polity-specific tribute, stores and production reconstructions where available.'));
}

const regionsByOwner = Object.fromEntries([...activePolities, ...supportedPolities].map(([id]) => [id, regionRows.filter((row) => row[2] === id)]));
const regionPopulation = {};
for (const [owner, ownedRows] of Object.entries(regionsByOwner)) {
  Object.assign(regionPopulation, allocateLargestRemainder(polityPopulationControls[owner], ownedRows.map(([slugName, displayName]) => ({ id: `region:meso1450:${slugName}`, weight: populationWeight(displayName) }))));
}
const adjacency = new Map(regionRows.map(([slugName]) => [`region:meso1450:${slugName}`, new Set()]));
const connect = (left, right) => {
  const a = `region:meso1450:${left}`;
  const b = `region:meso1450:${right}`;
  adjacency.get(a).add(b);
  adjacency.get(b).add(a);
};
for (const [start, end] of [[0, 12], [12, 20], [20, 26], [26, 34], [34, 42], [42, 44]]) {
  const cluster = regionRows.slice(start, end).map(([name]) => name);
  cluster.slice(1).forEach((name, index) => connect(cluster[index], name));
  if (cluster.length > 2) connect(cluster[0], cluster.at(-1));
}
[
  ['tenochtitlan', 'tepeticpac'], ['xochimilco', 'chalco'], ['culhuacan', 'cuauhnahuac'],
  ['cholollan', 'chalco'], ['huexotzinco', 'tzintzuntzan'], ['balsas-frontier', 'tututepec'],
  ['coixtlahuaca', 'tochtepec-corridor'], ['tututepec', 'soconusco-corridor'],
].forEach(([left, right]) => connect(left, right));

for (const [slugName, displayName, owner] of regionRows) {
  const id = `region:meso1450:${slugName}`;
  const evidenceId = `evidence:meso1450-region-${slugName}`;
  const cohortId = `cohort:meso1450-${slugName}`;
  const cohortEvidenceId = `evidence:meso1450-cohort-${slugName}`;
  const population = regionPopulation[id];
  const resources = {
    'commodity:maize': Math.max(1, Math.floor(population / 30)),
    'commodity:food-basket': Math.max(1, Math.floor(population / 60)),
    'commodity:timber': Math.max(1, Math.floor(population / 200)),
    'commodity:stone': Math.max(1, Math.floor(population / 250)),
    'commodity:clay': Math.max(1, Math.floor(population / 300)),
  };
  if (/tenochtitlan|tlatelolco|xochimilco|culhuacan|coyoacan|chalco/i.test(slugName)) resources['commodity:maize'] += Math.max(1, Math.floor(population / 50));
  if (/otompan|teotihuacan|ucareo|zinapecuaro/i.test(slugName)) resources['commodity:obsidian'] = Math.max(1, Math.floor(population / 500));
  if (/morelos|cuauhnahuac|yautepec|huaxtepec|tututepec|soconusco/i.test(`${slugName} ${displayName}`)) resources['commodity:cotton'] = Math.max(1, Math.floor(population / 400));
  if (/tututepec|tochtepec|soconusco/i.test(slugName)) resources['commodity:cacao'] = Math.max(1, Math.floor(population / 800));
  if (owner === 'polity:purepecha') resources['commodity:copper'] = Math.max(1, Math.floor(population / 1000));
  scenario.startingState.regions[id] = {
    id, displayName: { en: displayName }, legalOwnerPolityId: owner, actualControllerPolityId: owner,
    controlProfileId: 'control-profile:sovereign-altepetl', fiscalBase: Math.max(1, Math.floor(population / 200)),
    productiveCapacity: Math.max(1, Math.floor(population / 100)),
    supplyCapacity: Math.max(1, Math.floor(population / 80)), resources, evidenceIds: [evidenceId],
  };
  scenario.geography.regions[id] = {
    id, link: { kind: 'off-map', reason: 'Historical locality is retained without fabricating a precise 1450 polygon.' }, adjacentRegionIds: sort(adjacency.get(id)),
  };
  scenario.startingState.populationCohorts[cohortId] = {
    id: cohortId, regionId: id, population, workforceParticipationBp: 5500, recruitmentEligibilityBp: 1000,
    evidenceIds: [cohortEvidenceId],
  };
  const regionSources = owner === 'polity:purepecha' ? ['source:meso1450:inah-tzintzuntzan', 'source:meso1450:inah-ihuatzio']
    : owner === 'polity:tlaxcallan' ? ['source:meso1450:inah-tlaxcallan']
      : owner === 'polity:tututepec' ? ['source:meso1450:inah-tututepec']
        : ['source:meso1450:cambridge-economic-world'];
  addEvidence(evidenceId, `/startingState/regions/${pointerToken(id)}`, lowUnknown(regionSources, 'The locality is a sourced strategic altepetl, center, frontier, or ecological cluster. Capacity and resource integers are transparent functions of the population control plus sourced ecological specialization.', 'Research a date-appropriate boundary, local production inventory and relative capacity before replacing these balance controls.'));
  addEvidence(cohortEvidenceId, `/startingState/populationCohorts/${pointerToken(cohortId)}`, lowUnknown([...regionSources, 'source:meso1450:inah-population-uncertainty'], 'Population is a deliberately conservative polity-scale control allocated by declared center/frontier weights. The INAH source documents very wide demographic uncertainty; workforce (55%) and recruitment eligibility (10%) are balance assumptions.', 'Replace central controls with a reviewed settlement and household reconstruction carrying an interval and explicit 1450 adjustment.'));
}

for (const [polityId] of [...activePolities, ...supportedPolities]) {
  const owned = regionsByOwner[polityId].map(([slugName]) => scenario.startingState.regions[`region:meso1450:${slugName}`]);
  const fiscalBase = owned.reduce((sum, region) => sum + region.fiscalBase, 0);
  const population = polityPopulationControls[polityId];
  scenario.startingState.polities[polityId].treasury = fiscalBase * 4;
  scenario.startingState.polities[polityId].stockpiles = {
    'commodity:maize': Math.max(1, Math.floor(population / 18)),
    'commodity:provisions': Math.max(1, Math.floor(population / 35)),
    'commodity:weapons': Math.max(1, Math.floor(population / 180)),
    'commodity:shields': Math.max(1, Math.floor(population / 220)),
  };
}

const activePolityIds = new Set(activePolities.map(([id]) => id));
const multiFormationPolities = new Set(['polity:tenochtitlan', 'polity:texcoco', 'polity:tlaxcallan', 'polity:purepecha']);
for (const [polityId] of [...activePolities, ...supportedPolities]) {
  const count = multiFormationPolities.has(polityId) ? 2 : 1;
  const totalPersonnel = Math.max(300, Math.floor(polityPopulationControls[polityId] * (activePolityIds.has(polityId) ? 0.012 : 0.006)));
  const formationTotals = allocateLargestRemainder(totalPersonnel, Array.from({ length: count }, (_, index) => ({ id: String(index + 1), weight: 1 })));
  const ownedRegions = regionsByOwner[polityId].map(([slugName]) => `region:meso1450:${slugName}`);
  for (let index = 0; index < count; index += 1) {
    const ordinal = index + 1;
    const personnel = formationTotals[String(ordinal)];
    const id = `formation:meso1450-${polityId.slice(7)}-${ordinal}`;
    const evidenceId = `evidence:meso1450-${slug(id)}`;
    scenario.startingState.formations[id] = {
      id,
      polityId,
      archetypeId: activePolityIds.has(polityId)
        ? index === 0 ? 'formation-archetype:household-levy' : 'formation-archetype:elite-retinue'
        : 'formation-archetype:tributary-contingent',
      personnelOrigins: allocateLargestRemainder(personnel, ownedRegions.map((regionId) => ({ id: regionId, weight: regionPopulation[regionId] }))),
      equipment: {
        'equipment-class:projectile-and-close-weapons': Math.max(1, Math.floor(personnel * 0.82)),
        'equipment-class:shields': Math.max(1, Math.floor(personnel * 0.68)),
        'equipment-class:cotton-armour': Math.max(1, Math.floor(personnel * (activePolityIds.has(polityId) ? 0.22 : 0.12))),
        'equipment-class:provisions-and-porters': Math.max(1, Math.floor(personnel * 0.35)),
      },
      evidenceIds: [evidenceId],
    };
    addEvidence(evidenceId, `/startingState/formations/${pointerToken(id)}`, lowUnknown(
      ['source:meso1450:cambridge-altepetl', 'source:meso1450:cambridge-economic-world'],
      'Aggregate household levy or obligated contingent derived from represented population (1.2% for active strategic subjects, 0.6% for supported subjects). Personnel origins preserve local recruitment; equipment ratios are explicit balance assumptions.',
      'Replace force shares, elite composition, equipment and porter ratios with polity-specific military and tribute research.',
    ));
  }
}

const institutionRows = [
  ['institution:tenochtitlan-altepetl', 'institution-type:altepetl', 'polity:tenochtitlan', 'region:meso1450:tenochtitlan'],
  ['institution:tlatelolco-altepetl', 'institution-type:altepetl', 'polity:tlatelolco', 'region:meso1450:tlatelolco'],
  ['institution:texcoco-altepetl', 'institution-type:altepetl', 'polity:texcoco', 'region:meso1450:texcoco'],
  ['institution:tlacopan-altepetl', 'institution-type:altepetl', 'polity:tlacopan', 'region:meso1450:tlacopan'],
  ['institution:tlaxcallan-four-centers', 'institution-type:tlaxcallan-four-centers', 'polity:tlaxcallan', undefined],
  ['institution:purepecha-uacusecha', 'institution-type:uacusecha-authority', 'polity:purepecha', 'region:meso1450:tzintzuntzan'],
  ['institution:tututepec-nuu', 'institution-type:nuu', 'polity:tututepec', 'region:meso1450:tututepec'],
  ['institution:tenochtitlan-pochteca', 'institution-type:pochteca-market-authority', 'polity:tenochtitlan', 'region:meso1450:tenochtitlan'],
  ['institution:tlatelolco-market', 'institution-type:pochteca-market-authority', 'polity:tlatelolco', 'region:meso1450:tlatelolco'],
];
for (const [id, typeId, polityId, regionId] of institutionRows) {
  const evidenceId = `evidence:meso1450-${slug(id)}`;
  scenario.startingState.institutions[id] = { id, typeId, polityId, ...(regionId ? { regionId } : {}), evidenceIds: [evidenceId] };
  const sourceIds = id.includes('tlaxcallan') ? ['source:meso1450:inah-tlaxcallan']
    : id.includes('purepecha') ? ['source:meso1450:inah-tzintzuntzan', 'source:meso1450:inah-ihuatzio']
      : id.includes('tututepec') ? ['source:meso1450:inah-tututepec']
        : id.includes('tlatelolco') ? ['source:meso1450:inah-tlatelolco']
          : ['source:meso1450:cambridge-altepetl', 'source:meso1450:cambridge-economic-world'];
  addEvidence(evidenceId, `/startingState/institutions/${pointerToken(id)}`, structural(sourceIds, 'Direct structural representation of a sourced local political, dynastic, market, or confederal institution; no modern office is inferred.'));
}

const relationshipRows = [
  ['relationship:triple-alliance', 'relationship-type:tribute-alliance', ['polity:tenochtitlan', 'polity:texcoco', 'polity:tlacopan'], ['source:meso1450:met-triple-alliance', 'source:meso1450:cambridge-economic-world'], 'Represent the Triple Alliance as three participant polities; beneficiary shares and delivery quantities remain unknown.'],
  ['relationship:triple-alliance-shared-war', 'relationship-type:shared-war-obligation', ['polity:tenochtitlan', 'polity:texcoco', 'polity:tlacopan'], ['source:meso1450:met-triple-alliance'], 'Represent sourced joint military action as an obligation separate from land control.'],
  ['relationship:chalco-conflict', 'relationship-type:active-conflict', ['polity:tenochtitlan', 'polity:chalco'], ['source:meso1450:cambridge-altepetl'], 'Represent the conflictual relationship without scripting its outcome or changing control.'],
  ['relationship:tlaxcallan-independent-conflict', 'relationship-type:active-conflict', ['polity:tenochtitlan', 'polity:tlaxcallan'], ['source:meso1450:inah-tlaxcallan'], 'Represent Tlaxcallan independence and conflict without inventing a unitary internal state.'],
];
for (const [id, typeId, participantPolityIds, sourceIds, method] of relationshipRows) {
  const evidenceId = `evidence:meso1450-${slug(id)}`;
  scenario.startingState.relationships[id] = { id, typeId, participantPolityIds, evidenceIds: [evidenceId] };
  addEvidence(evidenceId, `/startingState/relationships/${pointerToken(id)}`, structural(sourceIds, method));
}

const routeRows = [
  ['route:lake-texcoco-canoe', 'route-class:canoe', ['tenochtitlan', 'tlatelolco', 'tlacopan', 'texcoco', 'xochimilco'], ['commodity:maize', 'commodity:food-basket', 'commodity:mantles', 'commodity:obsidian']],
  ['route:puebla-tlaxcala-portage', 'route-class:road-portage', ['cholollan', 'huexotzinco', 'ocotelulco', 'tepeaca'], ['commodity:maize', 'commodity:mantles', 'commodity:obsidian', 'commodity:salt']],
  ['route:western-exchange', 'route-class:long-distance-market', ['tzintzuntzan', 'ucareo-zinapecuaro', 'balsas-frontier'], ['commodity:copper', 'commodity:cotton', 'commodity:cacao', 'commodity:feathers', 'commodity:obsidian']],
  ['route:southern-exchange', 'route-class:long-distance-market', ['coixtlahuaca', 'tututepec', 'soconusco-corridor'], ['commodity:cacao', 'commodity:cotton', 'commodity:feathers', 'commodity:shell', 'commodity:gold']],
];
for (const [id, classId, regionSlugs, allowedCommodityIds] of routeRows) {
  const evidenceId = `evidence:meso1450-${slug(id)}`;
  scenario.startingState.routes[id] = { id, classId, regionIds: regionSlugs.map((name) => `region:meso1450:${name}`), allowedCommodityIds, evidenceIds: [evidenceId] };
  addEvidence(evidenceId, `/startingState/routes/${pointerToken(id)}`, lowUnknown(['source:meso1450:cambridge-economic-world', 'source:meso1450:inah-tlatelolco'], 'The route represents a sourced exchange mode and connected named centers; capacity, cadence and exact 1450 itinerary remain unasserted.', 'Review archaeology and route scholarship before adding capacity, exact path, seasonality or delivery quantities.'));
}

// This is one explicit, low-confidence playable obligation—not a universal
// Triple Alliance formula. Later tribute manuscripts inform the vocabulary;
// every integer remains a visible balance assumption bound to its evidence.
const tributeId = 'obligation:xochimilco-triple-alliance';
const tributeEvidenceId = 'evidence:meso1450-obligation-xochimilco-triple-alliance';
scenario.startingState.tributeObligations[tributeId] = {
  id: tributeId,
  payerPolityIds: ['polity:xochimilco'],
  sourceRegionIds: ['region:meso1450:xochimilco'],
  beneficiaries: [
    { polityId: 'polity:tenochtitlan', shareBp: 5000 },
    { polityId: 'polity:texcoco', shareBp: 3000 },
    { polityId: 'polity:tlacopan', shareBp: 2000 },
  ],
  deliveries: [{ commodityId: 'commodity:maize', quantity: 300 }],
  laborService: { people: 120 },
  militaryService: { personnel: 80 },
  routeIds: ['route:lake-texcoco-canoe'],
  // The runtime settles at monthly boundaries; this is a simulation cadence,
  // not a claim about an exact historical itinerary.
  cadence: 'monthly',
  arrears: [],
  complianceBp: 7000,
  enforcementBasisId: 'relationship:triple-alliance',
  evidenceIds: [tributeEvidenceId],
};
addEvidence(
  tributeEvidenceId,
  `/startingState/tributeObligations/${pointerToken(tributeId)}`,
  lowUnknown(
    ['source:meso1450:met-triple-alliance', 'source:meso1450:inah-matricula', 'source:meso1450:bodleian-mendoza'],
    'A single scenario-specific Xochimilco obligation demonstrates conserved maize, labor and military service. The beneficiary shares, delivery quantity, cadence and compliance are explicit gameplay controls; they are not asserted as an exact 1450 schedule or reused as a universal alliance formula.',
    'Replace each modeled delivery, share, cadence and service quantity with obligation-specific evidence after a dedicated tribute-roll audit.',
  ),
);

const conceptRows = [
  ['altepetl-governance', 'institution', 'Altepetl governance', 'Local political-economic authority joining a center, constituent communities, land, labor, dynasty and patron cult.', ['domain:government', 'domain:identity']],
  ['tribute-accounting', 'economic-practice', 'Tribute accounting', 'Recorded obligations in goods, labor and service administered through local political units.', ['domain:tribute', 'domain:administration']],
  ['market-exchange', 'economic-practice', 'Market and long-distance exchange', 'Local markets and specialist merchants connecting ecological zones and political communities.', ['domain:economy', 'domain:communication']],
  ['pictorial-records', 'technology', 'Pictorial records', 'Durable pictorial and calendrical recording practices used for memory, genealogy and obligations.', ['domain:knowledge', 'domain:administration']],
  ['chinampa-cultivation', 'technology', 'Chinampa cultivation', 'Intensive wetland cultivation practiced in suitable lacustrine settings.', ['domain:production', 'domain:ecology']],
  ['canoe-and-porter-logistics', 'technology', 'Canoe and porter logistics', 'Movement of people and goods through canoe routes, roads, portage and relays.', ['domain:communication', 'domain:military']],
  ['obsidian-craft', 'technology', 'Obsidian blade craft', 'Specialist working of obsidian into blades and tools.', ['domain:production', 'domain:military']],
  ['cotton-weaving', 'technology', 'Cotton weaving', 'Production of woven mantles and quilted protective equipment.', ['domain:production', 'domain:tribute']],
  ['western-copper-working', 'technology', 'Western copper working', 'Regional metalworking practices centered in western Mesoamerica.', ['domain:production', 'domain:knowledge']],
];
for (const [name, type, displayName, description, domains] of conceptRows) {
  const id = `concept:${name}`;
  const evidenceId = `evidence:meso1450-${slug(id)}`;
  const originPolity = name === 'western-copper-working' ? 'polity:purepecha' : 'polity:tenochtitlan';
  scenario.startingState.concepts[id] = {
    id, type, semanticKey: name, displayName: { en: displayName }, description: { en: description },
    origin: { originEntityRefs: [originPolity], originMonth: '1450-01-01' }, parentConceptIds: [],
    supportingEvidenceIds: [evidenceId], domains, status: 'institutionalized', maturityBp: 10000,
    diffusion: {}, adoption: { polities: {}, regions: {} }, sourceEvidenceId: evidenceId, evidenceIds: [evidenceId],
  };
  const sourceIds = name === 'western-copper-working' ? ['source:meso1450:inah-tzintzuntzan', 'source:meso1450:inah-ihuatzio']
    : name === 'altepetl-governance' ? ['source:meso1450:cambridge-altepetl']
      : ['source:meso1450:cambridge-economic-world', 'source:meso1450:inah-matricula', 'source:meso1450:bodleian-mendoza'];
  addEvidence(evidenceId, `/startingState/concepts/${pointerToken(id)}`, structural(sourceIds, 'Represent the documented practice as established knowledge while avoiding a universal future catalog. Later tribute manuscripts support vocabulary only, not exact 1450 quantities.'));
}

for (const polityId of activePolities.map(([id]) => id)) {
  for (const conceptId of scenario.worldRules.knowledgeBaseline) {
    const id = `knowledge:${slug(polityId.slice(7))}-${conceptId.slice(8)}`;
    const evidenceId = `evidence:meso1450-${slug(id)}`;
    scenario.startingState.knowledge[id] = { id, polityId, conceptId, evidenceIds: [evidenceId] };
    addEvidence(evidenceId, `/startingState/knowledge/${pointerToken(id)}`, lowUnknown(['source:meso1450:cambridge-altepetl', 'source:meso1450:cambridge-economic-world'], 'Conservative shared baseline limited to political organization, exchange, tribute administration and pictorial recording; local depth is not quantified.', 'Replace broad baseline attribution with polity-specific evidence when a finer-grained source audit is available.'), 'polity', [polityId]);
  }
}

for (const recordName of ['polities', 'regions', 'populationCohorts', 'formations', 'institutions', 'relationships', 'tributeObligations', 'routes', 'concepts', 'knowledge']) {
  scenario.startingState[recordName] = sortedRecord(scenario.startingState[recordName]);
}
scenario.geography.regions = sortedRecord(scenario.geography.regions);
scenario.provenance.evidence = sortedRecord(scenario.provenance.evidence);
for (const evidence of Object.values(scenario.provenance.evidence)) evidence.binding.valueChecksum = evidenceChecksum(atPointer(scenario, evidence.binding.path));

const writeJson = async (relativePath, value) => {
  const path = resolve(packageDir, relativePath);
  await mkdir(dirname(path), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text, 'utf8');
  return { path: relativePath, checksum: checksum(text) };
};

const files = [];
files.push(await writeJson('scenario.json', scenario));
files.push(await writeJson('sources.json', Object.values(scenario.provenance.sources)));
files.push(await writeJson('authoring.json', {
  historicalBoundary: '1450-01-01',
  quantitativePolicy: 'modeled-central-estimates-with-low-confidence-provenance',
  modeledNumericFields: ['population', 'workforce participation', 'recruitment eligibility', 'treasury', 'stockpiles', 'fiscal base', 'productive capacity', 'supply capacity', 'formation strength', 'equipment', 'one scenario-specific tribute obligation'],
  unresolvedNumericFields: ['historically exact tribute deliveries', 'historically exact delivery-specific beneficiary shares', 'historically exact cadence', 'historically exact arrears'],
  sourceCautions: [
    'The Matrícula de Tributos and Codex Mendoza are later evidence used for vocabulary and categories only.',
    'Off-map links preserve named strategic localities without fabricating exact polygons.',
    'Modeled integers are canonical simulation controls and low-confidence estimates, not claims of census or tribute precision.',
  ],
}));
files.push(await writeJson('geography/candidate-region-plan.json', {
  count: regionRows.length,
  allocation: { mexicanBasin: 12, pueblaTlaxcala: 8, chalcoMorelosEasternFrontiers: 6, purepechaWesternFrontier: 8, mixtecaOaxaca: 8, externalExchangeCorridors: 2 },
  regions: regionRows.map(([name, displayName, owner]) => ({ regionId: `region:meso1450:${name}`, displayName, owner, geometryStatus: 'unknown' })),
}));
files.push(await writeJson('geography/runtime-regions.geojson', { type: 'FeatureCollection', features: [] }));
files.push(await writeJson('geography/runtime-land-adjacency.json', { regions: Object.values(scenario.geography.regions).map(({ id, adjacentRegionIds }) => ({ regionId: id, adjacentRegionIds })) }));
files.push(await writeJson('geography/runtime-integration-control.json', Object.values(scenario.startingState.regions).map((region) => ({ regionId: region.id, legalOwnerPolityId: region.legalOwnerPolityId, actualControllerPolityId: region.actualControllerPolityId, controlProfileId: region.controlProfileId }))));
files.push(await writeJson('geography/runtime-geography-manifest.json', { effectiveDate: '1450-01-01', renderedRegionCount: 0, offMapRegionCount: 44, reason: 'No reviewed historical boundary geometry is yet available; exact shapes remain unknown.' }));
files.push(await writeJson('starting-state/population.json', scenario.startingState.populationCohorts));
files.push(await writeJson('starting-state/control.json', Object.fromEntries(Object.entries(scenario.startingState.regions).map(([id, region]) => [id, { legalOwnerPolityId: region.legalOwnerPolityId, actualControllerPolityId: region.actualControllerPolityId, controlProfileId: region.controlProfileId }]))));
files.push(await writeJson('starting-state/economy.json', { policy: 'modeled-central-estimates', regions: Object.fromEntries(Object.entries(scenario.startingState.regions).map(([id, region]) => [id, { fiscalBase: region.fiscalBase, productiveCapacity: region.productiveCapacity, supplyCapacity: region.supplyCapacity, resources: region.resources, status: 'modeled-low-confidence' }])) }));
files.push(await writeJson('starting-state/obligations.json', {
  obligations: scenario.startingState.tributeObligations,
  accountingRule: 'Goods debited from payers exactly equal goods credited to beneficiaries; service is reserved from workforce and recruitment; control is unchanged.',
}));
files.push(await writeJson('starting-state/diplomacy.json', scenario.startingState.relationships));
files.push(await writeJson('starting-state/politics.json', scenario.startingState.institutions));
files.push(await writeJson('starting-state/military.json', { formations: scenario.startingState.formations, quantitativeStatus: 'modeled-central-estimates', supportedArchetypeIds: Object.keys(scenario.catalogs.formationArchetypes) }));
files.push(await writeJson('starting-state/identity.json', { status: 'unknown', note: 'Regional identity distributions require a separate source audit; no shares are invented.' }));
files.push(await writeJson('starting-state/concepts.json', scenario.startingState.concepts));
files.push(await writeJson('starting-state/knowledge.json', scenario.startingState.knowledge));
files.push(await writeJson('starting-state/starting-state-manifest.json', { effectiveDate: '1450-01-01', authoritativeScenario: '../scenario.json', quantitativePolicy: 'modeled-central-estimates-with-low-confidence-provenance' }));
await writeJson('manifest.json', {
  schemaVersion: 'open-historia-scenario-package/1', scenarioId: scenario.id, profile: scenario.profile,
  effectiveDate: scenario.game.startDate, regionCount: regionRows.length, activeStrategicSubjectCount: activePolities.length,
  files: files.sort((a, b) => a.path.localeCompare(b)), scenarioChecksum: checksum(scenario),
});
