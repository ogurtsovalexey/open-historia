/**
 * Monthly resolution — the deterministic heart of the economy slice.
 * Implements the fixed order of first-economy-mvp.md §5 with the
 * regional-resource-economy.md §5 extension. Pure: never mutates its input,
 * uses no randomness, no wall clock, no I/O.
 */
import type { PolityId, RegionId, WorldRevisionId } from '@open-historia/domain';
import type { CampaignCommand, CommandRejection, DiplomacyCommand, EconCommand, IdentityCommand, MilitaryCommand, PoliticsCommand, StatecraftCommand, TurnCommandsFile } from './commands.js';
import {
  ANNUAL_BP_MONTHLY_DIVISOR,
  BP_SCALE,
  addChecked,
  applyBp,
  assertSafeInt,
  clampBp,
  divFloor,
  mulDivFloor,
} from './fixedPoint.js';
import type {
  GoodsResolution,
  InvestmentRecord,
  PolityLedger,
  RegionPopulationRow,
  ResourceProduction,
  StockMovement,
  TaxRow,
  TransferRecord,
  TurnLedger,
} from './ledger.js';
import { checkInvariants } from './ledger.js';
import type { ResourceId } from './scenario.js';
import { BASIC_GOODS_RECIPE } from './scenario.js';
import type { EconRegionState, EconWorldState } from './state.js';
import { addMonth } from './state.js';
import { stateChecksum } from './canonical.js';
import { resolveDiplomacyPhase } from './diplomacyReducer.js';
import type { DiplomacyEngineEvent } from './diplomacyReducer.js';
import { applyStatecraftCommands, effectiveTax, resolveStatecraftMonth } from './statecraftReducer.js';
import type { StatecraftEngineEvent } from './statecraftReducer.js';
import { applyPoliticsCommands, resolvePoliticsMonth } from './politicsReducer.js';
import type { PoliticsEngineEvent } from './politicsReducer.js';
import { applyMilitaryCommands, resolveMilitaryMonth } from './militaryReducer.js';
import type { MilitaryEngineEvent } from './militaryReducer.js';
import { applyIdentityCommands, applyIdentityUnrest, polityIdentityEffects, regionIdentityEffects, resolveIdentityMonth } from './identityReducer.js';
import type { IdentityEngineEvent } from './identityReducer.js';
import { capabilityBonusBp } from './society.js';
import { applyCampaignCommands, resolveCampaignMonth } from './campaignReducer.js';
import type { CampaignEngineEvent } from './campaignReducer.js';

export type EngineEvent =
  DiplomacyEngineEvent
  | StatecraftEngineEvent
  | PoliticsEngineEvent
  | MilitaryEngineEvent
  | IdentityEngineEvent
  | CampaignEngineEvent
  | { type: 'command-rejected'; commandId: string; reason: CommandRejection['reason']; detail: string }
  | { type: 'region-transferred'; regionId: RegionId; fromPolityId: PolityId; toPolityId: PolityId; population: number }
  | { type: 'investment-applied'; polityId: PolityId; regionId: RegionId; spend: number; infrastructureGainBp: number; infrastructureBp: number }
  | { type: 'population-changed'; regionId: RegionId; births: number; deaths: number; population: number }
  | { type: 'region-produced'; regionId: RegionId; resource: ResourceId; potential: number; actual: number }
  | { type: 'goods-resolved'; polityId: PolityId; regionId: RegionId; potential: number; actual: number; limitingInputs: ResourceId[]; limitedBy: 'inputs' | 'capacity' }
  | { type: 'food-consumed'; polityId: PolityId; need: number; consumed: number; surplus: number; shortfall: number }
  | { type: 'tax-collected'; polityId: PolityId; amount: number }
  | { type: 'alert'; polityId: PolityId; alert: 'food-shortfall' | 'inputs-limited'; detail: string };

export interface TurnResult {
  state: EconWorldState;
  events: EngineEvent[];
  ledger: TurnLedger;
  rejections: CommandRejection[];
  /** Names of the §10 identities verified for this turn. */
  invariantsChecked: string[];
}

interface MutablePolity {
  id: PolityId;
  displayName: { en: string; ru: string };
  treasury: number;
  stock: Map<ResourceId, number>;
}

type EconomyPhaseCommand = Exclude<EconCommand, DiplomacyCommand | StatecraftCommand | PoliticsCommand | MilitaryCommand | IdentityCommand | CampaignCommand>;

/**
 * Capacity-side output before material inputs (rre §5).
 *
 * The labour product is only ever compared against capacity, so it must not be
 * required to be a safe integer: a region can have far more idle labour than
 * its capacity can use. Assert only on the value actually carried forward.
 */
export function potentialOutput(region: EconRegionState, workforce: number): number {
  const labourOutput = workforce * region.outputPerWorker;
  const usableCapacity =
    labourOutput >= region.baseMonthlyCapacity
      ? region.baseMonthlyCapacity
      : assertSafeInt(labourOutput, `labour output ${region.regionId}`);
  const afterInfrastructure = applyBp(usableCapacity, region.infrastructureBp, 'infrastructure factor');
  return applyBp(afterInfrastructure, BP_SCALE - region.damageBp, 'damage factor');
}

export function resolveMonth(state: EconWorldState, commandsFile: TurnCommandsFile): TurnResult {
  const events: EngineEvent[] = [];
  const rejections: CommandRejection[] = [];

  const regions: EconRegionState[] = state.regions.map((region) => ({ ...region }));
  const polities: MutablePolity[] = state.polities.map((polity) => ({
    id: polity.id,
    displayName: polity.displayName,
    treasury: polity.treasury,
    stock: new Map(polity.stockpile.map((entry) => [entry.resource, entry.amount])),
  }));
  const polityById = new Map(polities.map((polity) => [polity.id, polity]));
  const regionById = new Map(regions.map((region) => [region.regionId, region]));
  const paramsByResource = new Map(state.economy.resourceParams.map((p) => [p.resource, p]));

  const openingPopulation = new Map<PolityId, number>();
  const openingTreasury = new Map<PolityId, number>();
  const openingStock = new Map<PolityId, Map<ResourceId, number>>();
  for (const polity of state.polities) {
    openingTreasury.set(polity.id, polity.treasury);
    openingStock.set(polity.id, new Map(polity.stockpile.map((e) => [e.resource, e.amount])));
    openingPopulation.set(
      polity.id,
      state.regions.filter((r) => r.controllerId === polity.id).reduce((sum, r) => sum + r.population, 0)
    );
  }

  const identityCommands = commandsFile.commands.filter((command): command is IdentityCommand => command.kind.startsWith('identity.'));
  const identityCommandPhase = applyIdentityCommands(state, identityCommands, regions);
  events.push(...identityCommandPhase.events);
  for (const rejection of identityCommandPhase.rejections) {
    rejections.push(rejection);
    events.push({ type: 'command-rejected', commandId: rejection.command.commandId, reason: rejection.reason, detail: rejection.detail });
  }

  const campaignCommands = commandsFile.commands.filter((command): command is CampaignCommand =>
    command.kind.startsWith('campaign.') || command.kind.startsWith('crisis.'));
  const campaignCommandPhase = applyCampaignCommands(state, campaignCommands);
  events.push(...campaignCommandPhase.events);
  for (const rejection of campaignCommandPhase.rejections) {
    rejections.push(rejection);
    events.push({ type: 'command-rejected', commandId: rejection.command.commandId, reason: rejection.reason, detail: rejection.detail });
  }

  const militaryCommands = commandsFile.commands.filter((command): command is MilitaryCommand =>
    command.kind.startsWith('war.') || command.kind.startsWith('military.') || command.kind.startsWith('peace.'));
  const militaryCommandPhase = applyMilitaryCommands(state, militaryCommands, polities, regions, identityCommandPhase.identity);
  events.push(...militaryCommandPhase.events);
  for (const rejection of militaryCommandPhase.rejections) {
    rejections.push(rejection);
    events.push({ type: 'command-rejected', commandId: rejection.command.commandId, reason: rejection.reason, detail: rejection.detail });
  }

  const politicsCommands = commandsFile.commands.filter((command): command is PoliticsCommand =>
    command.kind.startsWith('politics.') || command.kind.startsWith('character.'));
  const politicsCommandPhase = applyPoliticsCommands(state, politicsCommands, polities);
  events.push(...politicsCommandPhase.events);
  for (const rejection of politicsCommandPhase.rejections) {
    rejections.push(rejection);
    events.push({ type: 'command-rejected', commandId: rejection.command.commandId, reason: rejection.reason, detail: rejection.detail });
  }

  const statecraftCommands = commandsFile.commands.filter((command): command is StatecraftCommand =>
    command.kind.startsWith('finance.') || command.kind.startsWith('project.'));
  const statecraftCommandPhase = applyStatecraftCommands(state, statecraftCommands, polities, regions);
  events.push(...statecraftCommandPhase.events);
  for (const rejection of statecraftCommandPhase.rejections) {
    rejections.push(rejection);
    events.push({ type: 'command-rejected', commandId: rejection.command.commandId, reason: rejection.reason, detail: rejection.detail });
  }

  const diplomacyCommands = commandsFile.commands.filter((command): command is DiplomacyCommand =>
    command.kind.startsWith('diplomacy.'));
  const diplomacyPhase = resolveDiplomacyPhase(state, diplomacyCommands, polities);
  events.push(...diplomacyPhase.events);
  for (const rejection of diplomacyPhase.rejections) {
    rejections.push(rejection);
    events.push({ type: 'command-rejected', commandId: rejection.command.commandId, reason: rejection.reason, detail: rejection.detail });
  }
  for (const penalty of militaryCommandPhase.relationPenalties) {
    for (const relation of diplomacyPhase.diplomacy?.relations ?? []) {
      if (relation.polities.includes(penalty.polityId)
        && (!penalty.counterpartyPolityId || relation.polities.includes(penalty.counterpartyPolityId))) {
        relation.trust = clampBp(relation.trust + penalty.deltaTrust);
        relation.opinion = Math.max(-10000, Math.min(10000, relation.opinion + penalty.deltaOpinion));
        relation.threat = clampBp(relation.threat + penalty.deltaThreat);
        relation.updatedMonth = state.month;
      }
    }
  }

  // ---- 1. Validate commands: any failure rejects the command, changes nothing.
  const accepted: EconomyPhaseCommand[] = [];
  const investedPolities = new Set<PolityId>();
  const transferredRegions = new Set<RegionId>(militaryCommandPhase.transfers.map((entry) => entry.regionId));
  /** Controllership as it will stand after the accepted transfers so far. */
  const projectedController = new Map<RegionId, PolityId>(
    regions.map((region) => [region.regionId, region.controllerId])
  );
  const processingRegionsOf = (polityId: PolityId): RegionId[] =>
    regions
      .filter((region) => region.activity.kind === 'processing' && projectedController.get(region.regionId) === polityId)
      .map((region) => region.regionId);

  const economyCommands = commandsFile.commands.filter((entry): entry is EconomyPhaseCommand =>
    entry.kind === 'economy.invest-region' || entry.kind === 'territory.transfer-region');
  for (const command of economyCommands) {
    const reject = (reason: CommandRejection['reason'], detail: string) => {
      rejections.push({ command, reason, detail });
      events.push({ type: 'command-rejected', commandId: command.commandId, reason, detail });
    };
    const actor = polityById.get(command.actorPolityId);
    if (!actor) {
      reject('unknown-actor', `no polity ${command.actorPolityId}`);
      continue;
    }
    const target = regionById.get(command.targetRegionId);
    if (!target) {
      reject('unknown-region', `no region ${command.targetRegionId}`);
      continue;
    }
    if (target.controllerId !== command.actorPolityId) {
      reject('foreign-target', `${command.targetRegionId} is controlled by ${target.controllerId}`);
      continue;
    }
    if (command.effectiveMonth !== state.month) {
      reject('wrong-month', `command month ${command.effectiveMonth}, world month ${state.month}`);
      continue;
    }
    if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) {
      reject('stale-revision', `expected ${command.expectedRevision}, world at ${state.revision}`);
      continue;
    }

    if (command.kind === 'territory.transfer-region') {
      const receiver = polityById.get(command.newControllerId);
      if (!receiver) {
        reject('unknown-new-controller', `no polity ${command.newControllerId}`);
        continue;
      }
      if (command.newControllerId === command.actorPolityId) {
        reject('same-controller', `${command.targetRegionId} already belongs to ${command.actorPolityId}`);
        continue;
      }
      if (transferredRegions.has(command.targetRegionId)) {
        reject('command-limit', `${command.targetRegionId} is already being transferred this month`);
        continue;
      }
      // rre §5 assumes exactly one processing region per polity; allocation
      // between competing factories needs an accepted contract first.
      if (target.activity.kind === 'processing' && processingRegionsOf(command.newControllerId).length > 0) {
        reject(
          'processing-competition',
          `${command.newControllerId} would control two processing regions (${processingRegionsOf(command.newControllerId).join(', ')} and ${command.targetRegionId})`
        );
        continue;
      }
      transferredRegions.add(command.targetRegionId);
      projectedController.set(command.targetRegionId, command.newControllerId);
      accepted.push(command);
      continue;
    }

    if (!Number.isSafeInteger(command.spend) || command.spend <= 0) {
      reject('invalid-amount', `spend ${command.spend}`);
      continue;
    }
    if (command.spend > actor.treasury) {
      reject('insufficient-treasury', `spend ${command.spend} > treasury ${actor.treasury}`);
      continue;
    }
    if (investedPolities.has(command.actorPolityId)) {
      reject('command-limit', `polity ${command.actorPolityId} already has an accepted investment this month`);
      continue;
    }
    investedPolities.add(command.actorPolityId);
    accepted.push(command);
  }

  // ---- 2. Pay accepted investments; clamp infrastructure at 10000 bp.
  const investments = new Map<PolityId, InvestmentRecord>();
  for (const command of accepted) {
    if (command.kind !== 'economy.invest-region') continue;
    const actor = polityById.get(command.actorPolityId)!;
    const region = regionById.get(command.targetRegionId)!;
    actor.treasury -= command.spend;
    const rawGain = addChecked(command.spend * state.economy.infrastructureBpPerMoney, 0, 'infrastructure gain');
    const before = region.infrastructureBp;
    region.infrastructureBp = clampBp(before + rawGain);
    const record: InvestmentRecord = {
      regionId: region.regionId,
      spend: command.spend,
      infrastructureGainBp: region.infrastructureBp - before,
      infrastructureBp: region.infrastructureBp,
    };
    investments.set(command.actorPolityId, record);
    events.push({
      type: 'investment-applied',
      polityId: command.actorPolityId,
      regionId: region.regionId,
      spend: command.spend,
      infrastructureGainBp: record.infrastructureGainBp,
      infrastructureBp: region.infrastructureBp,
    });
  }

  // ---- 2b. Apply accepted transfers. Investments are paid first, so a region
  // ceded this month carries the improvement its previous controller bought.
  // Population, capacity, infrastructure and damage stay with the region;
  // treasury and national stockpiles do not move (§7).
  const transfers: TransferRecord[] = militaryCommandPhase.transfers.map((entry) => ({ ...entry }));
  for (const command of accepted) {
    if (command.kind !== 'territory.transfer-region') continue;
    const region = regionById.get(command.targetRegionId)!;
    const record: TransferRecord = {
      regionId: region.regionId,
      fromPolityId: region.controllerId,
      toPolityId: command.newControllerId,
      population: region.population,
      infrastructureBp: region.infrastructureBp,
      damageBp: region.damageBp,
    };
    region.controllerId = command.newControllerId;
    transfers.push(record);
    events.push({
      type: 'region-transferred',
      regionId: region.regionId,
      fromPolityId: record.fromPolityId,
      toPolityId: record.toPolityId,
      population: record.population,
    });
  }

  // ---- 3. Births and deaths with carried remainders; 4. workforce; 5. potential.
  const populationRows = new Map<RegionId, RegionPopulationRow>();
  const workforceByRegion = new Map<RegionId, number>();
  const potentialByRegion = new Map<RegionId, number>();
  const controlledPopulation = new Map(polities.map((polity) => [polity.id,
    regions.filter((region) => region.controllerId === polity.id).reduce((sum, region) => sum + region.population, 0)]));
  for (const region of regions) {
    const births = mulDivFloor(
      region.population,
      region.annualBirthRateBp,
      ANNUAL_BP_MONTHLY_DIVISOR,
      `births ${region.regionId}`,
      region.birthRemainder
    );
    const deaths = mulDivFloor(
      region.population,
      region.annualDeathRateBp,
      ANNUAL_BP_MONTHLY_DIVISOR,
      `deaths ${region.regionId}`,
      region.deathRemainder
    );
    region.population = region.population + births.q - deaths.q;
    if (region.population < 0) {
      throw new Error(`negative population in ${region.regionId}: ${region.population}`);
    }
    region.birthRemainder = births.r;
    region.deathRemainder = deaths.r;
    populationRows.set(region.regionId, {
      regionId: region.regionId,
      births: births.q,
      deaths: deaths.q,
      population: region.population,
    });
    events.push({
      type: 'population-changed',
      regionId: region.regionId,
      births: births.q,
      deaths: deaths.q,
      population: region.population,
    });

    const baseWorkforce = applyBp(region.population, region.workforceRateBp, `workforce ${region.regionId}`);
    const mobilized = militaryCommandPhase.military?.polities.find((entry) => entry.polityId === region.controllerId)?.mobilized ?? 0;
    const mobilizedShare = Math.floor((mobilized * region.population) / Math.max(1, controlledPopulation.get(region.controllerId) ?? 1));
    const workforce = Math.max(0, baseWorkforce - mobilizedShare);
    workforceByRegion.set(region.regionId, workforce);
    const capabilityKind = region.activity.kind === 'extraction' ? 'extraction-output' : 'processing-output';
    const capabilityMultiplierBp = 10000 + capabilityBonusBp(state.capabilities, region.controllerId, capabilityKind);
    potentialByRegion.set(region.regionId, applyBp(potentialOutput(region, workforce), capabilityMultiplierBp, `capability output ${region.regionId}`));
  }

  // ---- 6a. Raw extraction for all regions; 6b. add to controller stockpiles.
  const production = new Map<PolityId, Map<ResourceId, { regionId: RegionId; amount: number }[]>>();
  const processingUse = new Map<PolityId, Map<ResourceId, number>>();
  const populationUse = new Map<PolityId, Map<ResourceId, number>>();
  const recordProduction = (polityId: PolityId, resource: ResourceId, regionId: RegionId, amount: number) => {
    const byResource = production.get(polityId) ?? new Map();
    production.set(polityId, byResource);
    const rows = byResource.get(resource) ?? [];
    byResource.set(resource, rows);
    rows.push({ regionId, amount });
  };

  for (const region of regions) {
    if (region.activity.kind !== 'extraction') continue;
    const resource = region.activity.resource;
    const amount = potentialByRegion.get(region.regionId)!;
    const polity = polityById.get(region.controllerId)!;
    polity.stock.set(resource, addChecked((polity.stock.get(resource) ?? 0) + amount, 0, 'stock add'));
    recordProduction(region.controllerId, resource, region.regionId, amount);
    events.push({ type: 'region-produced', regionId: region.regionId, resource, potential: amount, actual: amount });
  }

  // ---- 6c/7. basic_goods per polity: same-month extraction is available;
  // deduct only inputs actually used; record limiting inputs.
  const goodsByPolity = new Map<PolityId, GoodsResolution>();
  for (const polity of polities) {
    const goodsRegion = regions.find(
      (region) => region.controllerId === polity.id && region.activity.kind === 'processing'
    );
    if (!goodsRegion) continue;
    const potential = potentialByRegion.get(goodsRegion.regionId)!;
    const availableCoal = polity.stock.get('coal') ?? 0;
    const availableIron = polity.stock.get('iron') ?? 0;
    const actual = Math.min(potential, availableCoal, availableIron);
    const limitingInputs: ResourceId[] = [];
    if (actual < potential) {
      if (availableCoal === actual) limitingInputs.push('coal');
      if (availableIron === actual) limitingInputs.push('iron');
    }
    const inputSupplyBp =
      potential === 0 ? BP_SCALE : divFloor(actual * BP_SCALE, potential, 'input supply bp').q;
    polity.stock.set('coal', availableCoal - actual);
    polity.stock.set('iron', availableIron - actual);
    polity.stock.set('goods', addChecked((polity.stock.get('goods') ?? 0) + actual, 0, 'goods stock'));
    const use = processingUse.get(polity.id) ?? new Map<ResourceId, number>();
    processingUse.set(polity.id, use);
    use.set('coal', actual);
    use.set('iron', actual);
    recordProduction(polity.id, BASIC_GOODS_RECIPE.output, goodsRegion.regionId, actual);
    const resolution: GoodsResolution = {
      regionId: goodsRegion.regionId,
      potential,
      actual,
      coalUsed: actual,
      ironUsed: actual,
      inputSupplyBp,
      limitingInputs,
      limitedBy: limitingInputs.length > 0 ? 'inputs' : 'capacity',
    };
    goodsByPolity.set(polity.id, resolution);
    events.push({
      type: 'region-produced',
      regionId: goodsRegion.regionId,
      resource: BASIC_GOODS_RECIPE.output,
      potential,
      actual,
    });
    events.push({
      type: 'goods-resolved',
      polityId: polity.id,
      regionId: goodsRegion.regionId,
      potential,
      actual,
      limitingInputs,
      limitedBy: resolution.limitedBy,
    });
    if (limitingInputs.length > 0) {
      events.push({
        type: 'alert',
        polityId: polity.id,
        alert: 'inputs-limited',
        detail: `${goodsRegion.regionId}: goods output ${actual} of ${potential} potential; limited by ${limitingInputs.join(', ')}`,
      });
    }
  }

  // ---- 8. Food consumption per polity; no negative stock; record surplus/shortfall.
  const foodByPolity = new Map<PolityId, { need: number; available: number; consumed: number; surplus: number; shortfall: number }>();
  for (const polity of polities) {
    const populationTotal = regions
      .filter((region) => region.controllerId === polity.id)
      .reduce((sum, region) => sum + region.population, 0);
    const need = mulDivFloor(populationTotal, state.economy.foodNeedPerPersonMilli, 1000, `food need ${polity.id}`).q;
    const available = polity.stock.get('food') ?? 0;
    const consumed = Math.min(need, available);
    const shortfall = need - consumed;
    const surplus = available - consumed;
    polity.stock.set('food', available - consumed);
    const use = populationUse.get(polity.id) ?? new Map<ResourceId, number>();
    populationUse.set(polity.id, use);
    use.set('food', consumed);
    foodByPolity.set(polity.id, { need, available, consumed, surplus, shortfall });
    events.push({ type: 'food-consumed', polityId: polity.id, need, consumed, surplus, shortfall });
    if (shortfall > 0) {
      events.push({
        type: 'alert',
        polityId: polity.id,
        alert: 'food-shortfall',
        detail: `need ${need}, available ${available}, shortfall ${shortfall}`,
      });
    }
  }

  // ---- 9. Tax revenue on this month's regional output; update treasuries.
  const taxByPolity = new Map<PolityId, { base: number; total: number; rows: TaxRow[] }>();
  for (const polity of polities) {
    const rows: TaxRow[] = [];
    let base = 0;
    let total = 0;
    const byResource = production.get(polity.id);
    if (byResource) {
      for (const resource of [...byResource.keys()].sort()) {
        const params = paramsByResource.get(resource);
        if (!params) throw new Error(`no authored params for produced resource ${resource}`);
        for (const row of byResource.get(resource)!) {
          const value = addChecked(row.amount * params.accountingValue, 0, 'taxable value');
          const baseTax = applyBp(value, params.taxRateBp, `tax ${row.regionId}/${resource}`);
          const financeTax = effectiveTax(baseTax, statecraftCommandPhase.finance, polity.id);
          const identityMultiplierBp = regionIdentityEffects(identityCommandPhase.identity, row.regionId, polity.id).taxMultiplierBp;
          const tax = applyBp(financeTax, identityMultiplierBp, `identity tax ${row.regionId}`);
          rows.push({ regionId: row.regionId, resource, amount: tax });
          base = addChecked(base + baseTax, 0, 'base tax total');
          total = addChecked(total + tax, 0, 'tax total');
        }
      }
    }
    polity.treasury = addChecked(polity.treasury + total, 0, `treasury ${polity.id}`);
    taxByPolity.set(polity.id, { base, total, rows });
    events.push({ type: 'tax-collected', polityId: polity.id, amount: total });
  }

  const statecraftPhase = resolveStatecraftMonth(
    state,
    statecraftCommandPhase.finance,
    statecraftCommandPhase.projects,
    statecraftCommandPhase.intelligence,
    state.capabilities,
    statecraftCommandPhase.flows,
    polities,
    regions,
    new Map([...taxByPolity].map(([id, value]) => [id, value.base])),
    new Map([...taxByPolity].map(([id, value]) => [id, value.total])),
  );
  events.push(...statecraftPhase.events);
  for (const penalty of statecraftPhase.trustPenalties) {
    for (const relation of diplomacyPhase.diplomacy?.relations ?? []) {
      if (relation.polities.includes(penalty.polityId)) {
        relation.trust = Math.max(0, relation.trust + penalty.delta);
        relation.updatedMonth = state.month;
      }
    }
  }

  const politicsPhase = resolvePoliticsMonth(
    state, politicsCommandPhase.politics, statecraftPhase.finance, statecraftPhase.projects, diplomacyPhase.diplomacy,
  );
  events.push(...politicsPhase.events);
  for (const polity of politicsPhase.politics?.polities ?? []) {
    const pressure = polityIdentityEffects(identityCommandPhase.identity, regions, polity.polityId).unrestPressureBp;
    polity.unrestBp = applyIdentityUnrest(polity.unrestBp, pressure);
  }
  for (const penalty of militaryCommandPhase.politicsPenalties) {
    const row = politicsPhase.politics?.polities.find((entry) => entry.polityId === penalty.polityId);
    if (row) {
      row.legitimacyBp = clampBp(row.legitimacyBp + penalty.legitimacy);
      row.stabilityBp = clampBp(row.stabilityBp + penalty.stability);
      row.unrestBp = clampBp(row.unrestBp + penalty.unrest);
    }
  }

  const militaryPhase = resolveMilitaryMonth(state, militaryCommandPhase.military, regions, state.capabilities);
  events.push(...militaryPhase.events);
  const identityPhase = resolveIdentityMonth(identityCommandPhase.identity, regions);
  events.push(...identityPhase.events);

  const resolvedPolities = polities.map((polity) => ({
    id: polity.id, displayName: polity.displayName, treasury: polity.treasury,
    stockpile: [...state.activeResources].sort().map((resource) => ({ resource, amount: polity.stock.get(resource) ?? 0 })),
  }));
  const campaignInput: EconWorldState = {
    ...state,
    ...(diplomacyPhase.diplomacy ? { diplomacy: diplomacyPhase.diplomacy } : {}),
    ...(statecraftPhase.finance ? { finance: statecraftPhase.finance } : {}),
    ...(statecraftPhase.capabilities ? { capabilities: statecraftPhase.capabilities } : {}),
    ...(identityPhase.identity ? { identity: identityPhase.identity } : {}),
    ...(politicsPhase.politics ? { politics: politicsPhase.politics } : {}),
    ...(militaryPhase.military ? { military: militaryPhase.military } : {}),
    polities: resolvedPolities,
    regions,
  };
  const campaignPhase = resolveCampaignMonth(campaignInput, campaignCommandPhase.campaign, campaignCommandPhase.assessments);
  events.push(...campaignPhase.events);

  // ---- 10. Assemble next state, ledger; verify identities; commit revision.
  const nextBase = {
    ...state,
    ...(diplomacyPhase.diplomacy ? { diplomacy: diplomacyPhase.diplomacy } : {}),
    ...(diplomacyPhase.trade ? { trade: diplomacyPhase.trade } : {}),
    ...(statecraftPhase.finance ? { finance: statecraftPhase.finance } : {}),
    ...(statecraftPhase.projects ? { projects: statecraftPhase.projects } : {}),
    ...(statecraftPhase.intelligence ? { intelligence: statecraftPhase.intelligence } : {}),
    ...(statecraftPhase.capabilities ? { capabilities: statecraftPhase.capabilities } : {}),
    ...(identityPhase.identity ? { identity: identityPhase.identity } : {}),
    ...(politicsPhase.politics ? { politics: politicsPhase.politics } : {}),
    ...(militaryPhase.military ? { military: militaryPhase.military } : {}),
    ...(campaignPhase.campaign ? { campaign: campaignPhase.campaign } : {}),
    month: addMonth(state.month),
    turn: state.turn + 1,
    polities: resolvedPolities,
    regions: regions.map((region) => ({ ...region })),
  };
  const nextState: EconWorldState = {
    ...nextBase,
    revision: stateChecksum({ ...nextBase, revision: 'pending' as WorldRevisionId }) as WorldRevisionId,
  };

  const ledger: TurnLedger = {
    month: state.month,
    turn: nextState.turn,
    transfers,
    polities: state.polities.map((prevPolity) => {
      const id = prevPolity.id;
      const regionRows = nextState.regions
        .filter((region) => region.controllerId === id)
        .map((region) => populationRows.get(region.regionId)!);
      const productionEntries: ResourceProduction[] = [];
      const byResource = production.get(id);
      if (byResource) {
        for (const resource of [...byResource.keys()].sort()) {
          const rowsForResource = byResource.get(resource)!;
          productionEntries.push({
            resource,
            total: rowsForResource.reduce((sum, row) => sum + row.amount, 0),
            byRegion: rowsForResource,
          });
        }
      }
      const producedByResource = new Map(productionEntries.map((entry) => [entry.resource, entry.total]));
      const stockMovements: StockMovement[] = [...state.activeResources].sort().map((resource) => {
        const opening = openingStock.get(id)?.get(resource) ?? 0;
        const produced = producedByResource.get(resource) ?? 0;
        const processing = processingUse.get(id)?.get(resource) ?? 0;
        const populationConsumption = populationUse.get(id)?.get(resource) ?? 0;
        const tradeIn = diplomacyPhase.resourceTransfers
          .filter((transfer) => transfer.toPolityId === id && transfer.resource === resource)
          .reduce((sum, transfer) => sum + transfer.amount, 0);
        const tradeOut = diplomacyPhase.resourceTransfers
          .filter((transfer) => transfer.fromPolityId === id && transfer.resource === resource)
          .reduce((sum, transfer) => sum + transfer.amount, 0);
        return {
          resource,
          opening,
          produced,
          processingUse: processing,
          populationUse: populationConsumption,
          ...(state.trade ? { tradeIn, tradeOut } : {}),
          closing: opening + tradeIn - tradeOut + produced - processing - populationConsumption,
        };
      });
      const tax = taxByPolity.get(id)!;
      const food = foodByPolity.get(id)!;
      const entry: PolityLedger = {
        polityId: id,
        populationOpening: openingPopulation.get(id)!,
        populationClosing: regionRows.reduce((sum, row) => sum + row.population, 0),
        populationByRegion: regionRows,
        production: productionEntries,
        taxTotal: tax.total,
        taxByRegion: tax.rows,
        food,
        treasuryOpening: openingTreasury.get(id)!,
        treasuryClosing: polityById.get(id)!.treasury,
        ...(politicsPhase.politics ? {
          politicalSpend: politicsCommandPhase.commandRecords.filter((record) => record.polityId === id).reduce((sum, record) => sum + record.treasurySpent, 0),
        } : {}),
        ...(militaryPhase.military ? {
          treasuryMilitaryNet: militaryCommandPhase.treasuryTransfers.reduce((sum, transfer) =>
            sum + (transfer.toPolityId === id ? transfer.amount : 0) - (transfer.fromPolityId === id ? transfer.amount : 0), 0),
        } : {}),
        ...(statecraftPhase.finance ? {
          finance: statecraftPhase.financeRecords.find((record) => record.polityId === id),
          projectSpend: statecraftPhase.allocations.filter((allocation) => allocation.polityId === id).reduce((sum, allocation) => sum + allocation.spent, 0),
        } : {}),
        ...(state.trade ? {
          treasuryTradeNet: diplomacyPhase.treasuryTransfers.reduce((sum, transfer) =>
            sum + (transfer.toPolityId === id ? transfer.amount : 0) - (transfer.fromPolityId === id ? transfer.amount : 0), 0),
        } : {}),
        stockMovements,
      };
      const investment = investments.get(id);
      if (investment) entry.investment = investment;
      const goods = goodsByPolity.get(id);
      if (goods) entry.goods = goods;
      return entry;
    }),
    ...(state.trade ? {
      trade: {
        executions: diplomacyPhase.executions,
        resourceTransfers: diplomacyPhase.resourceTransfers,
        treasuryTransfers: diplomacyPhase.treasuryTransfers,
      },
    } : {}),
    ...((statecraftPhase.finance || statecraftPhase.projects) ? {
      statecraft: { finance: statecraftPhase.financeRecords, projectAllocations: statecraftPhase.allocations,
        capabilityUnlocks: statecraftPhase.capabilityUnlocks },
    } : {}),
    ...(identityPhase.identity ? {
      identity: { commands: identityCommandPhase.commandRecords, polities: identityPhase.polityRecords, regions: identityPhase.regionRecords },
    } : {}),
    ...(politicsPhase.politics ? {
      politics: { commands: politicsCommandPhase.commandRecords, factionChanges: politicsPhase.records },
    } : {}),
    ...(militaryPhase.military ? {
      military: { commands: militaryCommandPhase.commandRecords, combats: militaryPhase.combats,
        treasuryTransfers: militaryCommandPhase.treasuryTransfers },
    } : {}),
    ...(campaignPhase.campaign ? {
      campaign: { commands: campaignCommandPhase.commandRecords, goals: campaignPhase.goals, crises: campaignPhase.crises, legacy: campaignPhase.legacy },
    } : {}),
  };

  const invariantsChecked = checkInvariants(state, nextState, ledger);

  return { state: nextState, events, ledger, rejections, invariantsChecked };
}
