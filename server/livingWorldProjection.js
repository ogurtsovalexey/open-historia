import { processes, worldV2 } from '@open-historia/engine';

export const INTENT_FIRST_UI_SCHEMA_VERSION = 'open-historia-ui/intent-first/1';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const formatNumber = (value) => number.format(value);
const applyBp = (value, bp) => Number(BigInt(value) * BigInt(bp) / 10000n);
const labelOf = (value) => String(value ?? '').split(':').at(-1).replaceAll('-', ' ');
const localized = (value, locale) => value?.[locale] ?? value?.en ?? '';

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

function interpretationProjection(intent, fallbackEvidence) {
  if (!intent || intent.status !== 'pending') return null;
  return {
    interpretationId: intent.interpretationId,
    sourceText: intent.sourceText,
    confirmationRequired: true,
    questions: intent.questions ?? [],
    claims: intent.claims ?? [],
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
    time: { label: state.month, options: [{ optionId: 'advance-three-months', label: 'Advance three months' }] },
  };
}

/** Bounded, actor-visible facts for the semantic interpreter; never a writable state copy. */
export function buildPlayerIntentContext({ session, playerPolityId, locale = 'en' }) {
  const state = session.state;
  const actor = state.polities.find((entry) => entry.id === playerPolityId);
  if (!actor) throw new Error(`Unknown player polity ${playerPolityId}`);
  const registry = worldV2.selectEvidenceRegistry(state, actor.id).value.entries;
  const visibleIds = new Set(registry.map((entry) => entry.evidenceId));
  const regionRows = state.regions.map((region) => ({
    entityId: region.regionId,
    kind: 'region',
    label: localized(region.displayName, locale),
    legalOwnerPolityId: region.control.legalOwnerPolityId,
    actualControllerPolityId: region.control.actualControllerPolityId,
    evidenceIds: region.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
  }));
  const entities = [
    ...state.polities.map((polity) => ({
      entityId: polity.id,
      kind: 'polity',
      label: localized(polity.displayName, locale),
      evidenceIds: polity.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })),
    ...regionRows,
    ...state.formations.filter((entry) => entry.polityId === actor.id).map((formation) => ({
      entityId: formation.formationId,
      kind: 'formation',
      label: labelOf(formation.formationId),
      polityId: formation.polityId,
      evidenceIds: formation.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })),
    ...state.concepts.map((concept) => ({
      entityId: concept.conceptId,
      kind: 'concept',
      label: localized(concept.displayName, locale),
      status: concept.status,
      evidenceIds: concept.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })),
    ...state.processes.filter((entry) => entry.sponsorEntityRefs.includes(actor.id)).map((process) => ({
      entityId: process.processId,
      kind: 'process',
      label: labelOf(process.kind),
      status: process.status,
      evidenceIds: process.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })),
    ...state.relationships.filter((entry) => entry.participantPolityIds.includes(actor.id)).map((relationship) => ({
      entityId: relationship.relationshipId,
      kind: 'relationship',
      label: labelOf(relationship.kind),
      participantPolityIds: relationship.participantPolityIds,
      evidenceIds: relationship.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })),
    ...state.tributeObligations.filter((entry) => (
      entry.payerPolityIds.includes(actor.id) || entry.beneficiaries.some((beneficiary) => beneficiary.polityId === actor.id)
    )).map((obligation) => ({
      entityId: obligation.obligationId,
      kind: 'tribute-obligation',
      label: labelOf(obligation.obligationId),
      payerPolityIds: obligation.payerPolityIds,
      beneficiaries: obligation.beneficiaries,
      deliveries: obligation.deliveries,
      laborService: obligation.laborService,
      militaryService: obligation.militaryService,
      cadence: obligation.cadence,
      arrears: obligation.arrears,
      complianceBp: obligation.complianceBp,
      evidenceIds: obligation.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 2),
    })),
  ];
  const referencedEvidence = new Set(entities.flatMap((entry) => entry.evidenceIds));
  const evidence = registry
    .filter((entry) => referencedEvidence.has(entry.evidenceId))
    .slice(0, 240)
    .map((entry) => ({
      evidenceId: entry.evidenceId,
      kind: entry.kind,
    }));
  const context = {
    revision: state.revision,
    month: state.month,
    actor: { entityId: actor.id, label: localized(actor.displayName, locale) },
    worldRules: state.worldRules,
    entities,
    evidence,
    allowedInitiativeKinds: ['technology', 'ideology', 'institution', 'doctrine', 'movement', 'project', 'investigation', 'other'],
    allowedEffectFamilies: [...processes.materializableEffectKinds],
    allowedDiplomaticOperations: ['process.propose', 'diplomacy.propose', 'territory.offer'],
    relationshipTypes: state.catalogs.relationshipTypes.map((entry) => entry.relationshipTypeId).sort(),
  };
  if (JSON.stringify(context).length > 50_000) throw new Error('Player intent context exceeds the bounded semantic prompt budget.');
  return context;
}
