import { processes, worldV2 } from '@open-historia/engine';

export const INTENT_FIRST_UI_SCHEMA_VERSION = 'open-historia-ui/intent-first/1';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const formatNumber = (value) => number.format(value);
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
    label: 'Time advanced; no unauthored material values were changed',
    authority: 'canonical',
    evidenceIds: groundedEvidence([last.clock?.evidenceId], visible, snapshotEvidence),
    causes: [{ category: 'other', label: 'Confirmed time advance', contribution: 'One calendar month' }],
  }] : [];
  const active = state.processes
    .filter((entry) => entry.status === 'active' && entry.sponsorEntityRefs.includes(polity.id))
    .map((entry) => processProjection(state, entry, visible, locale))
    .filter(Boolean);
  const relationships = state.relationships.filter((entry) => entry.participantPolityIds.includes(polity.id));

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
      conversations: [],
      commitments: relationships.map((relationship) => ({
        commitmentId: `commitment:${relationship.relationshipId.replaceAll(':', '-')}`,
        title: labelOf(relationship.kind),
        summary: relationship.participantPolityIds
          .map((id) => localized(state.polities.find((entry) => entry.id === id)?.displayName, locale) || labelOf(id))
          .join(' · '),
        evidenceIds: groundedEvidence(relationship.evidenceIds, visible, snapshotEvidence),
      })),
    },
    details: [
      { detailId: 'detail:territory', label: 'Territory', summary: `${controlledRegions.length} actually controlled regions; ${occupations.length} held under non-sovereign control.` },
      { detailId: 'detail:economy', label: 'Economy', summary: `Tax base ${formatNumber(snapshot.taxBase)}; regional output ${formatNumber(snapshot.regionalOutput)}; treasury ${formatNumber(snapshot.treasury)}.` },
      { detailId: 'detail:forces', label: 'Forces', summary: `${formatNumber(snapshot.fieldedPersonnel)} fielded personnel; ${formatNumber(snapshot.availableManpower)} additional recruitable people under current access.` },
      { detailId: 'detail:provenance', label: 'Evidence', summary: `${visible.size} public or polity-visible evidence records ground this view at one exact revision.` },
    ],
    time: { label: state.month, options: [{ optionId: 'advance-one-month', label: 'Advance one month' }] },
  };
}
