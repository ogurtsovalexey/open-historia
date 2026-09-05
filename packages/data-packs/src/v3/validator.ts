import { createHash } from 'node:crypto';
import { canonicalStringify } from '../builder.js';
import { scenarioV3Schema, type ScenarioV3 } from './schemas.js';
import { PROFILE_EVIDENCE_KIND } from './profiles.js';

export interface ScenarioV3Diagnostic {
  code: string;
  path: string;
  message: string;
  refs?: string[];
}

export interface ScenarioV3ValidationResult {
  valid: boolean;
  scenario?: ScenarioV3;
  errors: ScenarioV3Diagnostic[];
}

const pointerToken = (value: PropertyKey): string => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
const childPath = (base: string, value: PropertyKey): string => `${base}/${pointerToken(value)}`;
const refError = (code: string, path: string, message: string, refs: string[]): ScenarioV3Diagnostic => ({ code, path, message, refs });

function sorted(errors: ScenarioV3Diagnostic[]): ScenarioV3Diagnostic[] {
  return [...errors].sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

function duplicateErrors(values: readonly string[], path: string): ScenarioV3Diagnostic[] {
  const seen = new Set<string>();
  const errors: ScenarioV3Diagnostic[] = [];
  values.forEach((value, index) => {
    if (seen.has(value)) errors.push(refError('integrity.duplicate-ref', `${path}/${index}`, `duplicate reference "${value}"`, [value]));
    seen.add(value);
  });
  return errors;
}

function recordIdentityErrors(record: Record<string, { id: string }>, path: string): ScenarioV3Diagnostic[] {
  const errors: ScenarioV3Diagnostic[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key !== value.id) errors.push(refError('integrity.record-key-mismatch', `${childPath(path, key)}/id`, `record key "${key}" does not equal value id "${value.id}"`, [key, value.id]));
  }
  return errors;
}

function resolveJsonPointer(root: unknown, pointer: string): { resolved: true; value: unknown } | { resolved: false } {
  let current: unknown = root;
  for (const encoded of pointer.slice(1).split('/')) {
    const token = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) return { resolved: false };
      const index = Number(token);
      if (index >= current.length) return { resolved: false };
      current = current[index];
    } else if (current !== null && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, token)) {
      current = (current as Record<string, unknown>)[token];
    } else return { resolved: false };
    if (current === undefined) return { resolved: false };
  }
  return { resolved: true, value: current };
}

export function scenarioV3ValueChecksum(value: unknown): `sha256:${string}` {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) {
      return entry.map(normalize).sort((left, right) => {
        const leftText = canonicalStringify(left);
        const rightText = canonicalStringify(right);
        return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
      });
    }
    if (entry !== null && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry as Record<string, unknown>).map(([key, nested]) => [key, normalize(nested)]));
    }
    return entry;
  };
  return `sha256:${createHash('sha256').update(canonicalStringify(normalize(value)), 'utf8').digest('hex')}`;
}

export function scenarioV3ValueChecksumAtPointer(root: unknown, pointer: string): `sha256:${string}` {
  const resolved = resolveJsonPointer(root, pointer);
  if (!resolved.resolved) throw new Error(`ScenarioV3 provenance pointer does not resolve: ${pointer}`);
  return scenarioV3ValueChecksum(resolved.value);
}

export function validateScenarioV3(input: unknown): ScenarioV3ValidationResult {
  const parsed = scenarioV3Schema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: sorted(parsed.error.issues.map((issue) => ({
        code: `schema.${issue.code}`,
        path: issue.path.reduce<string>((path, token) => childPath(path, token), ''),
        message: issue.message,
      }))),
    };
  }

  const scenario = parsed.data;
  const errors: ScenarioV3Diagnostic[] = [];
  const { catalogs, startingState, geography, provenance } = scenario;
  const polityIds = new Set(Object.keys(startingState.polities));
  const regionIds = new Set(Object.keys(startingState.regions));
  const evidenceIds = new Set(Object.keys(provenance.evidence));
  const commodityIds = new Set(Object.keys(catalogs.commodities));
  const moduleIds = new Set(Object.keys(catalogs.modules));
  const conceptIds = new Set(Object.keys(startingState.concepts));
  const controlProfileIds = new Set(Object.keys(catalogs.controlProfiles));
  const equipmentClassIds = new Set(Object.keys(catalogs.equipmentClasses));
  const startingEntityIds = new Set<string>([
    ...polityIds,
    ...regionIds,
    ...Object.keys(startingState.populationCohorts),
    ...Object.keys(startingState.formations),
    ...Object.keys(startingState.institutions),
    ...Object.keys(startingState.relationships),
    ...Object.keys(startingState.tributeObligations),
    ...conceptIds,
  ]);

  const records: Array<[Record<string, { id: string }>, string]> = [
    [catalogs.modules, '/catalogs/modules'],
    [catalogs.worldModels, '/catalogs/worldModels'],
    [catalogs.commodities, '/catalogs/commodities'],
    [catalogs.activities, '/catalogs/activities'],
    [catalogs.recipes, '/catalogs/recipes'],
    [catalogs.institutionTypes, '/catalogs/institutionTypes'],
    [catalogs.officeTypes, '/catalogs/officeTypes'],
    [catalogs.formationArchetypes, '/catalogs/formationArchetypes'],
    [catalogs.equipmentClasses, '/catalogs/equipmentClasses'],
    [catalogs.financeProfiles, '/catalogs/financeProfiles'],
    [catalogs.revenueChannels, '/catalogs/revenueChannels'],
    [catalogs.financeInstruments, '/catalogs/financeInstruments'],
    [catalogs.controlProfiles, '/catalogs/controlProfiles'],
    [catalogs.relationshipTypes, '/catalogs/relationshipTypes'],
    [catalogs.routeClasses, '/catalogs/routeClasses'],
    [geography.assets, '/geography/assets'],
    [geography.regions, '/geography/regions'],
    [startingState.polities, '/startingState/polities'],
    [startingState.regions, '/startingState/regions'],
    [startingState.populationCohorts, '/startingState/populationCohorts'],
    [startingState.formations, '/startingState/formations'],
    [startingState.institutions, '/startingState/institutions'],
    [startingState.relationships, '/startingState/relationships'],
    [startingState.tributeObligations, '/startingState/tributeObligations'],
    [startingState.routes, '/startingState/routes'],
    [startingState.concepts, '/startingState/concepts'],
    [startingState.knowledge, '/startingState/knowledge'],
    [provenance.sources, '/provenance/sources'],
    [provenance.evidence, '/provenance/evidence'],
  ];
  for (const [record, path] of records) errors.push(...recordIdentityErrors(record, path));

  const requireRef = (known: Set<string>, value: string, path: string, kind: string) => {
    if (!known.has(value)) errors.push(refError(`reference.unknown-${kind}`, path, `unknown ${kind} "${value}"`, [value]));
  };
  const requireEvidence = (values: readonly string[], path: string) => {
    errors.push(...duplicateErrors(values, path));
    values.forEach((value, index) => requireRef(evidenceIds, value, `${path}/${index}`, 'evidence'));
  };

  requireRef(polityIds, scenario.game.defaultPlayerPolityId, '/game/defaultPlayerPolityId', 'polity');
  errors.push(...duplicateErrors(scenario.game.playerEligiblePolityIds, '/game/playerEligiblePolityIds'));
  scenario.game.playerEligiblePolityIds.forEach((id, index) => requireRef(polityIds, id, `/game/playerEligiblePolityIds/${index}`, 'polity'));
  if (!scenario.game.playerEligiblePolityIds.includes(scenario.game.defaultPlayerPolityId)) {
    errors.push(refError('integrity.default-player-not-eligible', '/game/defaultPlayerPolityId', 'default player must be player-eligible', [scenario.game.defaultPlayerPolityId]));
  }

  const modelRefs = [
    ['physical', scenario.worldRules.physicalModel, '/worldRules/physicalModel'],
    ['communication', scenario.worldRules.communicationModel, '/worldRules/communicationModel'],
    ['government', scenario.worldRules.governmentModel, '/worldRules/governmentModel'],
    ['military', scenario.worldRules.militaryModel, '/worldRules/militaryModel'],
  ] as const;
  for (const [kind, id, path] of modelRefs) {
    const definition = catalogs.worldModels[id];
    if (!definition || definition.kind !== kind) errors.push(refError('reference.unknown-or-incompatible-world-model', path, `world model "${id}" is not declared as ${kind}`, [id, kind]));
  }
  errors.push(...duplicateErrors(scenario.modules.enabled, '/modules/enabled'));
  scenario.modules.enabled.forEach((id, index) => requireRef(moduleIds, id, `/modules/enabled/${index}`, 'module'));
  errors.push(...duplicateErrors(scenario.worldRules.knowledgeBaseline, '/worldRules/knowledgeBaseline'));
  scenario.worldRules.knowledgeBaseline.forEach((id, index) => requireRef(conceptIds, id, `/worldRules/knowledgeBaseline/${index}`, 'concept'));

  for (const [id, activity] of Object.entries(catalogs.activities)) {
    errors.push(...duplicateErrors(activity.inputCommodityIds, `${childPath('/catalogs/activities', id)}/inputCommodityIds`));
    errors.push(...duplicateErrors(activity.outputCommodityIds, `${childPath('/catalogs/activities', id)}/outputCommodityIds`));
    activity.inputCommodityIds.forEach((commodityId, index) => requireRef(commodityIds, commodityId, `${childPath('/catalogs/activities', id)}/inputCommodityIds/${index}`, 'commodity'));
    activity.outputCommodityIds.forEach((commodityId, index) => requireRef(commodityIds, commodityId, `${childPath('/catalogs/activities', id)}/outputCommodityIds/${index}`, 'commodity'));
  }
  for (const [id, recipe] of Object.entries(catalogs.recipes)) {
    for (const commodityId of Object.keys(recipe.inputs)) requireRef(commodityIds, commodityId, childPath(`${childPath('/catalogs/recipes', id)}/inputs`, commodityId), 'commodity');
    for (const commodityId of Object.keys(recipe.outputs)) requireRef(commodityIds, commodityId, childPath(`${childPath('/catalogs/recipes', id)}/outputs`, commodityId), 'commodity');
  }
  for (const [id, archetype] of Object.entries(catalogs.formationArchetypes)) {
    errors.push(...duplicateErrors(archetype.equipmentClassIds, `${childPath('/catalogs/formationArchetypes', id)}/equipmentClassIds`));
    archetype.equipmentClassIds.forEach((equipmentId, index) => requireRef(equipmentClassIds, equipmentId, `${childPath('/catalogs/formationArchetypes', id)}/equipmentClassIds/${index}`, 'equipment-class'));
  }
  for (const [id, profile] of Object.entries(catalogs.financeProfiles)) {
    errors.push(...duplicateErrors(profile.revenueChannelIds, `${childPath('/catalogs/financeProfiles', id)}/revenueChannelIds`));
    errors.push(...duplicateErrors(profile.instrumentIds, `${childPath('/catalogs/financeProfiles', id)}/instrumentIds`));
    profile.revenueChannelIds.forEach((ref, index) => requireRef(new Set(Object.keys(catalogs.revenueChannels)), ref, `${childPath('/catalogs/financeProfiles', id)}/revenueChannelIds/${index}`, 'revenue-channel'));
    profile.instrumentIds.forEach((ref, index) => requireRef(new Set(Object.keys(catalogs.financeInstruments)), ref, `${childPath('/catalogs/financeProfiles', id)}/instrumentIds/${index}`, 'finance-instrument'));
  }

  for (const [id, polity] of Object.entries(startingState.polities)) {
    for (const commodityId of Object.keys(polity.stockpiles)) {
      const path = childPath(`${childPath('/startingState/polities', id)}/stockpiles`, commodityId);
      requireRef(commodityIds, commodityId, path, 'commodity');
      const usage = catalogs.commodities[commodityId]?.usage;
      if (usage && usage !== 'stockpile' && usage !== 'both') errors.push(refError('reference.incompatible-commodity-usage', path, `commodity "${commodityId}" is not stockpile-compatible`, [commodityId, usage]));
    }
    requireEvidence(polity.evidenceIds, `${childPath('/startingState/polities', id)}/evidenceIds`);
  }
  for (const [id, region] of Object.entries(startingState.regions)) {
    const base = childPath('/startingState/regions', id);
    requireRef(polityIds, region.legalOwnerPolityId, `${base}/legalOwnerPolityId`, 'polity');
    requireRef(polityIds, region.actualControllerPolityId, `${base}/actualControllerPolityId`, 'polity');
    requireRef(controlProfileIds, region.controlProfileId, `${base}/controlProfileId`, 'control-profile');
    const profile = catalogs.controlProfiles[region.controlProfileId];
    if (profile?.kind === 'sovereign' && region.legalOwnerPolityId !== region.actualControllerPolityId) errors.push({ code: 'integrity.contradictory-control', path: base, message: 'sovereign control requires owner and controller to match' });
    if (profile?.kind === 'occupation' && region.legalOwnerPolityId === region.actualControllerPolityId) errors.push({ code: 'integrity.contradictory-control', path: base, message: 'occupation requires different owner and controller' });
    for (const commodityId of Object.keys(region.resources)) {
      const path = childPath(`${base}/resources`, commodityId);
      requireRef(commodityIds, commodityId, path, 'commodity');
      const usage = catalogs.commodities[commodityId]?.usage;
      if (usage && usage !== 'regional' && usage !== 'both') errors.push(refError('reference.incompatible-commodity-usage', path, `commodity "${commodityId}" is not regional-resource-compatible`, [commodityId, usage]));
    }
    requireEvidence(region.evidenceIds, `${base}/evidenceIds`);
  }
  for (const [id, cohort] of Object.entries(startingState.populationCohorts)) {
    const base = childPath('/startingState/populationCohorts', id);
    requireRef(regionIds, cohort.regionId, `${base}/regionId`, 'region');
    requireEvidence(cohort.evidenceIds, `${base}/evidenceIds`);
  }
  for (const [id, formation] of Object.entries(startingState.formations)) {
    const base = childPath('/startingState/formations', id);
    requireRef(polityIds, formation.polityId, `${base}/polityId`, 'polity');
    requireRef(new Set(Object.keys(catalogs.formationArchetypes)), formation.archetypeId, `${base}/archetypeId`, 'formation-archetype');
    const originValues = Object.values(formation.personnelOrigins);
    if (originValues.length === 0) errors.push({ code: 'integrity.missing-personnel-origin', path: `${base}/personnelOrigins`, message: 'formation requires at least one authored personnel origin' });
    const manpower = originValues.reduce((sum, value) => sum + BigInt(value), 0n);
    if (manpower > BigInt(Number.MAX_SAFE_INTEGER)) errors.push({ code: 'integrity.formation-manpower-overflow', path: `${base}/personnelOrigins`, message: 'derived formation manpower exceeds safe integer range' });
    for (const regionId of Object.keys(formation.personnelOrigins)) requireRef(regionIds, regionId, childPath(`${base}/personnelOrigins`, regionId), 'region');
    for (const equipmentId of Object.keys(formation.equipment)) requireRef(equipmentClassIds, equipmentId, childPath(`${base}/equipment`, equipmentId), 'equipment-class');
    requireEvidence(formation.evidenceIds, `${base}/evidenceIds`);
  }
  for (const [id, institution] of Object.entries(startingState.institutions)) {
    const base = childPath('/startingState/institutions', id);
    requireRef(new Set(Object.keys(catalogs.institutionTypes)), institution.typeId, `${base}/typeId`, 'institution-type');
    if (institution.polityId) requireRef(polityIds, institution.polityId, `${base}/polityId`, 'polity');
    if (institution.regionId) requireRef(regionIds, institution.regionId, `${base}/regionId`, 'region');
    requireEvidence(institution.evidenceIds, `${base}/evidenceIds`);
  }
  for (const [id, relationship] of Object.entries(startingState.relationships)) {
    const base = childPath('/startingState/relationships', id);
    requireRef(new Set(Object.keys(catalogs.relationshipTypes)), relationship.typeId, `${base}/typeId`, 'relationship-type');
    errors.push(...duplicateErrors(relationship.participantPolityIds, `${base}/participantPolityIds`));
    relationship.participantPolityIds.forEach((ref, index) => requireRef(polityIds, ref, `${base}/participantPolityIds/${index}`, 'polity'));
    requireEvidence(relationship.evidenceIds, `${base}/evidenceIds`);
  }
  for (const [id, obligation] of Object.entries(startingState.tributeObligations)) {
    const base = childPath('/startingState/tributeObligations', id);
    errors.push(...duplicateErrors(obligation.payerPolityIds, `${base}/payerPolityIds`));
    errors.push(...duplicateErrors(obligation.sourceRegionIds, `${base}/sourceRegionIds`));
    errors.push(...duplicateErrors(obligation.beneficiaries.map((entry) => entry.polityId), `${base}/beneficiaries`));
    errors.push(...duplicateErrors(obligation.deliveries.map((entry) => entry.commodityId), `${base}/deliveries`));
    errors.push(...duplicateErrors(obligation.routeIds, `${base}/routeIds`));
    errors.push(...duplicateErrors(obligation.arrears.map((entry) => entry.commodityId), `${base}/arrears`));
    obligation.payerPolityIds.forEach((ref, index) => requireRef(polityIds, ref, `${base}/payerPolityIds/${index}`, 'polity'));
    obligation.sourceRegionIds.forEach((ref, index) => {
      requireRef(regionIds, ref, `${base}/sourceRegionIds/${index}`, 'region');
      const controller = startingState.regions[ref]?.actualControllerPolityId;
      if (controller && !obligation.payerPolityIds.includes(controller)) {
        errors.push(refError('integrity.tribute-source-outside-payer-control', `${base}/sourceRegionIds/${index}`, `tribute source "${ref}" is outside the payers' actual control`, [ref, controller]));
      }
    });
    obligation.beneficiaries.forEach((beneficiary, index) => requireRef(polityIds, beneficiary.polityId, `${base}/beneficiaries/${index}/polityId`, 'polity'));
    const totalShares = obligation.beneficiaries.reduce((sum, entry) => sum + entry.shareBp, 0);
    if (totalShares !== 10000) errors.push({ code: 'integrity.tribute-beneficiary-shares', path: `${base}/beneficiaries`, message: `tribute beneficiary shares sum ${totalShares}, expected 10000` });
    for (const [index, delivery] of obligation.deliveries.entries()) {
      requireRef(commodityIds, delivery.commodityId, `${base}/deliveries/${index}/commodityId`, 'commodity');
      if (obligation.routeIds.length > 0 && !obligation.routeIds.some((routeId) => startingState.routes[routeId]?.allowedCommodityIds.includes(delivery.commodityId))) {
        errors.push(refError('integrity.tribute-route-incompatible', `${base}/deliveries/${index}/commodityId`, `no declared tribute route accepts "${delivery.commodityId}"`, [delivery.commodityId]));
      }
    }
    obligation.arrears.forEach((entry, index) => requireRef(commodityIds, entry.commodityId, `${base}/arrears/${index}/commodityId`, 'commodity'));
    obligation.routeIds.forEach((ref, index) => requireRef(new Set(Object.keys(startingState.routes)), ref, `${base}/routeIds/${index}`, 'route'));
    requireRef(startingEntityIds, obligation.enforcementBasisId, `${base}/enforcementBasisId`, 'entity');
    requireEvidence(obligation.evidenceIds, `${base}/evidenceIds`);
  }
  for (const [id, route] of Object.entries(startingState.routes)) {
    const base = childPath('/startingState/routes', id);
    requireRef(new Set(Object.keys(catalogs.routeClasses)), route.classId, `${base}/classId`, 'route-class');
    errors.push(...duplicateErrors(route.regionIds, `${base}/regionIds`));
    errors.push(...duplicateErrors(route.allowedCommodityIds, `${base}/allowedCommodityIds`));
    route.regionIds.forEach((ref, index) => requireRef(regionIds, ref, `${base}/regionIds/${index}`, 'region'));
    route.allowedCommodityIds.forEach((ref, index) => requireRef(commodityIds, ref, `${base}/allowedCommodityIds/${index}`, 'commodity'));
    requireEvidence(route.evidenceIds, `${base}/evidenceIds`);
  }
  const conceptSemanticKeys = new Map<string, string>();
  for (const [id, concept] of Object.entries(startingState.concepts)) {
    const base = childPath('/startingState/concepts', id);
    requireEvidence(concept.evidenceIds, `${base}/evidenceIds`);
    requireEvidence(concept.supportingEvidenceIds, `${base}/supportingEvidenceIds`);
    requireRef(evidenceIds, concept.sourceEvidenceId, `${base}/sourceEvidenceId`, 'evidence');
    if (!concept.evidenceIds.includes(concept.sourceEvidenceId)) {
      errors.push(refError(
        'integrity.concept-source-not-attached',
        `${base}/sourceEvidenceId`,
        'concept source evidence must also be attached to evidenceIds',
        [concept.sourceEvidenceId],
      ));
    }
    if (!concept.supportingEvidenceIds.includes(concept.sourceEvidenceId)) {
      errors.push(refError(
        'integrity.concept-source-not-supporting',
        `${base}/sourceEvidenceId`,
        'concept source evidence must also be supporting evidence',
        [concept.sourceEvidenceId],
      ));
    }
    errors.push(...duplicateErrors(concept.parentConceptIds, `${base}/parentConceptIds`));
    concept.parentConceptIds.forEach((ref, index) => requireRef(conceptIds, ref, `${base}/parentConceptIds/${index}`, 'concept'));
    errors.push(...duplicateErrors(concept.origin.originEntityRefs, `${base}/origin/originEntityRefs`));
    concept.origin.originEntityRefs.forEach((ref, index) => requireRef(startingEntityIds, ref, `${base}/origin/originEntityRefs/${index}`, 'entity'));
    if (concept.origin.discovererEntityRef) {
      requireRef(startingEntityIds, concept.origin.discovererEntityRef, `${base}/origin/discovererEntityRef`, 'entity');
    }
    for (const regionId of Object.keys(concept.diffusion)) {
      requireRef(regionIds, regionId, childPath(`${base}/diffusion`, regionId), 'region');
    }
    for (const polityId of Object.keys(concept.adoption.polities)) {
      requireRef(polityIds, polityId, childPath(`${base}/adoption/polities`, polityId), 'polity');
    }
    for (const regionId of Object.keys(concept.adoption.regions)) {
      requireRef(regionIds, regionId, childPath(`${base}/adoption/regions`, regionId), 'region');
    }
    errors.push(...duplicateErrors(concept.domains, `${base}/domains`));
    const earlier = conceptSemanticKeys.get(concept.semanticKey);
    if (earlier) {
      errors.push(refError(
        'integrity.duplicate-concept-semantic-key',
        `${base}/semanticKey`,
        `semantic key duplicates concept "${earlier}"`,
        [earlier, id],
      ));
    } else conceptSemanticKeys.set(concept.semanticKey, id);
  }
  const knowledgePairs = new Map<string, string>();
  for (const [id, knowledge] of Object.entries(startingState.knowledge)) {
    const base = childPath('/startingState/knowledge', id);
    requireRef(polityIds, knowledge.polityId, `${base}/polityId`, 'polity');
    requireRef(conceptIds, knowledge.conceptId, `${base}/conceptId`, 'concept');
    requireEvidence(knowledge.evidenceIds, `${base}/evidenceIds`);
    const pair = `${knowledge.polityId}|${knowledge.conceptId}`;
    const earlier = knowledgePairs.get(pair);
    if (earlier) errors.push(refError('integrity.duplicate-knowledge', base, `knowledge duplicates record "${earlier}"`, [earlier, id]));
    else knowledgePairs.set(pair, id);
  }

  for (const regionId of regionIds) {
    if (!Object.prototype.hasOwnProperty.call(geography.regions, regionId)) errors.push(refError('geography.missing-region', childPath('/geography/regions', regionId), `starting region "${regionId}" has no geography definition`, [regionId]));
  }
  for (const [id, region] of Object.entries(geography.regions)) {
    const base = childPath('/geography/regions', id);
    requireRef(regionIds, id, base, 'starting-region');
    if (region.link.kind === 'scenario-asset') requireRef(new Set(Object.keys(geography.assets)), region.link.assetId, `${base}/link/assetId`, 'asset');
    errors.push(...duplicateErrors(region.adjacentRegionIds, `${base}/adjacentRegionIds`));
    region.adjacentRegionIds.forEach((ref, index) => {
      requireRef(regionIds, ref, `${base}/adjacentRegionIds/${index}`, 'region');
      if (geography.regions[ref] && !geography.regions[ref].adjacentRegionIds.includes(id as typeof ref)) {
        errors.push(refError('geography.asymmetric-adjacency', `${base}/adjacentRegionIds/${index}`, `adjacency ${id} -> ${ref} is not symmetric`, [id, ref]));
      }
    });
  }

  for (const [id, evidence] of Object.entries(provenance.evidence)) {
    const base = childPath('/provenance/evidence', id);
    const expected = PROFILE_EVIDENCE_KIND[scenario.profile];
    if (evidence.basis.kind !== expected) errors.push(refError('provenance.profile-mismatch', `${base}/basis/kind`, `evidence basis ${evidence.basis.kind} does not match scenario profile ${scenario.profile}`, [id]));
    if (evidence.basis.kind === 'historical') {
      errors.push(...duplicateErrors(evidence.basis.sourceIds, `${base}/basis/sourceIds`));
      evidence.basis.sourceIds.forEach((sourceId, index) => requireRef(new Set(Object.keys(provenance.sources)), sourceId, `${base}/basis/sourceIds/${index}`, 'source'));
      if (evidence.basis.confidence === 'low' && !evidence.basis.todo) errors.push({ code: 'provenance.low-confidence-without-todo', path: `${base}/basis/todo`, message: 'low-confidence historical evidence requires a TODO' });
    }
    const visibleTo = evidence.visibleToPolityIds ?? [];
    errors.push(...duplicateErrors(visibleTo, `${base}/visibleToPolityIds`));
    visibleTo.forEach((polityId, index) => requireRef(polityIds, polityId, `${base}/visibleToPolityIds/${index}`, 'polity'));
    if (evidence.visibility === 'public' && visibleTo.length > 0) errors.push({ code: 'provenance.ambiguous-public-visibility', path: `${base}/visibleToPolityIds`, message: 'public evidence must not declare polity visibility' });
    if (evidence.visibility === 'polity' && visibleTo.length === 0) errors.push({ code: 'provenance.missing-polity-visibility', path: `${base}/visibleToPolityIds`, message: 'polity evidence must declare at least one visible polity' });
    const bound = resolveJsonPointer(scenario, evidence.binding.path);
    if (!bound.resolved) {
      errors.push(refError('provenance.unresolved-binding', `${base}/binding/path`, `binding path "${evidence.binding.path}" does not resolve`, [evidence.binding.path]));
    } else {
      const actualChecksum = scenarioV3ValueChecksum(bound.value);
      if (actualChecksum !== evidence.binding.valueChecksum) {
        errors.push(refError(
          'provenance.value-checksum-mismatch',
          `${base}/binding/valueChecksum`,
          `bound value checksum is ${actualChecksum}, not ${evidence.binding.valueChecksum}`,
          [evidence.binding.path, actualChecksum, evidence.binding.valueChecksum],
        ));
      }
    }
  }

  const resultErrors = sorted(errors);
  return resultErrors.length === 0 ? { valid: true, scenario, errors: [] } : { valid: false, scenario, errors: resultErrors };
}

export class ScenarioV3Validator {
  validate(input: unknown): ScenarioV3ValidationResult {
    return validateScenarioV3(input);
  }
}
