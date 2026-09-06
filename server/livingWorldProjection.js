import { processes, worldV2 } from '@open-historia/engine';

export const INTENT_FIRST_UI_SCHEMA_VERSION = 'open-historia-ui/intent-first/1';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const formatNumber = (value) => number.format(value);
const applyBp = (value, bp) => Number(BigInt(value) * BigInt(bp) / 10000n);
const labelOf = (value) => String(value ?? '').split(':').at(-1).replaceAll('-', ' ');
const localized = (value, locale) => value?.[locale] ?? value?.en ?? '';

// This is an index for a semantic interpreter, not a serialized world copy.
// Stable caps prevent a long campaign from making an already-grounded player
// preview impossible to confirm merely because its context grew.
const PLAYER_INTENT_CONTEXT_MAX = Object.freeze({
  polities: 64, regions: 96, formations: 32, concepts: 32, processes: 24,
  relationships: 32, tributeObligations: 32, evidence: 96, labelLength: 120,
});

function contextLabel(value, locale) {
  return localized(value, locale).replace(/\s+/gu, ' ').trim().slice(0, PLAYER_INTENT_CONTEXT_MAX.labelLength);
}

function boundedContextEntries(entries, maximum, preferred = () => false) {
  return [...entries].sort((left, right) => (
    Number(preferred(right)) - Number(preferred(left))
    || String(left.entityId ?? left.evidenceId).localeCompare(String(right.entityId ?? right.evidenceId))
  )).slice(0, maximum);
}

function visibleEvidence(state, polityId) {
  const registry = worldV2.selectEvidenceRegistry(state, polityId).value.entries;
  return new Map(registry.map((entry) => [entry.evidenceId, entry]));
}

function groundedEvidence(ids, visible, fallback = []) {
  const selected = [...new Set(ids)].filter((id) => visible.has(id)).sort();
  return (selected.length > 0 ? selected : fallback).slice(0, 24);
}

function fact(factId, label, value, evidenceIds, why = []) {
  if (evidenceIds.length === 0) {
    return { factId, label, value: null, authority: 'unknown', unknownReason: 'No visible canonical evidence.', evidenceIds: [] };
  }
  return { factId, label, value, authority: 'derived', evidenceIds, why };
}

function processProjection(state, process, visible, locale) {
  const envelope = processes.buildFeasibilityEnvelope(state, process);
  const evidenceIds = groundedEvidence(envelope.evidenceIds, visible);
  if (evidenceIds.length === 0) return null;
  const concept = process.conceptId ? state.concepts.find((entry) => entry.conceptId === process.conceptId) : null;
  const progressPercent = Math.trunc(process.progressBp / 100);
  return {
    processId: process.processId,
    name: localized(concept?.displayName, locale) || labelOf(process.kind),
    nameRu: concept?.displayName?.ru ?? null,
    direction: labelOf(process.direction),
    stage: process.stage,
    pace: process.currentPace,
    feasibility: envelope.reasons.length === 0 ? 'Feasible under current known conditions' : envelope.reasons.join('; '),
    progressLabel: `${progressPercent}% through ${process.stage}`,
    progressPercent,
    nextCheckpoint: process.stage === 'institutionalized' ? 'Institutionalized' : 'Next stage boundary',
    mainInputs: envelope.opportunityCosts.map((entry) => `${labelOf(entry.resourceId)}: ${formatNumber(entry.amount)}`),
    blockers: envelope.blockers.map(labelOf),
    accelerators: envelope.accelerators.map(labelOf),
    support: process.sponsorEntityRefs.map((id) => localized(state.polities.find((entry) => entry.id === id)?.displayName, locale) || labelOf(id)),
    opposition: process.prerequisites.oppositionEvidenceIds.map(() => 'Recorded opposition'),
    spending: formatNumber(process.funding),
    latestChanges: process.lastAdvancedMonth ? [`Last resolved ${process.lastAdvancedMonth}`] : ['Not yet resolved'],
    lastSemanticDecision: `${process.currentPace} pace toward ${labelOf(process.direction)}`,
    evidenceIds,
  };
}

function territoryEffectProjection(state, transition, visible, locale) {
  const region = state.regions.find((entry) => entry.regionId === transition.regionId);
  if (!region) return null;
  const snapshot = worldV2.deriveRegionSnapshot(state, region.regionId);
  const before = transition.controlBefore;
  const after = transition.controlAfter;
  const controlled = (control, field) => control.actualControllerPolityId ? applyBp(snapshot.value[field], control[field === 'productiveCapacity' ? 'extractionAccessBp' : 'administrationAccessBp']) : 0;
  const recruitment = (control) => control.actualControllerPolityId
    ? applyBp(snapshot.value.eligiblePopulation, control.recruitmentAccessBp) : 0;
  const formationExceptions = state.formations
    .filter((formation) => formation.personnelOrigins.some((origin) => origin.regionId === region.regionId)
      && formation.polityId !== after.actualControllerPolityId)
    .map((formation) => ({ formationId: formation.formationId, polityId: formation.polityId, personnel: formation.personnelOrigins
      .filter((origin) => origin.regionId === region.regionId).reduce((sum, origin) => sum + origin.personnel, 0) }))
    .sort((left, right) => left.formationId.localeCompare(right.formationId));
  const evidenceIds = groundedEvidence(snapshot.evidenceIds, visible, region.evidenceIds);
  if (evidenceIds.length === 0) return null;
  return {
    transferId: `transfer:${region.regionId}:${after.actualControllerPolityId}`,
    regionName: localized(region.displayName, locale) || labelOf(region.regionId),
    fromPolityId: before.legalOwnerPolityId,
    toPolityId: after.legalOwnerPolityId,
    population: formatNumber(snapshot.value.population),
    taxBefore: formatNumber(controlled(before, 'fiscalBase')),
    taxAfter: formatNumber(controlled(after, 'fiscalBase')),
    outputBefore: formatNumber(controlled(before, 'productiveCapacity')),
    outputAfter: formatNumber(controlled(after, 'productiveCapacity')),
    recruitmentBefore: formatNumber(recruitment(before)),
    recruitmentAfter: formatNumber(recruitment(after)),
    formationExceptions: formationExceptions.map((entry) => ({
      label: `${labelOf(entry.formationId)} (${labelOf(entry.polityId)})`, personnel: formatNumber(entry.personnel),
    })),
    evidenceIds,
  };
}

function interpretationProjection(intent, fallbackEvidence) {
  if (!intent || intent.status !== 'pending') return null;
  return {
    interpretationId: intent.interpretationId,
    sourceText: intent.sourceText,
    confirmationRequired: true,
    questions: intent.questions ?? [],
    // Older saved previews predate the rule that deterministic claims carry
    // visible evidence. Repair the read-only projection rather than mutating
    // historic revisions, so a legacy pending preview cannot crash the UI.
    claims: (intent.claims ?? []).map((claim) => (
      (claim.status === 'supported' || claim.status === 'contradicted')
        && (!Array.isArray(claim.evidenceIds) || claim.evidenceIds.length === 0)
        ? { ...claim, evidenceIds: fallbackEvidence }
        : claim
    )),
    requestedActions: intent.requestedActions ?? [],
    proposedInitiatives: intent.proposedInitiatives ?? [],
    preview: intent.preview ?? {
      cost: { kind: 'unknown', label: 'Requires semantic and material resolution' },
      duration: { kind: 'unknown', label: 'Depends on feasibility and chosen pace' },
      risks: ['The requested outcome may exceed current institutions or material capacity'],
      opportunityCosts: ['Committed capacity cannot serve every objective at once'],
      affected: [],
      evidenceIds: fallbackEvidence,
    },
  };
}

export function buildIntentFirstProjection({ session, playerPolityId, locale = 'en' }) {
  const state = session.state;
  const polity = state.polities.find((entry) => entry.id === playerPolityId);
  if (!polity) throw new Error(`Unknown player polity ${playerPolityId}`);
  const visible = visibleEvidence(state, polity.id);
  const snapshotProjection = worldV2.derivePolitySnapshot(state, polity.id);
  const snapshot = snapshotProjection.value;
  const snapshotEvidence = groundedEvidence(snapshotProjection.evidenceIds, visible, [...visible.keys()].slice(0, 1));
  const controlledRegions = snapshot.contributions.filter((entry) => entry.controlledPopulation > 0);
  const occupations = state.regions.filter((region) => (
    region.control.actualControllerPolityId === polity.id
    && region.control.legalOwnerPolityId !== polity.id
  ));
  const pendingIntent = interpretationProjection(session.playerIntent, snapshotEvidence);
  const last = session.lastTurn;
  const territoryEffects = (last?.strategicRecords ?? [])
    .flatMap((record) => record.territorialTransitions ?? [])
    .map((transition) => territoryEffectProjection(state, transition, visible, locale))
    .filter(Boolean);
  const changes = last?.kind === 'world-month-advanced' ? [{
    changeId: `change:clock-${state.turn}`,
    magnitude: `Now ${state.month}`,
    label: `Time advanced through ${last.submonths?.length ?? 1} deterministic monthly ${((last.submonths?.length ?? 1) === 1) ? 'boundary' : 'boundaries'}`,
    authority: 'canonical',
    evidenceIds: groundedEvidence([last.clock?.evidenceId], visible, snapshotEvidence),
    causes: [{ category: 'other', label: 'Confirmed time advance', contribution: 'One calendar month' }],
  }] : [];
  const active = state.processes
    .filter((entry) => entry.status === 'active' && entry.sponsorEntityRefs.includes(polity.id))
    .map((entry) => processProjection(state, entry, visible, locale))
    .filter(Boolean);
  const relationships = state.relationships.filter((entry) => entry.participantPolityIds.includes(polity.id));
  const pendingProposals = state.diplomaticProposals.filter((entry) => (
    entry.status === 'pending'
    && (entry.proposerPolityId === polity.id || entry.recipientPolityIds.includes(polity.id))
  ));
  const tributeObligations = state.tributeObligations.filter((entry) => (
    entry.payerPolityIds.includes(polity.id) || entry.beneficiaries.some((beneficiary) => beneficiary.polityId === polity.id)
  ));
  const tributeEvidence = groundedEvidence(tributeObligations.flatMap((entry) => entry.evidenceIds), visible);
  const outgoing = tributeObligations.filter((entry) => entry.payerPolityIds.includes(polity.id));
  const incoming = tributeObligations.filter((entry) => entry.beneficiaries.some((beneficiary) => beneficiary.polityId === polity.id));
  const outgoingGoods = outgoing.flatMap((entry) => entry.deliveries.map((delivery) => (
    `${labelOf(delivery.commodityId)} ${formatNumber(applyBp(delivery.quantity, entry.complianceBp))}`
  )));
  const incomingGoods = incoming.flatMap((entry) => {
    const beneficiary = entry.beneficiaries.find((candidate) => candidate.polityId === polity.id);
    return entry.deliveries.map((delivery) => (
      `${labelOf(delivery.commodityId)} ${formatNumber(applyBp(applyBp(delivery.quantity, entry.complianceBp), beneficiary?.shareBp ?? 0))}`
    ));
  });
  const outgoingLabor = outgoing.reduce((sum, entry) => sum + applyBp(entry.laborService?.people ?? 0, entry.complianceBp), 0);
  const outgoingMilitary = outgoing.reduce((sum, entry) => sum + applyBp(entry.militaryService?.personnel ?? 0, entry.complianceBp), 0);
  const tributeFacts = tributeObligations.length === 0 ? [] : [
    fact('fact:tribute-outgoing', 'Scheduled outgoing tribute', outgoingGoods.length > 0 ? outgoingGoods.join(' · ') : 'none', tributeEvidence, ['Every listed delivery is debited from payer stock before beneficiary credit']),
    fact('fact:tribute-incoming', 'Scheduled incoming tribute', incomingGoods.length > 0 ? incomingGoods.join(' · ') : 'none', tributeEvidence, ['Beneficiary shares are applied to conserved delivered goods']),
    fact('fact:tribute-service', 'Reserved tribute service', `${formatNumber(outgoingLabor)} labor · ${formatNumber(outgoingMilitary)} military`, tributeEvidence, ['Reserved service is already removed from available workforce and recruitment']),
  ];

  return {
    schemaVersion: INTENT_FIRST_UI_SCHEMA_VERSION,
    revision: state.revision,
    asOf: state.month,
    locale,
    playerPolity: { polityId: polity.id, displayName: localized(polity.displayName, locale) },
    briefing: {
      headline: pendingIntent ? 'Confirm how your orders were understood' : `${localized(polity.displayName, locale)} at the opening of turn ${state.turn + 1}`,
      summary: pendingIntent
        ? 'Claims about the past are separated from requested future actions. No material state changes before confirmation.'
        : `${formatNumber(snapshot.controlledPopulation)} people under actual control across ${controlledRegions.length} regions.`,
      changes,
      territoryEffects,
    },
    facts: [
      fact('fact:controlled-population', 'Population under actual control', formatNumber(snapshot.controlledPopulation), snapshotEvidence, ['Summed from regional population cohorts and current actual control']),
      fact('fact:administered-population', 'Effectively administered population', formatNumber(snapshot.administeredPopulation), snapshotEvidence, ['Control access limits how much population administration reaches']),
      fact('fact:workforce', 'Available workforce', formatNumber(snapshot.workforce), snapshotEvidence, ['Mobilized personnel are removed from potential civilian workforce']),
      fact('fact:treasury', 'Treasury', formatNumber(snapshot.treasury), groundedEvidence(polity.evidenceIds, visible, snapshotEvidence)),
      fact('fact:regional-output', 'Accessible productive capacity', formatNumber(snapshot.regionalOutput), snapshotEvidence, ['Extraction access is applied region by region']),
      fact('fact:fielded-personnel', 'Fielded personnel', formatNumber(snapshot.fieldedPersonnel), snapshotEvidence, ['Summed from canonical formations']),
      fact('fact:available-manpower', 'Unmobilized recruitable population', formatNumber(snapshot.availableManpower), snapshotEvidence, ['Population eligibility and regional recruitment access set the ceiling']),
      fact('fact:supply-capacity', 'Accessible supply capacity', formatNumber(snapshot.supplyCapacity), snapshotEvidence),
      ...tributeFacts,
    ],
    interpretation: pendingIntent,
    processes: active,
    situations: occupations.map((region) => ({
      situationId: `situation:${region.regionId.replaceAll(':', '-')}`,
      title: `${localized(region.displayName, locale)} is occupied`,
      urgency: region.control.administrationAccessBp < 5000 ? 'high' : 'medium',
      summary: `Actual control differs from legal ownership; access and recruitment follow the occupation profile.`,
      evidenceIds: groundedEvidence(region.evidenceIds, visible, snapshotEvidence),
    })),
    diplomacy: {
      conversations: pendingProposals.map((proposal) => {
        const counterparties = proposal.proposerPolityId === polity.id
          ? proposal.recipientPolityIds
          : [proposal.proposerPolityId];
        const terms = proposal.terms.map((term) => term.kind === 'territorial-cession'
          ? `${labelOf(term.regionId)} → ${labelOf(term.toPolityId)}`
          : `${labelOf(term.relationshipTypeId)}: ${term.participantPolityIds.map(labelOf).join(', ')}`);
        return {
          conversationId: `conversation:${proposal.proposalId.slice('proposal:'.length)}`,
          counterparty: counterparties.map((id) => localized(state.polities.find((entry) => entry.id === id)?.displayName, locale) || labelOf(id)).join(' · '),
          latestMessage: terms.join('; '), status: proposal.proposerPolityId === polity.id ? 'awaiting-response' : 'response-required',
          evidenceIds: groundedEvidence(proposal.evidenceIds, visible, snapshotEvidence),
        };
      }),
      commitments: [
        ...relationships.map((relationship) => ({
        commitmentId: `commitment:${relationship.relationshipId.replaceAll(':', '-')}`,
        title: labelOf(relationship.kind),
        summary: relationship.participantPolityIds
          .map((id) => localized(state.polities.find((entry) => entry.id === id)?.displayName, locale) || labelOf(id))
          .join(' · '),
        evidenceIds: groundedEvidence(relationship.evidenceIds, visible, snapshotEvidence),
        })),
        ...tributeObligations.map((obligation) => ({
          commitmentId: `commitment:${obligation.obligationId.replaceAll(':', '-')}`,
          title: 'tribute obligation',
          summary: `${obligation.payerPolityIds.map(labelOf).join(', ')} → ${obligation.beneficiaries.map((entry) => `${labelOf(entry.polityId)} ${entry.shareBp / 100}%`).join(', ')} · ${obligation.cadence}`,
          evidenceIds: groundedEvidence(obligation.evidenceIds, visible),
        })),
      ],
    },
    details: [
      { detailId: 'detail:territory', label: 'Territory', summary: `${controlledRegions.length} actually controlled regions; ${occupations.length} held under non-sovereign control.` },
      { detailId: 'detail:economy', label: 'Economy', summary: `Tax base ${formatNumber(snapshot.taxBase)}; regional output ${formatNumber(snapshot.regionalOutput)}; treasury ${formatNumber(snapshot.treasury)}.` },
      { detailId: 'detail:forces', label: 'Forces', summary: `${formatNumber(snapshot.fieldedPersonnel)} fielded personnel; ${formatNumber(snapshot.availableManpower)} additional recruitable people under current access.` },
      { detailId: 'detail:provenance', label: 'Evidence', summary: `${visible.size} public or polity-visible evidence records ground this view at one exact revision.` },
    ],
    time: {
      label: state.month,
      options: [{ optionId: 'advance-three-months', label: 'Advance three months' }],
      completedSubmonths: last?.kind === 'world-month-advanced' ? last.submonths?.length ?? 1 : 0,
      totalSubmonths: last?.kind === 'world-month-advanced' ? last.submonths?.length ?? 1 : 3,
    },
  };
}

/** Bounded, actor-visible facts for the semantic interpreter; never a writable state copy. */
export function buildPlayerIntentContext({ session, playerPolityId, locale = 'en' }) {
  const state = session.state;
  const actor = state.polities.find((entry) => entry.id === playerPolityId);
  if (!actor) throw new Error(`Unknown player polity ${playerPolityId}`);
  const registry = worldV2.selectEvidenceRegistry(state, actor.id).value.entries;
  const visibleIds = new Set(registry.map((entry) => entry.evidenceId));
  const regionRows = boundedContextEntries(state.regions.map((region) => ({
    entityId: region.regionId,
    kind: 'region',
    label: contextLabel(region.displayName, locale),
    legalOwnerPolityId: region.control.legalOwnerPolityId,
    actualControllerPolityId: region.control.actualControllerPolityId,
    evidenceIds: region.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
  })), PLAYER_INTENT_CONTEXT_MAX.regions, (region) => (
    region.legalOwnerPolityId === actor.id || region.actualControllerPolityId === actor.id
  ));
  const entities = [
    ...boundedContextEntries(state.polities.map((polity) => ({
      entityId: polity.id,
      kind: 'polity',
      label: contextLabel(polity.displayName, locale),
      evidenceIds: polity.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.polities, (polity) => polity.entityId === actor.id),
    ...regionRows,
    ...boundedContextEntries(state.formations.filter((entry) => entry.polityId === actor.id).map((formation) => ({
      entityId: formation.formationId,
      kind: 'formation',
      label: contextLabel(labelOf(formation.formationId), locale),
      polityId: formation.polityId,
      evidenceIds: formation.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.formations),
    ...boundedContextEntries(state.concepts.map((concept) => ({
      entityId: concept.conceptId,
      kind: 'concept',
      label: contextLabel(concept.displayName, locale),
      status: concept.status,
      evidenceIds: concept.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.concepts),
    ...boundedContextEntries(state.processes.filter((entry) => entry.sponsorEntityRefs.includes(actor.id)).map((process) => ({
      entityId: process.processId,
      kind: 'process',
      label: contextLabel(labelOf(process.kind), locale),
      status: process.status,
      evidenceIds: process.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.processes),
    ...boundedContextEntries(state.relationships.filter((entry) => entry.participantPolityIds.includes(actor.id)).map((relationship) => ({
      entityId: relationship.relationshipId,
      kind: 'relationship',
      label: contextLabel(labelOf(relationship.kind), locale),
      participantPolityIds: relationship.participantPolityIds,
      evidenceIds: relationship.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.relationships),
    ...boundedContextEntries(state.tributeObligations.filter((entry) => (
      entry.payerPolityIds.includes(actor.id) || entry.beneficiaries.some((beneficiary) => beneficiary.polityId === actor.id)
    )).map((obligation) => ({
      entityId: obligation.obligationId,
      kind: 'tribute-obligation',
      label: contextLabel(labelOf(obligation.obligationId), locale),
      payerPolityIds: obligation.payerPolityIds,
      beneficiaries: obligation.beneficiaries,
      deliveries: obligation.deliveries,
      laborService: obligation.laborService,
      militaryService: obligation.militaryService,
      cadence: obligation.cadence,
      arrears: obligation.arrears,
      complianceBp: obligation.complianceBp,
      evidenceIds: obligation.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })), PLAYER_INTENT_CONTEXT_MAX.tributeObligations),
  ];
  const referencedEvidence = new Set(entities.flatMap((entry) => entry.evidenceIds));
  const evidence = registry
    .filter((entry) => referencedEvidence.has(entry.evidenceId))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
    .slice(0, PLAYER_INTENT_CONTEXT_MAX.evidence)
    .map((entry) => ({
      evidenceId: entry.evidenceId,
      kind: entry.kind,
    }));
  const context = {
    revision: state.revision,
    month: state.month,
    actor: { entityId: actor.id, label: contextLabel(actor.displayName, locale) },
    worldRules: state.worldRules,
    entities,
    // A deliberately tiny reference index for retrospective territorial
    // claims. Unlike operational entity context it carries no metrics,
    // ownership or evidence, so it does not turn a remote region into a legal
    // action target. It lets the interpreter name any scenario region by its
    // canonical ID and lets the reducer answer the claim from WorldState.
    claimableRegionRefs: state.regions.map((region) => ({
      entityId: region.regionId,
      label: contextLabel(region.displayName, locale),
    })).sort((left, right) => left.entityId.localeCompare(right.entityId)),
    evidence,
    allowedInitiativeKinds: ['technology', 'ideology', 'institution', 'doctrine', 'movement', 'project', 'investigation', 'other'],
    allowedEffectFamilies: [...processes.materializableEffectKinds],
    allowedDiplomaticOperations: ['process.propose', 'military.mobilize', 'diplomacy.propose', 'territory.offer'],
    relationshipTypes: state.catalogs.relationshipTypes.map((entry) => entry.relationshipTypeId).sort(),
  };
  return context;
}
