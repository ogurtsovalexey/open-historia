import type { PolityId } from '@open-historia/domain';
import type { CommandRejection, PoliticsCommand } from './commands.js';
import { clampBp } from './fixedPoint.js';
import type { DiplomacyState } from './diplomacy.js';
import type { EconWorldState } from './state.js';
import type { FinanceState, ProjectsState } from './statecraft.js';
import {
  bandToBp,
  ESCALATION_STAGES,
  type PoliticalCharacter,
  type PoliticsState,
} from './politics.js';

export interface MutablePoliticsPolity { id: PolityId; treasury: number }

export interface PoliticalCommandRecord {
  polityId: PolityId;
  factionId?: string;
  commandKind: PoliticsCommand['kind'];
  response?: 'concede' | 'repress' | 'refuse';
  treasurySpent: number;
}

export interface PoliticalResolutionRecord {
  polityId: PolityId;
  factionId: string;
  supportOpening: number;
  taxEffect: number;
  budgetEffect: number;
  projectEffect: number;
  diplomacyEffect: number;
  defaultEffect: number;
  supportClosing: number;
  escalationOpening: string;
  escalationClosing: string;
}

export type PoliticsEngineEvent =
  | { type: 'faction-answered'; polityId: PolityId; factionId: string; response: 'concede' | 'repress' | 'refuse' }
  | { type: 'character-appointed'; polityId: PolityId; characterId: string; office: string }
  | { type: 'character-created'; polityId: PolityId; characterId: string }
  | { type: 'power-transferred'; polityId: PolityId; fromCharacterId: string; toCharacterId: string; cause: 'abdication' | 'coup' }
  | { type: 'political-escalation'; polityId: PolityId; factionId: string; from: string; to: string };

const clonePolitics = (state: PoliticsState): PoliticsState => ({
  polities: state.polities.map((entry) => ({ ...entry, ...(entry.strategyAuthority ? { strategyAuthority: {
    ...entry.strategyAuthority, currentConstraints: [...entry.strategyAuthority.currentConstraints],
  } } : {}) })),
  factions: state.factions.map((entry) => ({ ...entry, displayName: { ...entry.displayName },
    ...(entry.politicalIdentity ? { politicalIdentity: { ...entry.politicalIdentity,
      legitimacyBases: [...entry.politicalIdentity.legitimacyBases],
      governingPrinciples: [...entry.politicalIdentity.governingPrinciples],
      strategicPreferences: [...entry.politicalIdentity.strategicPreferences], taboos: [...entry.politicalIdentity.taboos],
    } } : {}) })),
  characters: state.characters.map((entry) => ({
    ...entry, displayName: { ...entry.displayName }, startingTraits: [...entry.startingTraits],
    experienceTraits: [...entry.experienceTraits], relations: entry.relations.map((relation) => ({ ...relation })),
    ...(entry.leaderCard ? { leaderCard: { ...entry.leaderCard,
      factCard: [...entry.leaderCard.factCard], sourceRefs: [...entry.leaderCard.sourceRefs] } } : {}),
  })),
});

const transferPower = (
  politics: PoliticsState,
  polityId: PolityId,
  successorId: string,
  month: string,
  cause: 'abdication' | 'coup',
): PoliticsEngineEvent => {
  const polity = politics.polities.find((entry) => entry.polityId === polityId)!;
  const oldRuler = politics.characters.find((entry) => entry.characterId === polity.rulerCharacterId)!;
  const successor = politics.characters.find((entry) => entry.characterId === successorId)!;
  for (const character of politics.characters) {
    if (character.polityId === polityId && (character.office === 'ruler' || character.office === 'heir')) character.office = null;
  }
  successor.office = 'ruler';
  polity.rulerCharacterId = successor.characterId;
  if (polity.strategyAuthority) {
    if (polity.strategyAuthority.headOfStateCharacterId === oldRuler.characterId || cause === 'coup') {
      polity.strategyAuthority.headOfStateCharacterId = successor.characterId;
    }
    if (polity.strategyAuthority.decisionAuthorityCharacterId === oldRuler.characterId || cause === 'coup') {
      polity.strategyAuthority.decisionAuthorityCharacterId = successor.characterId;
    }
    polity.strategyAuthority.rulingFactionId = successor.factionId;
  }
  polity.heirCharacterId = politics.characters
    .filter((entry) => entry.polityId === polityId && entry.characterId !== successor.characterId
      && entry.characterId !== oldRuler.characterId && entry.office === null)
    .sort((a, b) => b.loyaltyBp - a.loyaltyBp || a.characterId.localeCompare(b.characterId))[0]?.characterId ?? null;
  const heir = politics.characters.find((entry) => entry.characterId === polity.heirCharacterId);
  if (heir) heir.office = 'heir';
  polity.governmentChanges += 1;
  polity.lastTransferMonth = month;
  return { type: 'power-transferred', polityId, fromCharacterId: oldRuler.characterId, toCharacterId: successor.characterId, cause };
};

export function applyPoliticsCommands(
  state: EconWorldState,
  commands: PoliticsCommand[],
  polities: MutablePoliticsPolity[],
): {
  politics: PoliticsState | undefined;
  commandRecords: PoliticalCommandRecord[];
  events: PoliticsEngineEvent[];
  rejections: CommandRejection[];
} {
  const politics = state.politics ? clonePolitics(state.politics) : undefined;
  const polityById = new Map(polities.map((entry) => [entry.id, entry]));
  const commandRecords: PoliticalCommandRecord[] = [];
  const events: PoliticsEngineEvent[] = [];
  const rejections: CommandRejection[] = [];
  const reject = (command: PoliticsCommand, reason: CommandRejection['reason'], detail: string) =>
    rejections.push({ command, reason, detail });

  for (const command of commands) {
    const actor = polityById.get(command.actorPolityId);
    if (!actor) { reject(command, 'unknown-actor', `no polity ${command.actorPolityId}`); continue; }
    if (command.effectiveMonth !== state.month) { reject(command, 'wrong-month', `command month ${command.effectiveMonth}, world month ${state.month}`); continue; }
    if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) { reject(command, 'stale-revision', `expected ${command.expectedRevision}, world at ${state.revision}`); continue; }
    if (state.modules?.politics !== true || !politics) { reject(command, 'module-disabled', 'politics module is not enabled'); continue; }

    if (command.kind === 'politics.respond') {
      const faction = politics.factions.find((entry) => entry.factionId === command.factionId);
      if (!faction) { reject(command, 'unknown-faction', `no faction ${command.factionId}`); continue; }
      if (faction.polityId !== actor.id) { reject(command, 'unauthorized', 'cannot answer another polity faction'); continue; }
      if (faction.escalation === 'calm') { reject(command, 'inactive-crisis', `${faction.factionId} has no active demand`); continue; }
      if (faction.lastResponseMonth === state.month) { reject(command, 'command-limit', `${faction.factionId} was already answered this month`); continue; }
      let treasurySpent = 0;
      const polity = politics.polities.find((entry) => entry.polityId === actor.id)!;
      if (command.response === 'concede') {
        treasurySpent = Math.max(100, Math.floor(actor.treasury / 20));
        if (actor.treasury < treasurySpent) { reject(command, 'insufficient-treasury', `concession costs ${treasurySpent}`); continue; }
        actor.treasury -= treasurySpent;
        faction.supportBp = clampBp(faction.supportBp + 1400);
        polity.unrestBp = clampBp(polity.unrestBp - 900);
        const index = ESCALATION_STAGES.indexOf(faction.escalation);
        faction.escalation = ESCALATION_STAGES[Math.max(0, index - 1)]!;
      } else if (command.response === 'repress') {
        faction.supportBp = clampBp(faction.supportBp - 900);
        polity.unrestBp = clampBp(polity.unrestBp + 500);
        polity.stabilityBp = clampBp(polity.stabilityBp - 300);
        const index = ESCALATION_STAGES.indexOf(faction.escalation);
        faction.escalation = ESCALATION_STAGES[Math.max(0, index - 1)]!;
      } else {
        faction.supportBp = clampBp(faction.supportBp - 600);
        polity.unrestBp = clampBp(polity.unrestBp + 400);
        const index = ESCALATION_STAGES.indexOf(faction.escalation);
        faction.escalation = ESCALATION_STAGES[Math.min(ESCALATION_STAGES.length - 1, index + 1)]!;
      }
      faction.lastResponseMonth = state.month;
      commandRecords.push({ polityId: actor.id, factionId: faction.factionId, commandKind: command.kind, response: command.response, treasurySpent });
      events.push({ type: 'faction-answered', polityId: actor.id, factionId: faction.factionId, response: command.response });
      continue;
    }

    if (command.kind === 'character.create') {
      if (politics.characters.some((entry) => entry.characterId === command.characterId)) { reject(command, 'duplicate-id', `character ${command.characterId} already exists`); continue; }
      const faction = politics.factions.find((entry) => entry.factionId === command.factionId);
      if (!faction) { reject(command, 'unknown-faction', `no faction ${command.factionId}`); continue; }
      if (faction.polityId !== actor.id) { reject(command, 'unauthorized', 'fictional character faction belongs to another polity'); continue; }
      if (politics.characters.filter((entry) => entry.polityId === actor.id).length >= 12) { reject(command, 'command-limit', 'at most twelve political characters per polity'); continue; }
      const character: PoliticalCharacter = {
        characterId: command.characterId, polityId: actor.id, displayName: { ...command.displayName }, origin: command.origin,
        factionId: faction.factionId, office: null, startingTraits: [command.aptitudeTrait], experienceTraits: [],
        loyaltyBp: bandToBp(command.loyaltyBand), ambitionBp: bandToBp(command.ambitionBand), relations: [],
      };
      politics.characters.push(character);
      commandRecords.push({ polityId: actor.id, commandKind: command.kind, treasurySpent: 0 });
      events.push({ type: 'character-created', polityId: actor.id, characterId: character.characterId });
      continue;
    }

    if (command.kind === 'politics.appoint') {
      const character = politics.characters.find((entry) => entry.characterId === command.characterId);
      if (!character) { reject(command, 'unknown-character', `no character ${command.characterId}`); continue; }
      if (character.polityId !== actor.id) { reject(command, 'unauthorized', 'cannot appoint a foreign character'); continue; }
      const incumbent = politics.characters.find((entry) => entry.polityId === actor.id && entry.office === command.office);
      if (incumbent?.characterId === character.characterId) { reject(command, 'office-conflict', `${character.characterId} already holds ${command.office}`); continue; }
      if (character.office === 'ruler' || character.office === 'heir') { reject(command, 'office-conflict', `${character.characterId} holds protected office ${character.office}`); continue; }
      if (incumbent) { incumbent.office = null; incumbent.loyaltyBp = clampBp(incumbent.loyaltyBp - 500); }
      character.office = command.office;
      character.loyaltyBp = clampBp(character.loyaltyBp + 400);
      commandRecords.push({ polityId: actor.id, commandKind: command.kind, treasurySpent: 0 });
      events.push({ type: 'character-appointed', polityId: actor.id, characterId: character.characterId, office: command.office });
      continue;
    }

    const politicalPolity = politics.polities.find((entry) => entry.polityId === actor.id)!;
    if (!politicalPolity.heirCharacterId) { reject(command, 'no-successor', `${actor.id} has no lawful heir`); continue; }
    const heir = politics.characters.find((entry) => entry.characterId === politicalPolity.heirCharacterId);
    if (!heir || heir.polityId !== actor.id || heir.office !== 'heir') { reject(command, 'no-successor', 'lawful heir reference is invalid'); continue; }
    events.push(transferPower(politics, actor.id, heir.characterId, state.month, 'abdication'));
    politicalPolity.legitimacyBp = clampBp(politicalPolity.legitimacyBp - 500);
    commandRecords.push({ polityId: actor.id, commandKind: command.kind, treasurySpent: 0 });
  }
  politics?.characters.sort((a, b) => a.characterId.localeCompare(b.characterId));
  return { politics, commandRecords, events, rejections };
}

const agreementKinds = (diplomacy: DiplomacyState | undefined, polityId: PolityId): string[] =>
  (diplomacy?.agreements ?? []).filter((entry) => entry.terms.kind === 'agreement'
    && (entry.terms.fromPolityId === polityId || entry.terms.toPolityId === polityId))
    .map((entry) => entry.terms.kind === 'agreement' ? entry.terms.agreementType : '').sort();

export function resolvePoliticsMonth(
  state: EconWorldState,
  politics: PoliticsState | undefined,
  finance: FinanceState | undefined,
  projects: ProjectsState | undefined,
  diplomacy: DiplomacyState | undefined,
): { politics: PoliticsState | undefined; records: PoliticalResolutionRecord[]; events: PoliticsEngineEvent[] } {
  if (!politics) return { politics, records: [], events: [] };
  const records: PoliticalResolutionRecord[] = [];
  const events: PoliticsEngineEvent[] = [];
  for (const polity of politics.polities) {
    const financeRow = finance?.polities.find((entry) => entry.polityId === polity.polityId);
    const agreements = agreementKinds(diplomacy, polity.polityId);
    const factions = politics.factions.filter((entry) => entry.polityId === polity.polityId).sort((a, b) => a.factionId.localeCompare(b.factionId));
    for (const faction of factions) {
      const supportOpening = faction.supportBp;
      const escalationOpening = faction.escalation;
      const taxEffect = financeRow ? Math.max(-1200, -Math.floor(Math.abs(financeRow.taxBurdenBp - faction.idealTaxBurdenBp) / 4)) : 0;
      const priority = financeRow?.priorities[faction.preferredBudgetCategory] ?? 2000;
      const budgetEffect = Math.max(-500, Math.min(500, Math.floor((priority - 2000) / 4)));
      const projectEffect = projects?.projects.some((entry) => entry.actorPolityId === polity.polityId && entry.status === 'active'
        && projects.templates.find((template) => template.templateId === entry.templateId)?.budgetCategory === faction.preferredBudgetCategory) ? 200 : 0;
      const hasSecurityAgreement = agreements.some((entry) => entry === 'defensive-alliance' || entry === 'guarantee');
      const diplomacyEffect = faction.foreignPolicy === 'hawk' ? (hasSecurityAgreement ? 200 : -100)
        : faction.foreignPolicy === 'pacifist' ? (hasSecurityAgreement ? -200 : 100) : 0;
      const defaultEffect = (financeRow?.lastDefaultMonth === state.month) ? -500 : 0;
      faction.supportBp = clampBp(faction.supportBp + taxEffect + budgetEffect + projectEffect + diplomacyEffect + defaultEffect);
      let escalationClosing = faction.escalation;
      if (faction.lastResponseMonth !== state.month) {
        const index = ESCALATION_STAGES.indexOf(faction.escalation);
        if (faction.supportBp < 3000) escalationClosing = ESCALATION_STAGES[Math.min(ESCALATION_STAGES.length - 1, index + 1)]!;
        else if (faction.supportBp >= 6000) escalationClosing = ESCALATION_STAGES[Math.max(0, index - 1)]!;
      }
      if (faction.escalation === 'coup' && escalationClosing === 'rebellion' && faction.supportBp < 1500) {
        const leader = politics.characters.find((entry) => entry.characterId === faction.leaderCharacterId);
        if (leader && leader.polityId === polity.polityId && leader.characterId !== polity.rulerCharacterId) {
          events.push(transferPower(politics, polity.polityId, leader.characterId, state.month, 'coup'));
          polity.legitimacyBp = 3500; polity.stabilityBp = 3000; polity.unrestBp = 5000;
          escalationClosing = 'calm'; faction.supportBp = 5000;
        }
      }
      if (escalationClosing !== escalationOpening) events.push({ type: 'political-escalation', polityId: polity.polityId, factionId: faction.factionId, from: escalationOpening, to: escalationClosing });
      faction.escalation = escalationClosing;
      records.push({ polityId: polity.polityId, factionId: faction.factionId, supportOpening, taxEffect, budgetEffect, projectEffect, diplomacyEffect, defaultEffect, supportClosing: faction.supportBp, escalationOpening, escalationClosing });
    }
    const weightedDissatisfaction = factions.reduce((sum, faction) => sum + Math.floor(((10000 - faction.supportBp) * faction.powerBp) / 10000), 0);
    const targetUnrest = Math.floor(weightedDissatisfaction / Math.max(1, factions.length));
    polity.unrestBp = clampBp(polity.unrestBp + Math.max(-300, Math.min(300, targetUnrest - polity.unrestBp)));
    polity.stabilityBp = clampBp(polity.stabilityBp + (polity.unrestBp > 6000 ? -200 : polity.unrestBp < 3000 ? 100 : 0));
    polity.legitimacyBp = clampBp(polity.legitimacyBp + (polity.stabilityBp > 6000 ? 100 : polity.stabilityBp < 3000 ? -150 : 0));
  }
  politics.factions.sort((a, b) => a.factionId.localeCompare(b.factionId));
  politics.characters.sort((a, b) => a.characterId.localeCompare(b.characterId));
  return { politics, records, events };
}
