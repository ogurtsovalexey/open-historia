import type { PolityId } from '@open-historia/domain';
import type { CommandRejection, StatecraftCommand } from './commands.js';
import { applyBp, clampBp, mulDivFloor } from './fixedPoint.js';
import type { EconRegionState, EconWorldState } from './state.js';
import {
  DEFAULT_BUDGET_PRIORITIES,
  coreProjectTemplates,
  type FinanceState,
  type IntelligenceState,
  type ProjectsState,
} from './statecraft.js';

export interface MutableStatecraftPolity { id: PolityId; treasury: number }

export interface FinanceCommandFlow {
  polityId: PolityId;
  bondsIssued: number;
  voluntaryHaircut: number;
}

export interface ProjectAllocationRecord {
  projectId: string;
  polityId: PolityId;
  requested: number;
  spent: number;
  capacityKind: 'administration' | 'science' | 'industry';
  capacityUsed: number;
  outcome: 'advanced' | 'completed' | 'capacity-blocked' | 'budget-blocked';
}

export interface FinanceResolutionRecord extends FinanceCommandFlow {
  taxBase: number;
  taxEffective: number;
  interestAccrued: number;
  interestPaid: number;
  automaticHaircut: number;
  defaulted: boolean;
  debtOpening: number;
  debtClosing: number;
  creditLimitClosing: number;
}

export type StatecraftEngineEvent =
  | { type: 'finance-policy-changed'; polityId: PolityId }
  | { type: 'bonds-issued'; polityId: PolityId; amount: number }
  | { type: 'debt-restructured'; polityId: PolityId; haircut: number; automatic: boolean }
  | { type: 'project-started'; polityId: PolityId; projectId: string; templateId: string }
  | { type: 'project-updated'; polityId: PolityId; projectId: string }
  | { type: 'project-cancelled'; polityId: PolityId; projectId: string }
  | { type: 'project-completed'; polityId: PolityId; projectId: string }
  | { type: 'intelligence-revealed'; polityId: PolityId; factId: string };

const cloneFinance = (state: FinanceState): FinanceState => ({
  polities: state.polities.map((entry) => ({ ...entry, priorities: { ...entry.priorities } })),
});
const cloneProjects = (state: ProjectsState): ProjectsState => ({
  capacities: state.capacities.map((entry) => ({ ...entry })),
  templates: state.templates.map((entry) => ({ ...entry, displayName: { ...entry.displayName }, capacity: { ...entry.capacity }, effect: { ...entry.effect } })),
  projects: state.projects.map((entry) => ({ ...entry })),
  familiarity: state.familiarity.map((entry) => ({ ...entry })),
});
const cloneIntelligence = (state: IntelligenceState): IntelligenceState => ({
  truths: state.truths.map((entry) => ({ ...entry, summary: { ...entry.summary } })),
  knownFacts: state.knownFacts.map((entry) => ({ ...entry })),
});

const defaultFinance = (state: EconWorldState): FinanceState => ({
  polities: state.polities.map((polity) => ({
    polityId: polity.id, taxBurdenBp: 10000, exemptionBp: 0,
    priorities: { ...DEFAULT_BUDGET_PRIORITIES }, debtPrincipal: 0,
    annualInterestBp: 600, creditLimit: Math.max(1000, polity.treasury * 2),
    interestRemainder: 0, defaultCount: 0, lastDefaultMonth: null,
  })),
});
const defaultProjects = (state: EconWorldState): ProjectsState => ({
  capacities: state.polities.map((polity) => {
    const count = state.regions.filter((region) => region.controllerId === polity.id).length;
    return { polityId: polity.id, administration: Math.max(2, Math.ceil(count / 4)), science: Math.max(1, Math.ceil(count / 8)), industry: Math.max(2, Math.ceil(count / 3)) };
  }),
  templates: structuredClone(coreProjectTemplates), projects: [], familiarity: [],
});

export function applyStatecraftCommands(
  state: EconWorldState,
  commands: StatecraftCommand[],
  polities: MutableStatecraftPolity[],
  regions: EconRegionState[],
): {
  finance: FinanceState | undefined;
  projects: ProjectsState | undefined;
  intelligence: IntelligenceState | undefined;
  flows: FinanceCommandFlow[];
  events: StatecraftEngineEvent[];
  rejections: CommandRejection[];
} {
  let finance = state.finance ? cloneFinance(state.finance) : undefined;
  let projects = state.projects ? cloneProjects(state.projects) : undefined;
  let intelligence = state.intelligence ? cloneIntelligence(state.intelligence) : undefined;
  const polityById = new Map(polities.map((entry) => [entry.id, entry]));
  const flows = new Map<PolityId, FinanceCommandFlow>();
  const events: StatecraftEngineEvent[] = [];
  const rejections: CommandRejection[] = [];
  const flowFor = (polityId: PolityId) => {
    const current = flows.get(polityId) ?? { polityId, bondsIssued: 0, voluntaryHaircut: 0 };
    flows.set(polityId, current);
    return current;
  };
  const reject = (command: StatecraftCommand, reason: CommandRejection['reason'], detail: string) => rejections.push({ command, reason, detail });

  for (const command of commands) {
    const actor = polityById.get(command.actorPolityId);
    if (!actor) { reject(command, 'unknown-actor', `no polity ${command.actorPolityId}`); continue; }
    if (command.effectiveMonth !== state.month) { reject(command, 'wrong-month', `command month ${command.effectiveMonth}, world month ${state.month}`); continue; }
    if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) { reject(command, 'stale-revision', `expected ${command.expectedRevision}, world at ${state.revision}`); continue; }

    if (command.kind === 'finance.set-policy' || command.kind === 'finance.issue-bonds' || command.kind === 'finance.restructure') {
      if (state.modules?.finance !== true) { reject(command, 'module-disabled', 'finance module is not enabled'); continue; }
      finance ??= defaultFinance(state);
      const row = finance.polities.find((entry) => entry.polityId === actor.id)!;
      if (command.kind === 'finance.set-policy') {
        row.taxBurdenBp = command.taxBurdenBp; row.exemptionBp = command.exemptionBp; row.priorities = { ...command.priorities };
        events.push({ type: 'finance-policy-changed', polityId: actor.id });
      } else if (command.kind === 'finance.issue-bonds') {
        const headroom = Math.max(0, row.creditLimit - row.debtPrincipal);
        if (command.amount > headroom) { reject(command, 'credit-limit', `issuance ${command.amount} exceeds headroom ${headroom}`); continue; }
        row.debtPrincipal += command.amount; actor.treasury += command.amount; flowFor(actor.id).bondsIssued += command.amount;
        events.push({ type: 'bonds-issued', polityId: actor.id, amount: command.amount });
      } else {
        if (row.debtPrincipal === 0) { reject(command, 'invalid-amount', 'there is no debt to restructure'); continue; }
        const haircut = applyBp(row.debtPrincipal, 1000, `voluntary haircut ${actor.id}`);
        row.debtPrincipal -= haircut; row.creditLimit = applyBp(row.creditLimit, 9000, `voluntary credit cut ${actor.id}`);
        row.defaultCount += 1; row.lastDefaultMonth = state.month; flowFor(actor.id).voluntaryHaircut += haircut;
        events.push({ type: 'debt-restructured', polityId: actor.id, haircut, automatic: false });
      }
      continue;
    }

    if (state.modules?.projects !== true) { reject(command, 'module-disabled', 'projects module is not enabled'); continue; }
    projects ??= defaultProjects(state);
    if (command.kind === 'project.start') {
      if (projects.projects.some((entry) => entry.projectId === command.projectId)) { reject(command, 'duplicate-id', `project ${command.projectId} already exists`); continue; }
      if (projects.projects.filter((entry) => entry.actorPolityId === actor.id && entry.status === 'active').length >= 8) { reject(command, 'command-limit', 'at most eight active projects per polity'); continue; }
      const template = projects.templates.find((entry) => entry.templateId === command.templateId);
      if (!template) { reject(command, 'unknown-template', `no template ${command.templateId}`); continue; }
      let selectedTargetFactId = command.targetFactId;
      if (template.effect.kind === 'infrastructure') {
        const region = regions.find((entry) => entry.regionId === command.targetRegionId);
        if (!region || region.controllerId !== actor.id) { reject(command, 'invalid-target', 'infrastructure project requires a controlled target region'); continue; }
      } else if (template.effect.kind === 'reveal-intelligence') {
        if (state.modules?.intelligence !== true) { reject(command, 'module-disabled', 'intelligence module is not enabled'); continue; }
        intelligence ??= { truths: [], knownFacts: [] };
        const fact = command.targetFactId
          ? intelligence.truths.find((entry) => entry.factId === command.targetFactId)
          : intelligence.truths.filter((entry) => entry.subjectPolityId === command.targetPolityId
            && !intelligence!.knownFacts.some((known) => known.observerPolityId === actor.id && known.factId === entry.factId))
            .sort((a, b) => a.factId.localeCompare(b.factId))[0];
        if (!fact) { reject(command, 'unknown-fact', `no authored intelligence fact ${command.targetFactId ?? ''}`); continue; }
        if (command.targetPolityId !== fact.subjectPolityId || command.targetPolityId === actor.id) { reject(command, 'invalid-target', 'intelligence target must match the authored foreign subject'); continue; }
        if (intelligence.knownFacts.some((entry) => entry.observerPolityId === actor.id && entry.factId === fact.factId)) { reject(command, 'invalid-target', 'fact is already known'); continue; }
        selectedTargetFactId = fact.factId;
      }
      const familiarity = projects.familiarity.find((entry) => entry.polityId === actor.id && entry.templateId === template.templateId)?.familiarityBp ?? 0;
      const discountBp = Math.min(2500, Math.floor(familiarity / 2));
      const effectiveTotalCost = Math.max(1, applyBp(template.totalCost, 10000 - discountBp, `project cost ${command.projectId}`));
      projects.projects.push({
        projectId: command.projectId, templateId: template.templateId, actorPolityId: actor.id,
        ...(command.targetPolityId ? { targetPolityId: command.targetPolityId } : {}),
        ...(command.targetRegionId ? { targetRegionId: command.targetRegionId } : {}),
        ...(selectedTargetFactId ? { targetFactId: selectedTargetFactId } : {}),
        monthlyFunding: command.monthlyFunding, priority: command.priority, status: 'active', startedMonth: state.month,
        completedMonth: null, progressCost: 0, progressMonths: 0, effectiveTotalCost,
      });
      events.push({ type: 'project-started', polityId: actor.id, projectId: command.projectId, templateId: template.templateId });
    } else {
      const project = projects.projects.find((entry) => entry.projectId === command.projectId);
      if (!project) { reject(command, 'unknown-project', `no project ${command.projectId}`); continue; }
      if (project.actorPolityId !== actor.id) { reject(command, 'unauthorized', 'only the project owner may change it'); continue; }
      if (project.status !== 'active') { reject(command, 'invalid-target', `project ${project.projectId} is ${project.status}`); continue; }
      if (command.kind === 'project.update') {
        project.monthlyFunding = command.monthlyFunding; project.priority = command.priority;
        events.push({ type: 'project-updated', polityId: actor.id, projectId: project.projectId });
      } else {
        project.status = 'cancelled'; project.completedMonth = state.month;
        events.push({ type: 'project-cancelled', polityId: actor.id, projectId: project.projectId });
      }
    }
  }
  projects?.projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
  return { finance, projects, intelligence, flows: [...flows.values()].sort((a, b) => a.polityId.localeCompare(b.polityId)), events, rejections };
}

export function effectiveTax(base: number, finance: FinanceState | undefined, polityId: PolityId): number {
  const row = finance?.polities.find((entry) => entry.polityId === polityId);
  if (!row) return base;
  const burdened = Math.floor((base * row.taxBurdenBp) / 10000);
  return applyBp(burdened, 10000 - row.exemptionBp, `effective tax ${polityId}`);
}

export function resolveStatecraftMonth(
  state: EconWorldState,
  finance: FinanceState | undefined,
  projects: ProjectsState | undefined,
  intelligence: IntelligenceState | undefined,
  commandFlows: FinanceCommandFlow[],
  polities: MutableStatecraftPolity[],
  regions: EconRegionState[],
  taxBaseByPolity: Map<PolityId, number>,
  taxEffectiveByPolity: Map<PolityId, number>,
): {
  finance: FinanceState | undefined;
  projects: ProjectsState | undefined;
  intelligence: IntelligenceState | undefined;
  financeRecords: FinanceResolutionRecord[];
  allocations: ProjectAllocationRecord[];
  events: StatecraftEngineEvent[];
  trustPenalties: Array<{ polityId: PolityId; delta: number }>;
} {
  const polityById = new Map(polities.map((entry) => [entry.id, entry]));
  const flowById = new Map(commandFlows.map((entry) => [entry.polityId, entry]));
  const allocations: ProjectAllocationRecord[] = [];
  const events: StatecraftEngineEvent[] = [];
  const trustPenalties: Array<{ polityId: PolityId; delta: number }> = [];

  if (projects && finance) {
    for (const polity of polities) {
      const financeRow = finance.polities.find((entry) => entry.polityId === polity.id)!;
      const capacity = projects.capacities.find((entry) => entry.polityId === polity.id)!;
      const remainingCapacity = { administration: capacity.administration, science: capacity.science, industry: capacity.industry };
      const categoryRemaining = Object.fromEntries(Object.entries(financeRow.priorities).map(([key, share]) => [key, Math.floor((polity.treasury * share) / 10000)])) as Record<keyof typeof financeRow.priorities, number>;
      const active = projects.projects.filter((entry) => entry.actorPolityId === polity.id && entry.status === 'active')
        .sort((a, b) => b.priority - a.priority || a.projectId.localeCompare(b.projectId));
      for (const project of active) {
        const template = projects.templates.find((entry) => entry.templateId === project.templateId)!;
        const capacityAvailable = remainingCapacity[template.capacity.kind];
        if (capacityAvailable < template.capacity.amount) {
          allocations.push({ projectId: project.projectId, polityId: polity.id, requested: project.monthlyFunding, spent: 0, capacityKind: template.capacity.kind, capacityUsed: 0, outcome: 'capacity-blocked' });
          continue;
        }
        const remainingCost = project.effectiveTotalCost - project.progressCost;
        const scheduled = Math.ceil(project.effectiveTotalCost / template.durationMonths);
        const spent = Math.min(project.monthlyFunding, scheduled, remainingCost, categoryRemaining[template.budgetCategory], polity.treasury);
        if (spent <= 0) {
          allocations.push({ projectId: project.projectId, polityId: polity.id, requested: project.monthlyFunding, spent: 0, capacityKind: template.capacity.kind, capacityUsed: 0, outcome: 'budget-blocked' });
          continue;
        }
        remainingCapacity[template.capacity.kind] -= template.capacity.amount;
        categoryRemaining[template.budgetCategory] -= spent;
        polity.treasury -= spent; project.progressCost += spent; project.progressMonths += 1;
        let outcome: ProjectAllocationRecord['outcome'] = 'advanced';
        if (project.progressCost >= project.effectiveTotalCost && project.progressMonths >= template.durationMonths) {
          project.status = 'completed'; project.completedMonth = state.month; outcome = 'completed';
          if (template.effect.kind === 'infrastructure') {
            const region = regions.find((entry) => entry.regionId === project.targetRegionId)!;
            region.infrastructureBp = clampBp(region.infrastructureBp + template.effect.gainBp);
          } else if (template.effect.kind === 'capacity') {
            capacity[template.effect.capacity] += template.effect.amount;
          } else if (template.effect.kind === 'credit-limit') {
            financeRow.creditLimit += template.effect.amount;
          } else {
            const fact = intelligence?.truths.find((entry) => entry.factId === project.targetFactId);
            if (fact && intelligence && !intelligence.knownFacts.some((entry) => entry.observerPolityId === polity.id && entry.factId === fact.factId)) {
              intelligence.knownFacts.push({ observerPolityId: polity.id, factId: fact.factId, confidence: 'high', observedMonth: state.month, source: 'intelligence', evidenceId: fact.evidenceId, staleAfterMonths: 12 });
              events.push({ type: 'intelligence-revealed', polityId: polity.id, factId: fact.factId });
            }
          }
          const familiar = projects.familiarity.find((entry) => entry.polityId === polity.id && entry.templateId === template.templateId);
          if (familiar) familiar.familiarityBp = Math.min(5000, familiar.familiarityBp + 1000);
          else projects.familiarity.push({ polityId: polity.id, templateId: template.templateId, familiarityBp: 1000 });
          events.push({ type: 'project-completed', polityId: polity.id, projectId: project.projectId });
        }
        allocations.push({ projectId: project.projectId, polityId: polity.id, requested: project.monthlyFunding, spent, capacityKind: template.capacity.kind, capacityUsed: template.capacity.amount, outcome });
      }
    }
    projects.familiarity.sort((a, b) => `${a.polityId}|${a.templateId}`.localeCompare(`${b.polityId}|${b.templateId}`));
    intelligence?.knownFacts.sort((a, b) => `${a.observerPolityId}|${a.factId}`.localeCompare(`${b.observerPolityId}|${b.factId}`));
  }

  const financeRecords: FinanceResolutionRecord[] = [];
  if (finance) {
    for (const row of finance.polities) {
      const polity = polityById.get(row.polityId)!;
      const flow = flowById.get(row.polityId) ?? { polityId: row.polityId, bondsIssued: 0, voluntaryHaircut: 0 };
      const debtOpening = row.debtPrincipal - flow.bondsIssued + flow.voluntaryHaircut;
      const accrued = mulDivFloor(row.debtPrincipal, row.annualInterestBp, 120000, `debt interest ${row.polityId}`, row.interestRemainder);
      row.interestRemainder = accrued.r;
      let interestPaid = accrued.q;
      let automaticHaircut = 0;
      let defaulted = false;
      if (accrued.q > polity.treasury) {
        interestPaid = polity.treasury; polity.treasury = 0; defaulted = true;
        automaticHaircut = applyBp(row.debtPrincipal, 2000, `automatic haircut ${row.polityId}`);
        row.debtPrincipal -= automaticHaircut;
        row.creditLimit = applyBp(row.creditLimit, 7500, `default credit cut ${row.polityId}`);
        row.defaultCount += 1; row.lastDefaultMonth = state.month;
        trustPenalties.push({ polityId: row.polityId, delta: -750 });
        events.push({ type: 'debt-restructured', polityId: row.polityId, haircut: automaticHaircut, automatic: true });
      } else polity.treasury -= accrued.q;
      financeRecords.push({ ...flow, taxBase: taxBaseByPolity.get(row.polityId) ?? 0, taxEffective: taxEffectiveByPolity.get(row.polityId) ?? 0, interestAccrued: accrued.q, interestPaid, automaticHaircut, defaulted, debtOpening, debtClosing: row.debtPrincipal, creditLimitClosing: row.creditLimit });
    }
  }
  return { finance, projects, intelligence, financeRecords, allocations, events, trustPenalties };
}
