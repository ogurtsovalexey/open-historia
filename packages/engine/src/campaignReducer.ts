import type { PolityId } from '@open-historia/domain';
import type { CampaignCommand, CommandRejection } from './commands.js';
import type { EconWorldState } from './state.js';
import { clampBp } from './fixedPoint.js';
import { polityIdentityEffects } from './identityReducer.js';
import { ESCALATION_STAGES } from './politics.js';
import { POSITION_PRESSURE, type CampaignState, type LegacyDimensions } from './campaign.js';

export interface CampaignCommandRecord {
  commandId: string;
  polityId: PolityId;
  kind: CampaignCommand['kind'];
  targetId: string;
}
export interface GoalProgressRecord { goalId: string; polityId: PolityId; progressBp: number; achieved: boolean }
export interface CrisisRecord { crisisId: string; templateId: string; status: 'active' | 'escalated' | 'resolved'; evidenceValue: number }
export interface LegacyRecord { assessmentId: string; polityId: PolityId; scores: LegacyDimensions }
export type CampaignEngineEvent =
  | { type: 'campaign-goal-adopted'; polityId: PolityId; goalId: string }
  | { type: 'campaign-goal-achieved'; polityId: PolityId; goalId: string }
  | { type: 'campaign-crisis-triggered'; crisisId: string; templateId: string }
  | { type: 'campaign-crisis-positioned'; crisisId: string; polityId: PolityId; position: string }
  | { type: 'campaign-crisis-status'; crisisId: string; status: 'active' | 'escalated' | 'resolved' }
  | { type: 'campaign-legacy-assessed'; assessmentId: string; polityId: PolityId; horizonReached: boolean };

const clone = (campaign: CampaignState): CampaignState => ({
  ...campaign,
  goals: campaign.goals.map((goal) => ({ ...goal, displayName: { ...goal.displayName } })),
  crisisTemplates: campaign.crisisTemplates.map((template) => ({ ...template, displayName: { ...template.displayName }, participants: [...template.participants] })),
  crises: campaign.crises.map((crisis) => ({ ...crisis, displayName: { ...crisis.displayName }, participants: [...crisis.participants], positions: crisis.positions.map((position) => ({ ...position })) })),
  legacyBaselines: campaign.legacyBaselines.map((entry) => ({ ...entry, scores: { ...entry.scores } })),
  startingRegionCounts: campaign.startingRegionCounts.map((entry) => ({ ...entry })),
  assessments: campaign.assessments.map((entry) => ({ ...entry, scores: { ...entry.scores }, baseline: { ...entry.baseline }, deltas: { ...entry.deltas } })),
});

export function applyCampaignCommands(state: EconWorldState, commands: CampaignCommand[]): {
  campaign: CampaignState | undefined;
  assessments: Extract<CampaignCommand, { kind: 'campaign.assess-legacy' }>[];
  commandRecords: CampaignCommandRecord[];
  events: CampaignEngineEvent[];
  rejections: CommandRejection[];
} {
  const campaign = state.campaign ? clone(state.campaign) : undefined;
  const assessments: Extract<CampaignCommand, { kind: 'campaign.assess-legacy' }>[] = [];
  const commandRecords: CampaignCommandRecord[] = [];
  const events: CampaignEngineEvent[] = [];
  const rejections: CommandRejection[] = [];
  const reject = (command: CampaignCommand, reason: CommandRejection['reason'], detail: string) => rejections.push({ command, reason, detail });
  for (const command of commands) {
    if (!state.polities.some((entry) => entry.id === command.actorPolityId)) { reject(command, 'unknown-actor', `no polity ${command.actorPolityId}`); continue; }
    if (command.effectiveMonth !== state.month) { reject(command, 'wrong-month', `command month ${command.effectiveMonth}, world month ${state.month}`); continue; }
    if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) { reject(command, 'stale-revision', `expected ${command.expectedRevision}, world at ${state.revision}`); continue; }
    if (state.modules?.campaign !== true || !campaign) { reject(command, 'module-disabled', 'campaign module is not enabled'); continue; }
    if (command.kind === 'campaign.adopt-goal') {
      const goal = campaign.goals.find((entry) => entry.goalId === command.goalId);
      if (!goal) { reject(command, 'unknown-goal', `no goal ${command.goalId}`); continue; }
      if (goal.polityId !== command.actorPolityId) { reject(command, 'unauthorized', 'goal belongs to another polity'); continue; }
      if (goal.status !== 'candidate') { reject(command, 'invalid-target', 'goal is not an adaptive candidate'); continue; }
      goal.status = 'active'; goal.adoptedMonth = state.month;
      commandRecords.push({ commandId: command.commandId, polityId: command.actorPolityId, kind: command.kind, targetId: command.goalId });
      events.push({ type: 'campaign-goal-adopted', polityId: command.actorPolityId, goalId: command.goalId });
      continue;
    }
    if (command.kind === 'crisis.set-position') {
      const crisis = campaign.crises.find((entry) => entry.crisisId === command.crisisId);
      if (!crisis) { reject(command, 'unknown-crisis', `no crisis ${command.crisisId}`); continue; }
      if (crisis.status === 'resolved') { reject(command, 'inactive-crisis', 'crisis is already resolved'); continue; }
      if (!crisis.participants.includes(command.actorPolityId)) { reject(command, 'unauthorized', 'actor is not a crisis participant'); continue; }
      const existing = crisis.positions.find((entry) => entry.polityId === command.actorPolityId);
      if (existing) { existing.position = command.position; existing.updatedMonth = state.month; }
      else crisis.positions.push({ polityId: command.actorPolityId, position: command.position, updatedMonth: state.month });
      crisis.positions.sort((a, b) => a.polityId.localeCompare(b.polityId));
      commandRecords.push({ commandId: command.commandId, polityId: command.actorPolityId, kind: command.kind, targetId: command.crisisId });
      events.push({ type: 'campaign-crisis-positioned', crisisId: command.crisisId, polityId: command.actorPolityId, position: command.position });
      continue;
    }
    if (campaign.assessments.some((entry) => entry.assessmentId === command.assessmentId)
      || assessments.some((entry) => entry.assessmentId === command.assessmentId)) {
      reject(command, 'duplicate-id', `legacy assessment ${command.assessmentId} already exists`); continue;
    }
    assessments.push(command);
    commandRecords.push({ commandId: command.commandId, polityId: command.actorPolityId, kind: command.kind, targetId: command.assessmentId });
  }
  return { campaign, assessments, commandRecords, events, rejections };
}

const goalProgress = (state: EconWorldState, goal: CampaignState['goals'][number]): number => {
  if (goal.kind === 'secure-alliance') return state.diplomacy?.agreements.some((entry) => entry.terms.kind === 'agreement'
    && entry.terms.agreementType === 'defensive-alliance'
    && [entry.terms.fromPolityId, entry.terms.toPolityId].includes(goal.polityId)
    && [entry.terms.fromPolityId, entry.terms.toPolityId].includes(goal.targetPolityId)) ? 10000 : 0;
  if (goal.kind === 'unlock-capability') return state.capabilities?.unlocked.some((entry) => entry.polityId === goal.polityId && entry.capabilityId === goal.capabilityId) ? 10000 : 0;
  if (goal.kind === 'control-region') return state.regions.some((entry) => entry.regionId === goal.regionId && entry.controllerId === goal.polityId) ? 10000 : 0;
  const polity = state.politics?.polities.find((entry) => entry.polityId === goal.polityId);
  return polity ? clampBp(Math.floor((Math.min(polity.legitimacyBp, polity.stabilityBp) * 10000) / Math.max(1, goal.thresholdBp))) : 0;
};

const triggerEvidence = (state: EconWorldState, template: CampaignState['crisisTemplates'][number]): { value: number; threshold: number } | null => {
  if (template.kind === 'identity-pressure') {
    const value = polityIdentityEffects(state.identity, state.regions, template.subjectPolityId).unrestPressureBp;
    return value >= template.thresholdBp ? { value, threshold: template.thresholdBp } : null;
  }
  if (template.kind === 'debt-distress') {
    const value = state.finance?.polities.find((entry) => entry.polityId === template.subjectPolityId)?.debtPrincipal ?? 0;
    return value >= template.threshold ? { value, threshold: template.threshold } : null;
  }
  if (template.kind === 'war-escalation') {
    const value = state.military?.wars.some((war) => war.status === 'active' && [...war.attackers, ...war.defenders].includes(template.subjectPolityId)) ? 1 : 0;
    return value === 1 ? { value, threshold: 1 } : null;
  }
  const threshold = ESCALATION_STAGES.indexOf(template.thresholdStage);
  const value = Math.max(-1, ...(state.politics?.factions.filter((entry) => entry.polityId === template.subjectPolityId)
    .map((entry) => ESCALATION_STAGES.indexOf(entry.escalation)) ?? []));
  return value >= threshold ? { value, threshold } : null;
};

const legacyScores = (state: EconWorldState, campaign: CampaignState, polityId: PolityId): LegacyDimensions => {
  const baseline = campaign.legacyBaselines.find((entry) => entry.polityId === polityId)!;
  const treasury = state.polities.find((entry) => entry.id === polityId)?.treasury ?? 0;
  const prosperity = clampBp(Math.floor((treasury * 10000) / baseline.treasuryReference));
  const startingRegions = campaign.startingRegionCounts.find((entry) => entry.polityId === polityId)?.count ?? 1;
  const controlled = state.regions.filter((entry) => entry.controllerId === polityId).length;
  const occupied = state.military?.occupations.filter((entry) => entry.legalControllerId === polityId).length ?? 0;
  const security = clampBp(Math.floor((controlled * 10000) / startingRegions) - occupied * 1000);
  const politics = state.politics?.polities.find((entry) => entry.polityId === polityId);
  const stability = politics ? Math.floor((politics.legitimacyBp + politics.stabilityBp + (10000 - politics.unrestBp)) / 3) : baseline.scores.stability;
  const relations = state.diplomacy?.relations.filter((entry) => entry.polities.includes(polityId)) ?? [];
  const diplomacy = relations.length ? Math.floor(relations.reduce((sum, entry) => sum + entry.trust, 0) / relations.length) : baseline.scores.diplomacy;
  const capability = state.capabilities ? Math.floor(((state.capabilities.unlocked.filter((entry) => entry.polityId === polityId).length) * 10000) / Math.max(1, state.capabilities.catalog.length)) : baseline.scores.capability;
  const identity = state.identity ? polityIdentityEffects(state.identity, state.regions, polityId) : null;
  const pluralism = identity ? Math.floor((identity.taxMultiplierBp + identity.recruitmentMultiplierBp) / 2) : baseline.scores.pluralism;
  return { prosperity, security, stability, diplomacy, capability, pluralism };
};

export function resolveCampaignMonth(state: EconWorldState, campaign: CampaignState | undefined,
  assessments: Extract<CampaignCommand, { kind: 'campaign.assess-legacy' }>[]): {
    campaign: CampaignState | undefined; events: CampaignEngineEvent[]; goals: GoalProgressRecord[]; crises: CrisisRecord[]; legacy: LegacyRecord[];
  } {
  if (!campaign) return { campaign: undefined, events: [], goals: [], crises: [], legacy: [] };
  const events: CampaignEngineEvent[] = []; const goals: GoalProgressRecord[] = []; const crises: CrisisRecord[] = []; const legacy: LegacyRecord[] = [];
  for (const goal of campaign.goals.sort((a, b) => a.goalId.localeCompare(b.goalId))) {
    if (goal.status === 'candidate') continue;
    const progressBp = goalProgress(state, goal); goal.progressBp = progressBp;
    const achieved = goal.status !== 'achieved' && progressBp === 10000;
    if (achieved) { goal.status = 'achieved'; goal.achievedMonth = state.month; events.push({ type: 'campaign-goal-achieved', polityId: goal.polityId, goalId: goal.goalId }); }
    goals.push({ goalId: goal.goalId, polityId: goal.polityId, progressBp, achieved });
  }
  for (const crisis of campaign.crises.filter((entry) => entry.status !== 'resolved').sort((a, b) => a.crisisId.localeCompare(b.crisisId))) {
    if (crisis.positions.length !== crisis.participants.length) continue;
    const pressure = Math.floor(crisis.positions.reduce((sum, entry) => sum + POSITION_PRESSURE[entry.position], 0) / crisis.positions.length);
    const reconciled = crisis.positions.every((entry) => entry.position === 'compromise' || entry.position === 'status-quo');
    const next = reconciled ? 'resolved' : pressure >= 2000 ? 'escalated' : 'active';
    if (crisis.status !== next) {
      crisis.status = next;
      if (next === 'resolved') crisis.resolvedMonth = state.month;
      crises.push({ crisisId: crisis.crisisId, templateId: crisis.templateId, status: next, evidenceValue: crisis.evidenceValue });
      events.push({ type: 'campaign-crisis-status', crisisId: crisis.crisisId, status: next });
    }
  }
  for (const template of campaign.crisisTemplates.sort((a, b) => a.templateId.localeCompare(b.templateId))) {
    if (campaign.crises.some((entry) => entry.templateId === template.templateId)) continue;
    const evidence = triggerEvidence(state, template); if (!evidence) continue;
    const crisisId = `crisis:${template.templateId.slice('crisis-template:'.length)}`;
    campaign.crises.push({ crisisId, templateId: template.templateId, displayName: { ...template.displayName }, kind: template.kind,
      subjectPolityId: template.subjectPolityId, participants: [...template.participants].sort(), status: 'active', openedMonth: state.month,
      resolvedMonth: null, evidenceValue: evidence.value, evidenceThreshold: evidence.threshold, positions: [] });
    crises.push({ crisisId, templateId: template.templateId, status: 'active', evidenceValue: evidence.value });
    events.push({ type: 'campaign-crisis-triggered', crisisId, templateId: template.templateId });
  }
  campaign.crises.sort((a, b) => a.crisisId.localeCompare(b.crisisId));
  for (const command of assessments) {
    const baseline = campaign.legacyBaselines.find((entry) => entry.polityId === command.actorPolityId)!;
    const scores = legacyScores(state, campaign, command.actorPolityId);
    const deltas = Object.fromEntries(Object.keys(scores).map((key) => [key, scores[key as keyof LegacyDimensions] - baseline.scores[key as keyof LegacyDimensions]])) as Record<keyof LegacyDimensions, number>;
    campaign.assessments.push({ assessmentId: command.assessmentId, polityId: command.actorPolityId, month: state.month,
      horizonReached: state.month >= campaign.softHorizonMonth, scores, baseline: { ...baseline.scores }, deltas });
    legacy.push({ assessmentId: command.assessmentId, polityId: command.actorPolityId, scores });
    events.push({ type: 'campaign-legacy-assessed', assessmentId: command.assessmentId, polityId: command.actorPolityId, horizonReached: state.month >= campaign.softHorizonMonth });
  }
  campaign.assessments.sort((a, b) => a.assessmentId.localeCompare(b.assessmentId));
  return { campaign, events, goals, crises, legacy };
}
