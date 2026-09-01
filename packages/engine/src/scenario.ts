/**
 * Scenario schema for the headless economy slice (dev fixture format).
 * Intentionally separate from ScenarioV2 (@open-historia/data-packs): the V2
 * bundle carries provenance machinery this synthetic fixture does not need.
 * Merging the formats is an open question in docs/canon/05-scenario-format.md.
 */
import { z } from 'zod';
import {
  gameDateSchema,
  polityIdSchema,
  regionIdSchema,
  scenarioIdSchema,
} from '@open-historia/domain';
import { authoredStatecraftSchema } from './statecraft.js';
import { authoredPoliticsSchema } from './politics.js';
import { authoredMilitarySchema } from './military.js';
import { authoredCapabilitiesSchema, authoredIdentitySchema } from './society.js';
import { authoredCampaignSchema } from './campaign.js';

/** Game resource catalog per regional-resource-economy.md §2. Engine-owned. */
export const RESOURCE_CATALOG = [
  'food',
  'wood',
  'stone',
  'iron',
  'coal',
  'oil',
  'fibers',
  'gold',
  'building_materials',
  'steel',
  'fuel',
  'chemicals',
  'cloth',
  'goods',
  'machines',
  'weapons',
  'ammo',
  'medicine',
  'electricity',
] as const;

export const resourceIdSchema = z.enum(RESOURCE_CATALOG);
export type ResourceId = z.infer<typeof resourceIdSchema>;

export const RAW_RESOURCES = ['food', 'wood', 'stone', 'iron', 'coal', 'oil', 'fibers'] as const;
export const rawResourceIdSchema = z.enum(RAW_RESOURCES);
export type RawResourceId = z.infer<typeof rawResourceIdSchema>;

/** The only processing recipe accepted in this MVP: 1 Coal + 1 Iron -> 1 Goods. */
export const BASIC_GOODS_RECIPE = {
  activity: 'basic_goods',
  inputs: [
    { resource: 'coal', perUnit: 1 },
    { resource: 'iron', perUnit: 1 },
  ],
  output: 'goods',
} as const;

const displayNameSchema = z
  .object({ en: z.string().min(1), ru: z.string().min(1) })
  .strict();

const nonNegInt = z.number().int().nonnegative();
const bpSchema = z.number().int().min(0).max(10000);

export const regionActivitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('extraction'), resource: rawResourceIdSchema }).strict(),
  z.object({ kind: z.literal('processing'), activity: z.literal('basic_goods') }).strict(),
]);
export type RegionActivity = z.infer<typeof regionActivitySchema>;

export const scenarioRegionSchema = z
  .object({
    regionId: regionIdSchema,
    controllerId: polityIdSchema,
    displayName: displayNameSchema,
    activity: regionActivitySchema,
    population: nonNegInt,
    annualBirthRateBp: bpSchema,
    annualDeathRateBp: bpSchema,
    workforceRateBp: bpSchema,
    infrastructureBp: bpSchema,
    damageBp: bpSchema,
    baseMonthlyCapacity: nonNegInt,
    outputPerWorker: nonNegInt,
    /**
     * Upper bound construction may raise `baseMonthlyCapacity` to. Required
     * when the projects module is on; absent means capacity cannot grow.
     */
    capacityCeiling: nonNegInt.optional(),
  })
  .strict();
export type ScenarioRegion = z.infer<typeof scenarioRegionSchema>;

export const scenarioPolitySchema = z
  .object({
    id: polityIdSchema,
    displayName: displayNameSchema,
    treasury: nonNegInt,
    stockpile: z
      .array(z.object({ resource: resourceIdSchema, amount: nonNegInt }).strict()),
  })
  .strict();
export type ScenarioPolity = z.infer<typeof scenarioPolitySchema>;

export const resourceParamsSchema = z
  .object({
    resource: resourceIdSchema,
    /** Gold per whole resource unit (authored accounting value). */
    accountingValue: nonNegInt,
    taxRateBp: bpSchema,
  })
  .strict();
export type ResourceParams = z.infer<typeof resourceParamsSchema>;

export const economyParamsSchema = z
  .object({
    /**
     * Monthly food need in thousandths of a unit per person:
     * need = population * foodNeedPerPersonMilli / 1000 (floored).
     * The spec's `foodNeedPerPerson` made integer-friendly; recorded in canon 04.
     */
    foodNeedPerPersonMilli: nonNegInt,
    /** Infrastructure basis points gained per gold of accepted investment. */
    infrastructureBpPerMoney: nonNegInt,
    resourceParams: z.array(resourceParamsSchema).min(1),
  })
  .strict();
export type EconomyParams = z.infer<typeof economyParamsSchema>;

/**
 * Optional mechanics, per canon 00 "Modular mechanics". A module that is absent
 * or false is completely absent from the tick, the state and the UI — which is
 * also what keeps an older scenario's canonical state byte-identical.
 */
export const modulesSchema = z
  .object({
    diplomacy: z.boolean().optional(),
    armedForces: z.boolean().optional(),
    combat: z.boolean().optional(),
    finance: z.boolean().optional(),
    intelligence: z.boolean().optional(),
    politics: z.boolean().optional(),
    societyAndIdentity: z.boolean().optional(),
    technology: z.boolean().optional(),
    projects: z.boolean().optional(),
    budget: z.boolean().optional(),
    trade: z.boolean().optional(),
    shortages: z.boolean().optional(),
    unrest: z.boolean().optional(),
    campaign: z.boolean().optional(),
  })
  .strict();
export type Modules = z.infer<typeof modulesSchema>;

export const MODULE_NAMES = ['armedForces', 'campaign', 'combat', 'diplomacy', 'finance', 'intelligence', 'politics', 'projects', 'societyAndIdentity', 'technology', 'budget', 'trade', 'shortages', 'unrest'] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];

export const authoredRelationSchema = z.object({
  polities: z.tuple([polityIdSchema, polityIdSchema]),
  opinion: z.number().int().min(-10000).max(10000),
  trust: bpSchema,
  threat: bpSchema,
}).strict();

export const authoredTradeRouteSchema = z.object({
  polities: z.tuple([polityIdSchema, polityIdSchema]),
  monthlyCapacity: z.number().int().positive(),
}).strict();

export const authoredDiplomacySchema = z.object({
  relations: z.array(authoredRelationSchema),
  tradeRoutes: z.array(authoredTradeRouteSchema),
}).strict();

export const econScenarioSchema = z
  .object({
    schemaVersion: z.literal('open-historia-engine-scenario/1'),
    scenarioId: scenarioIdSchema,
    /** The fixture must be visibly labelled as synthetic (first-economy-mvp §2). */
    label: z.enum(['development-test', 'historical-projection']),
    displayName: displayNameSchema,
    /** First day of the starting month. */
    startMonth: gameDateSchema.refine((d) => d.endsWith('-01'), {
      message: 'startMonth must be the first day of a month (YYYY-MM-01)',
    }),
    /** Reserved for future seeded mechanics; the MVP tick uses no randomness. */
    rngSeed: z.number().int().nonnegative().optional(),
    activeResources: z.array(resourceIdSchema).min(1),
    /** Omit to run the base economy exactly as before. */
    modules: modulesSchema.optional(),
    /** Required only by scenarios that enable executable diplomacy. */
    diplomacy: authoredDiplomacySchema.optional(),
    /** Authored catalogs and seeds for finance/projects/intelligence. */
    statecraft: authoredStatecraftSchema.optional(),
    /** Authored factions, offices and succession state. */
    politics: authoredPoliticsSchema.optional(),
    /** Authored manpower ceilings, starting forces, commanders and supply links. */
    military: authoredMilitarySchema.optional(),
    /** Authored non-linear capability catalog and starting unlocks. */
    capabilities: authoredCapabilitiesSchema.optional(),
    /** Authored culture/religion groups, regional composition and state policy. */
    identity: authoredIdentitySchema.optional(),
    /** Authored directions, deterministic crisis conditions and historical baselines. */
    campaign: authoredCampaignSchema.optional(),
    economy: economyParamsSchema,
    polities: z.array(scenarioPolitySchema).min(2),
    regions: z.array(scenarioRegionSchema).min(1),
  })
  .strict()
  .superRefine((scenario, ctx) => {
    const polityIds = new Set<string>();
    for (const polity of scenario.polities) {
      if (polityIds.has(polity.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate polity id ${polity.id}`, path: ['polities'] });
      }
      polityIds.add(polity.id);
    }
    if (scenario.modules?.diplomacy === true && !scenario.diplomacy) {
      ctx.addIssue({ code: 'custom', message: 'diplomacy module requires authored diplomacy inputs', path: ['diplomacy'] });
    }
    if ((scenario.modules?.finance === true || scenario.modules?.intelligence === true) && !scenario.statecraft) {
      ctx.addIssue({ code: 'custom', message: 'finance/intelligence modules require authored statecraft inputs', path: ['statecraft'] });
    }
    if (scenario.modules?.politics === true && !scenario.politics) {
      ctx.addIssue({ code: 'custom', message: 'politics module requires authored political inputs', path: ['politics'] });
    }
    if ((scenario.modules?.armedForces === true || scenario.modules?.combat === true) && !scenario.military) {
      ctx.addIssue({ code: 'custom', message: 'armedForces/combat modules require authored military inputs', path: ['military'] });
    }
    if (scenario.modules?.combat === true && scenario.modules?.armedForces !== true) {
      ctx.addIssue({ code: 'custom', message: 'combat module requires armedForces', path: ['modules', 'combat'] });
    }
    if (scenario.modules?.technology === true && (!scenario.capabilities || scenario.modules?.projects !== true)) {
      ctx.addIssue({ code: 'custom', message: 'technology requires authored capabilities and projects', path: ['capabilities'] });
    }
    if (scenario.modules?.societyAndIdentity === true && !scenario.identity) {
      ctx.addIssue({ code: 'custom', message: 'societyAndIdentity requires authored identity inputs', path: ['identity'] });
    }
    if (scenario.modules?.campaign === true && !scenario.campaign) {
      ctx.addIssue({ code: 'custom', message: 'campaign module requires authored campaign inputs', path: ['campaign'] });
    }
    if (scenario.campaign) {
      const goalIds = new Set(scenario.campaign.goals.map((entry) => entry.goalId));
      const templateIds = new Set(scenario.campaign.crisisTemplates.map((entry) => entry.templateId));
      if (goalIds.size !== scenario.campaign.goals.length) ctx.addIssue({ code: 'custom', message: 'campaign goal ids must be unique', path: ['campaign', 'goals'] });
      if ([...polityIds].some((polityId) => scenario.campaign!.goals.filter((entry) => entry.polityId === polityId).length > 3)) {
        ctx.addIssue({ code: 'custom', message: 'campaign permits at most three directions per polity', path: ['campaign', 'goals'] });
      }
      if (templateIds.size !== scenario.campaign.crisisTemplates.length) ctx.addIssue({ code: 'custom', message: 'crisis template ids must be unique', path: ['campaign', 'crisisTemplates'] });
      const regionIds = new Set(scenario.regions.map((entry) => entry.regionId));
      const capabilityIds = new Set(scenario.capabilities?.catalog.map((entry) => entry.capabilityId) ?? []);
      if (scenario.campaign.softHorizonMonth < scenario.startMonth) {
        ctx.addIssue({ code: 'custom', message: 'campaign soft horizon cannot precede scenario start', path: ['campaign', 'softHorizonMonth'] });
      }
      for (const [index, goal] of scenario.campaign.goals.entries()) {
        if (!polityIds.has(goal.polityId)
          || (goal.kind === 'secure-alliance' && (!polityIds.has(goal.targetPolityId) || goal.targetPolityId === goal.polityId || scenario.modules?.diplomacy !== true))
          || (goal.kind === 'control-region' && !regionIds.has(goal.regionId))
          || (goal.kind === 'unlock-capability' && (!capabilityIds.has(goal.capabilityId) || scenario.modules?.technology !== true))
          || (goal.kind === 'stabilize-government' && scenario.modules?.politics !== true)) {
          ctx.addIssue({ code: 'custom', message: 'campaign goal references unknown id or disabled module', path: ['campaign', 'goals', index] });
        }
      }
      for (const [index, template] of scenario.campaign.crisisTemplates.entries()) {
        if (!polityIds.has(template.subjectPolityId) || template.participants.some((entry) => !polityIds.has(entry))
          || new Set(template.participants).size !== template.participants.length || !template.participants.includes(template.subjectPolityId)
          || (template.kind === 'identity-pressure' && scenario.modules?.societyAndIdentity !== true)
          || (template.kind === 'debt-distress' && scenario.modules?.finance !== true)
          || (template.kind === 'war-escalation' && scenario.modules?.armedForces !== true)
          || (template.kind === 'political-escalation' && scenario.modules?.politics !== true)) {
          ctx.addIssue({ code: 'custom', message: 'crisis template references unique known polities', path: ['campaign', 'crisisTemplates', index] });
        }
      }
      if (scenario.campaign.legacyBaselines.length !== polityIds.size
        || new Set(scenario.campaign.legacyBaselines.map((entry) => entry.polityId)).size !== polityIds.size
        || scenario.campaign.legacyBaselines.some((entry) => !polityIds.has(entry.polityId))) {
        ctx.addIssue({ code: 'custom', message: 'campaign requires exactly one legacy baseline per polity', path: ['campaign', 'legacyBaselines'] });
      }
    }
    if (scenario.capabilities) {
      const capabilityIds = new Set(scenario.capabilities.catalog.map((entry) => entry.capabilityId));
      if (capabilityIds.size !== scenario.capabilities.catalog.length) {
        ctx.addIssue({ code: 'custom', message: 'capability ids must be unique', path: ['capabilities', 'catalog'] });
      }
      for (const [index, capability] of scenario.capabilities.catalog.entries()) {
        if (new Set(capability.prerequisiteIds).size !== capability.prerequisiteIds.length
          || capability.prerequisiteIds.includes(capability.capabilityId)
          || capability.prerequisiteIds.some((entry) => !capabilityIds.has(entry))) {
          ctx.addIssue({ code: 'custom', message: 'capability prerequisites must be unique known non-self ids', path: ['capabilities', 'catalog', index, 'prerequisiteIds'] });
        }
      }
      const visiting = new Set<string>(); const visited = new Set<string>();
      const cyclic = (id: string): boolean => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        const row = scenario.capabilities!.catalog.find((entry) => entry.capabilityId === id);
        const result = row?.prerequisiteIds.some(cyclic) ?? false;
        visiting.delete(id); visited.add(id); return result;
      };
      if ([...capabilityIds].some(cyclic)) ctx.addIssue({ code: 'custom', message: 'capability prerequisites must be acyclic', path: ['capabilities', 'catalog'] });
      const startingKeys = new Set<string>();
      const startingByPolity = new Map<string, Set<string>>();
      for (const [index, unlock] of scenario.capabilities.starting.entries()) {
        const key = `${unlock.polityId}|${unlock.capabilityId}`;
        if (!polityIds.has(unlock.polityId) || !capabilityIds.has(unlock.capabilityId) || startingKeys.has(key)) {
          ctx.addIssue({ code: 'custom', message: 'starting capability must reference unique known polity/capability', path: ['capabilities', 'starting', index] });
        }
        startingKeys.add(key);
        const entries = startingByPolity.get(unlock.polityId) ?? new Set<string>();
        entries.add(unlock.capabilityId); startingByPolity.set(unlock.polityId, entries);
      }
      for (const [polityId, unlocked] of startingByPolity) {
        for (const capabilityId of unlocked) {
          const definition = scenario.capabilities.catalog.find((entry) => entry.capabilityId === capabilityId);
          if (definition?.prerequisiteIds.some((entry) => !unlocked.has(entry))) {
            ctx.addIssue({ code: 'custom', message: `starting capability ${capabilityId} lacks a prerequisite for ${polityId}`, path: ['capabilities', 'starting'] });
          }
        }
      }
      for (const [index, template] of (scenario.statecraft?.projectTemplates ?? []).entries()) {
        if (template.effect.kind === 'unlock-capability' && !capabilityIds.has(template.effect.capabilityId)) {
          ctx.addIssue({ code: 'custom', message: 'research template references unknown capability', path: ['statecraft', 'projectTemplates', index, 'effect', 'capabilityId'] });
        }
      }
    }
    if (scenario.identity) {
      const cultureIds = new Set(scenario.identity.cultures.map((entry) => entry.cultureId));
      const religionIds = new Set(scenario.identity.religions.map((entry) => entry.religionId));
      const regionIds = new Set(scenario.regions.map((entry) => entry.regionId));
      if (cultureIds.size !== scenario.identity.cultures.length || religionIds.size !== scenario.identity.religions.length) {
        ctx.addIssue({ code: 'custom', message: 'culture and religion ids must be unique', path: ['identity'] });
      }
      if (scenario.identity.regions.length !== regionIds.size || new Set(scenario.identity.regions.map((entry) => entry.regionId)).size !== regionIds.size) {
        ctx.addIssue({ code: 'custom', message: 'identity requires exactly one row per scenario region', path: ['identity', 'regions'] });
      }
      if (scenario.identity.polities.length !== polityIds.size || new Set(scenario.identity.polities.map((entry) => entry.polityId)).size !== polityIds.size) {
        ctx.addIssue({ code: 'custom', message: 'identity requires exactly one row per scenario polity', path: ['identity', 'polities'] });
      }
      for (const [index, row] of scenario.identity.regions.entries()) {
        if (!regionIds.has(row.regionId) || !cultureIds.has(row.culture.primaryId)
          || row.culture.minorities.some((entry) => !cultureIds.has(entry.identityId))
          || !religionIds.has(row.religion.primaryId)
          || row.religion.minorities.some((entry) => !religionIds.has(entry.identityId))) {
          ctx.addIssue({ code: 'custom', message: 'regional identity row references unknown region/group', path: ['identity', 'regions', index] });
        }
      }
      for (const [index, row] of scenario.identity.polities.entries()) {
        if (!polityIds.has(row.polityId) || !cultureIds.has(row.officialCultureId) || !religionIds.has(row.officialReligionId)
          || row.acceptedCultureIds.includes(row.officialCultureId) || row.acceptedReligionIds.includes(row.officialReligionId)
          || new Set(row.acceptedCultureIds).size !== row.acceptedCultureIds.length || new Set(row.acceptedReligionIds).size !== row.acceptedReligionIds.length
          || row.acceptedCultureIds.some((entry) => !cultureIds.has(entry)) || row.acceptedReligionIds.some((entry) => !religionIds.has(entry))) {
          ctx.addIssue({ code: 'custom', message: 'polity identity row requires known unique official/accepted groups', path: ['identity', 'polities', index] });
        }
      }
    }
    if (scenario.politics) {
      const factionIds = new Set(scenario.politics.factions.map((entry) => entry.factionId));
      const characterIds = new Set(scenario.politics.characters.map((entry) => entry.characterId));
      const politicalPolityIds = new Set(scenario.politics.polities.map((entry) => entry.polityId));
      if (factionIds.size !== scenario.politics.factions.length) {
        ctx.addIssue({ code: 'custom', message: 'political faction ids must be unique', path: ['politics', 'factions'] });
      }
      if (characterIds.size !== scenario.politics.characters.length) {
        ctx.addIssue({ code: 'custom', message: 'political character ids must be unique', path: ['politics', 'characters'] });
      }
      if (scenario.modules?.politics === true && (politicalPolityIds.size !== polityIds.size
        || scenario.politics.polities.length !== polityIds.size)) {
        ctx.addIssue({ code: 'custom', message: 'politics module requires exactly one political row per polity', path: ['politics', 'polities'] });
      }
      for (const polityId of polityIds) {
        const count = scenario.politics.factions.filter((entry) => entry.polityId === polityId).length;
        if (scenario.modules?.politics === true && (count < 3 || count > 6)) {
          ctx.addIssue({ code: 'custom', message: `${polityId} must have 3-6 factions`, path: ['politics', 'factions'] });
        }
      }
      const offices = new Set<string>();
      for (const [index, character] of scenario.politics.characters.entries()) {
        if (!polityIds.has(character.polityId) || !factionIds.has(character.factionId)) {
          ctx.addIssue({ code: 'custom', message: 'character must reference known polity and faction', path: ['politics', 'characters', index] });
        }
        if (character.office) {
          const key = `${character.polityId}|${character.office}`;
          if (offices.has(key)) ctx.addIssue({ code: 'custom', message: `duplicate political office ${key}`, path: ['politics', 'characters', index, 'office'] });
          offices.add(key);
        }
        for (const relation of character.relations) {
          if (!characterIds.has(relation.characterId)) ctx.addIssue({ code: 'custom', message: 'character relation references unknown character', path: ['politics', 'characters', index, 'relations'] });
        }
      }
      for (const [index, faction] of scenario.politics.factions.entries()) {
        const leader = scenario.politics.characters.find((entry) => entry.characterId === faction.leaderCharacterId);
        if (!polityIds.has(faction.polityId) || !leader || leader.polityId !== faction.polityId) {
          ctx.addIssue({ code: 'custom', message: 'faction leader must be a character of the same known polity', path: ['politics', 'factions', index, 'leaderCharacterId'] });
        }
      }
      for (const [index, polity] of scenario.politics.polities.entries()) {
        const ruler = scenario.politics.characters.find((entry) => entry.characterId === polity.rulerCharacterId);
        const heir = polity.heirCharacterId ? scenario.politics.characters.find((entry) => entry.characterId === polity.heirCharacterId) : null;
        if (!polityIds.has(polity.polityId) || !ruler || ruler.polityId !== polity.polityId || ruler.office !== 'ruler'
          || (polity.heirCharacterId && (!heir || heir.polityId !== polity.polityId || heir.office !== 'heir'))) {
          ctx.addIssue({ code: 'custom', message: 'political ruler/heir must match their polity and offices', path: ['politics', 'polities', index] });
        }
      }
    }
    if (scenario.military) {
      const regionIds = new Set(scenario.regions.map((entry) => entry.regionId));
      const militaryPolityIds = new Set(scenario.military.polities.map((entry) => entry.polityId));
      const commanderIds = new Set(scenario.military.commanders.map((entry) => entry.commanderId));
      const formationIds = new Set(scenario.military.formations.map((entry) => entry.formationId));
      if (scenario.modules?.armedForces === true && (militaryPolityIds.size !== polityIds.size || scenario.military.polities.length !== polityIds.size)) {
        ctx.addIssue({ code: 'custom', message: 'armedForces requires exactly one military row per polity', path: ['military', 'polities'] });
      }
      if (commanderIds.size !== scenario.military.commanders.length || formationIds.size !== scenario.military.formations.length) {
        ctx.addIssue({ code: 'custom', message: 'commander and formation ids must be unique', path: ['military'] });
      }
      for (const [index, row] of scenario.military.polities.entries()) {
        if (!polityIds.has(row.polityId)) ctx.addIssue({ code: 'custom', message: 'military row references unknown polity', path: ['military', 'polities', index] });
        const population = scenario.regions.filter((entry) => entry.controllerId === row.polityId).reduce((sum, entry) => sum + entry.population, 0);
        const ceiling = Math.floor((population * row.maxMobilizationBp) / 10000);
        const starting = scenario.military.formations.filter((entry) => entry.polityId === row.polityId).reduce((sum, entry) => sum + entry.manpower, 0);
        if (starting > ceiling) ctx.addIssue({ code: 'custom', message: `starting manpower ${starting} exceeds ceiling ${ceiling}`, path: ['military', 'formations'] });
      }
      for (const [index, commander] of scenario.military.commanders.entries()) {
        if (!polityIds.has(commander.polityId)) ctx.addIssue({ code: 'custom', message: 'commander references unknown polity', path: ['military', 'commanders', index] });
      }
      for (const [index, formation] of scenario.military.formations.entries()) {
        const home = scenario.regions.find((entry) => entry.regionId === formation.homeRegionId);
        const location = scenario.regions.find((entry) => entry.regionId === formation.locationRegionId);
        const commander = formation.commanderId ? scenario.military.commanders.find((entry) => entry.commanderId === formation.commanderId) : null;
        if (!polityIds.has(formation.polityId) || !home || !location || home.controllerId !== formation.polityId
          || location.controllerId !== formation.polityId || formation.manpower <= 0 || formation.equipment <= 0
          || (formation.commanderId && (!commander || commander.polityId !== formation.polityId))) {
          ctx.addIssue({ code: 'custom', message: 'starting formation must have positive conserved forces in controlled regions and a matching commander', path: ['military', 'formations', index] });
        }
      }
      const links = new Set<string>();
      for (const [index, link] of scenario.military.supplyLinks.entries()) {
        const [left, right] = link.regions;
        const key = `${left}|${right}`;
        if (left >= right || !regionIds.has(left) || !regionIds.has(right) || links.has(key)) {
          ctx.addIssue({ code: 'custom', message: 'supply links require two known sorted unique regions', path: ['military', 'supplyLinks', index] });
        }
        links.add(key);
      }
    }
    if (scenario.statecraft) {
      const unique = (values: string[], path: (string | number)[]) => {
        const seen = new Set<string>();
        for (const value of values) {
          if (seen.has(value)) ctx.addIssue({ code: 'custom', message: `duplicate statecraft id ${value}`, path });
          seen.add(value);
        }
      };
      unique(scenario.statecraft.finance.map((entry) => entry.polityId), ['statecraft', 'finance']);
      unique(scenario.statecraft.capacities.map((entry) => entry.polityId), ['statecraft', 'capacities']);
      unique(scenario.statecraft.projectTemplates.map((entry) => entry.templateId), ['statecraft', 'projectTemplates']);
      unique(scenario.statecraft.intelligenceFacts.map((entry) => entry.factId), ['statecraft', 'intelligenceFacts']);
      if (scenario.modules?.finance === true && scenario.statecraft.finance.length !== polityIds.size) {
        ctx.addIssue({ code: 'custom', message: 'finance module requires exactly one finance row per polity', path: ['statecraft', 'finance'] });
      }
      if (scenario.modules?.projects === true && scenario.statecraft.capacities.length !== polityIds.size) {
        ctx.addIssue({ code: 'custom', message: 'projects module requires exactly one capacity row per polity', path: ['statecraft', 'capacities'] });
      }
      for (const [index, entry] of scenario.statecraft.finance.entries()) {
        if (!polityIds.has(entry.polityId)) ctx.addIssue({ code: 'custom', message: `unknown finance polity ${entry.polityId}`, path: ['statecraft', 'finance', index, 'polityId'] });
      }
      for (const [index, entry] of scenario.statecraft.capacities.entries()) {
        if (!polityIds.has(entry.polityId)) ctx.addIssue({ code: 'custom', message: `unknown capacity polity ${entry.polityId}`, path: ['statecraft', 'capacities', index, 'polityId'] });
      }
      const factIds = new Set(scenario.statecraft.intelligenceFacts.map((entry) => entry.factId));
      for (const [index, fact] of scenario.statecraft.intelligenceFacts.entries()) {
        if (!polityIds.has(fact.subjectPolityId)) ctx.addIssue({ code: 'custom', message: `unknown intelligence subject ${fact.subjectPolityId}`, path: ['statecraft', 'intelligenceFacts', index, 'subjectPolityId'] });
      }
      for (const [index, seed] of scenario.statecraft.knowledgeSeeds.entries()) {
        if (!polityIds.has(seed.observerPolityId) || !factIds.has(seed.factId)) {
          ctx.addIssue({ code: 'custom', message: 'knowledge seed must reference a known observer and fact', path: ['statecraft', 'knowledgeSeeds', index] });
        }
        const fact = scenario.statecraft.intelligenceFacts.find((entry) => entry.factId === seed.factId);
        if (fact && fact.evidenceId !== seed.evidenceId) {
          ctx.addIssue({ code: 'custom', message: 'knowledge seed evidence must match authored fact evidence', path: ['statecraft', 'knowledgeSeeds', index, 'evidenceId'] });
        }
      }
    }
    if (scenario.diplomacy) {
      const relationPairs = new Set<string>();
      for (const [index, relation] of scenario.diplomacy.relations.entries()) {
        const [left, right] = relation.polities;
        if (left >= right || !polityIds.has(left) || !polityIds.has(right)) {
          ctx.addIssue({ code: 'custom', message: 'relation pair must contain two known polities in ascending order', path: ['diplomacy', 'relations', index, 'polities'] });
        }
        const key = `${left}|${right}`;
        if (relationPairs.has(key)) ctx.addIssue({ code: 'custom', message: `duplicate relation pair ${key}`, path: ['diplomacy', 'relations', index] });
        relationPairs.add(key);
      }
      const routePairs = new Set<string>();
      for (const [index, route] of scenario.diplomacy.tradeRoutes.entries()) {
        const [left, right] = route.polities;
        if (left >= right || !polityIds.has(left) || !polityIds.has(right)) {
          ctx.addIssue({ code: 'custom', message: 'trade route pair must contain two known polities in ascending order', path: ['diplomacy', 'tradeRoutes', index, 'polities'] });
        }
        const key = `${left}|${right}`;
        if (routePairs.has(key)) ctx.addIssue({ code: 'custom', message: `duplicate trade route pair ${key}`, path: ['diplomacy', 'tradeRoutes', index] });
        routePairs.add(key);
      }
    }
    const active = new Set<string>(scenario.activeResources);
    if (active.size !== scenario.activeResources.length) {
      ctx.addIssue({ code: 'custom', message: 'activeResources must be unique', path: ['activeResources'] });
    }
    const withParams = new Set(scenario.economy.resourceParams.map((p) => p.resource));
    for (const resource of active) {
      if (!withParams.has(resource as ResourceId)) {
        ctx.addIssue({
          code: 'custom',
          message: `active resource ${resource} has no authored accounting value / tax rate`,
          path: ['economy', 'resourceParams'],
        });
      }
    }
    const regionIds = new Set<string>();
    for (const [index, region] of scenario.regions.entries()) {
      if (regionIds.has(region.regionId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate region id ${region.regionId}`, path: ['regions', index] });
      }
      regionIds.add(region.regionId);
      if (!polityIds.has(region.controllerId)) {
        ctx.addIssue({
          code: 'custom',
          message: `region ${region.regionId} controller ${region.controllerId} is not a scenario polity`,
          path: ['regions', index, 'controllerId'],
        });
      }
      if (region.capacityCeiling !== undefined && region.capacityCeiling < region.baseMonthlyCapacity) {
        ctx.addIssue({
          code: 'custom',
          message: `region ${region.regionId} capacityCeiling ${region.capacityCeiling} is below its starting capacity ${region.baseMonthlyCapacity}`,
          path: ['regions', index, 'capacityCeiling'],
        });
      }
      if (scenario.modules?.projects === true && region.capacityCeiling === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `region ${region.regionId} needs a capacityCeiling because the projects module is enabled`,
          path: ['regions', index, 'capacityCeiling'],
        });
      }
      if (region.activity.kind === 'extraction' && !active.has(region.activity.resource)) {
        ctx.addIssue({
          code: 'custom',
          message: `region ${region.regionId} extracts ${region.activity.resource} which is not an active resource`,
          path: ['regions', index, 'activity'],
        });
      }
      if (region.activity.kind === 'processing') {
        for (const input of BASIC_GOODS_RECIPE.inputs) {
          if (!active.has(input.resource)) {
            ctx.addIssue({
              code: 'custom',
              message: `basic_goods input ${input.resource} is not an active resource`,
              path: ['regions', index, 'activity'],
            });
          }
        }
        if (!active.has(BASIC_GOODS_RECIPE.output)) {
          ctx.addIssue({
            code: 'custom',
            message: `basic_goods output ${BASIC_GOODS_RECIPE.output} is not an active resource`,
            path: ['regions', index, 'activity'],
          });
        }
      }
    }
    for (const [index, polity] of scenario.polities.entries()) {
      const seen = new Set<string>();
      for (const entry of polity.stockpile) {
        if (seen.has(entry.resource)) {
          ctx.addIssue({
            code: 'custom',
            message: `polity ${polity.id} stockpile lists ${entry.resource} twice`,
            path: ['polities', index, 'stockpile'],
          });
        }
        seen.add(entry.resource);
        if (!active.has(entry.resource)) {
          ctx.addIssue({
            code: 'custom',
            message: `polity ${polity.id} stockpile has inactive resource ${entry.resource}`,
            path: ['polities', index, 'stockpile'],
          });
        }
      }
    }
  });
export type EconScenario = z.infer<typeof econScenarioSchema>;

export function parseScenario(raw: unknown): EconScenario {
  return econScenarioSchema.parse(raw);
}
