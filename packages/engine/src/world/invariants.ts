import type { WorldStateV2 } from './schema.js';

export class WorldStateInvariantError extends Error {
  readonly violations: string[];

  constructor(violations: string[]) {
    super(`WorldStateV2 invariant violation:\n${violations.map((entry) => `- ${entry}`).join('\n')}`);
    this.name = 'WorldStateInvariantError';
    this.violations = violations;
  }
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) found.add(value);
    seen.add(value);
  }
  return [...found].sort();
}

function checkUnique(violations: string[], label: string, values: readonly string[]): void {
  for (const value of duplicates(values)) violations.push(`duplicate ${label} ID ${value}`);
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function addToBigIntMap(map: Map<string, bigint>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0n) + BigInt(value));
}

function checkSafeAggregate(violations: string[], label: string, value: bigint): void {
  if (value > MAX_SAFE_BIGINT) violations.push(`${label} ${value} exceeds safe integer range`);
}

function resolvesJsonPointer(root: unknown, pointer: string): boolean {
  if (pointer === '') return true;
  let current: unknown = root;
  for (const encodedToken of pointer.slice(1).split('/')) {
    const token = encodedToken.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) return false;
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return false;
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) return false;
    current = (current as Record<string, unknown>)[token];
    if (current === undefined) return false;
  }
  return true;
}

export function worldStateV2InvariantViolations(state: WorldStateV2): string[] {
  const violations: string[] = [];
  const polityIds = new Set(state.polities.map((entry) => entry.id as string));
  const regionIds = new Set(state.regions.map((entry) => entry.regionId as string));
  const conceptIds = new Set(state.concepts.map((entry) => entry.conceptId as string));
  const eventIds = new Set(state.events.map((entry) => entry.eventId as string));
  const evidenceIds = new Set(state.evidence.map((entry) => entry.evidenceId as string));
  const lineageRevisions = new Set<string>([state.revisionLineage.seedRevision, ...state.revisionLineage.ancestorRevisions]);
  const catalogModules = new Set(state.catalogs.modules.map((entry) => entry.moduleId as string));
  const catalogCommodities = new Map(state.catalogs.commodities.map((entry) => [entry.commodityId as string, entry.usage]));
  const controlProfiles = new Map(state.catalogs.controlProfiles.map((entry) => [entry.controlProfileId as string, entry]));
  const equipmentClasses = new Set(state.catalogs.equipmentClasses.map((entry) => entry.equipmentClassId as string));
  const formationArchetypes = new Map(state.catalogs.formationArchetypes.map((entry) => [
    entry.formationArchetypeId as string,
    new Set(entry.equipmentClassIds as string[]),
  ]));
  const routeClasses = new Set(state.catalogs.routeClasses.map((entry) => entry.routeClassId as string));
  const entityIds = new Set<string>([
    ...polityIds,
    ...regionIds,
    ...state.populationCohorts.map((entry) => entry.cohortId as string),
    ...state.formations.map((entry) => entry.formationId as string),
    ...state.routes.map((entry) => entry.routeId as string),
    ...state.characters.map((entry) => entry.characterId as string),
    ...state.groups.map((entry) => entry.groupId as string),
    ...state.institutions.map((entry) => entry.institutionId as string),
    ...conceptIds,
    ...state.processes.map((entry) => entry.processId as string),
    ...state.relationships.map((entry) => entry.relationshipId as string),
  ]);

  checkUnique(violations, 'polity', state.polities.map((entry) => entry.id));
  checkUnique(violations, 'region', state.regions.map((entry) => entry.regionId));
  checkUnique(violations, 'population cohort', state.populationCohorts.map((entry) => entry.cohortId));
  checkUnique(violations, 'formation', state.formations.map((entry) => entry.formationId));
  checkUnique(violations, 'route', state.routes.map((entry) => entry.routeId));
  checkUnique(violations, 'character', state.characters.map((entry) => entry.characterId));
  checkUnique(violations, 'group', state.groups.map((entry) => entry.groupId));
  checkUnique(violations, 'institution', state.institutions.map((entry) => entry.institutionId));
  checkUnique(violations, 'concept', state.concepts.map((entry) => entry.conceptId));
  checkUnique(violations, 'process', state.processes.map((entry) => entry.processId));
  checkUnique(violations, 'relationship', state.relationships.map((entry) => entry.relationshipId));
  checkUnique(violations, 'event', state.events.map((entry) => entry.eventId));
  checkUnique(violations, 'evidence', state.evidence.map((entry) => entry.evidenceId));
  checkUnique(violations, 'module', state.modules.enabled);
  checkUnique(violations, 'catalog module', state.catalogs.modules.map((entry) => entry.moduleId));
  checkUnique(violations, 'catalog world model', state.catalogs.worldModels.map((entry) => entry.modelId));
  checkUnique(violations, 'catalog commodity', state.catalogs.commodities.map((entry) => entry.commodityId));
  checkUnique(violations, 'catalog control profile', state.catalogs.controlProfiles.map((entry) => entry.controlProfileId));
  checkUnique(violations, 'catalog formation archetype', state.catalogs.formationArchetypes.map((entry) => entry.formationArchetypeId));
  checkUnique(violations, 'catalog equipment class', state.catalogs.equipmentClasses.map((entry) => entry.equipmentClassId));
  checkUnique(violations, 'catalog route class', state.catalogs.routeClasses.map((entry) => entry.routeClassId));
  checkUnique(violations, 'knowledge baseline concept', state.worldRules.knowledgeBaseline);
  checkUnique(violations, 'knowledge record', state.knowledge.records.map((entry) => `${entry.polityId}|${entry.conceptId}`));
  checkUnique(violations, 'ancestor revision', state.revisionLineage.ancestorRevisions);
  if (state.revisionLineage.ancestorRevisions.includes(state.revisionLineage.seedRevision)) {
    violations.push(`seed revision ${state.revisionLineage.seedRevision} must not be duplicated in ancestor revisions`);
  }
  if (lineageRevisions.has(state.revision)) {
    violations.push(`current revision ${state.revision} must not appear in its own causal lineage`);
  }

  for (const moduleId of state.modules.enabled) {
    if (!catalogModules.has(moduleId)) violations.push(`enabled manifest references unknown module ${moduleId}`);
  }
  for (const archetype of state.catalogs.formationArchetypes) {
    checkUnique(violations, `equipment class in archetype ${archetype.formationArchetypeId}`, archetype.equipmentClassIds);
    for (const equipmentClassId of archetype.equipmentClassIds) {
      if (!equipmentClasses.has(equipmentClassId)) {
        violations.push(`formation archetype ${archetype.formationArchetypeId} references unknown equipment class ${equipmentClassId}`);
      }
    }
  }
  const requiredModels = [
    ['physical', state.worldRules.physicalModel],
    ['communication', state.worldRules.communicationModel],
    ['government', state.worldRules.governmentModel],
    ['military', state.worldRules.militaryModel],
  ] as const;
  for (const [kind, modelId] of requiredModels) {
    if (!state.catalogs.worldModels.some((entry) => entry.kind === kind && entry.modelId === modelId)) {
      violations.push(`${kind} model ${modelId} is not declared with kind ${kind}`);
    }
  }

  const assertPolity = (value: string, at: string) => {
    if (!polityIds.has(value)) violations.push(`${at} references unknown polity ${value}`);
  };
  const assertRegion = (value: string, at: string) => {
    if (!regionIds.has(value)) violations.push(`${at} references unknown region ${value}`);
  };
  const assertEvidence = (value: string, at: string) => {
    if (!evidenceIds.has(value)) violations.push(`${at} references unknown evidence ${value}`);
  };

  for (const region of state.regions) {
    assertPolity(region.control.legalOwnerPolityId, `region ${region.regionId} legal owner`);
    assertPolity(region.control.actualControllerPolityId, `region ${region.regionId} actual controller`);
    checkUnique(violations, `resource deposit in ${region.regionId}`, region.resourceDeposits.map((entry) => entry.resourceId));
    const control = region.control;
    const profile = controlProfiles.get(control.controlProfileId);
    if (!profile) {
      violations.push(`region ${region.regionId} references unknown control profile ${control.controlProfileId}`);
    } else if (
      control.kind !== profile.kind
      || control.administrationAccessBp !== profile.administrationAccessBp
      || control.extractionAccessBp !== profile.extractionAccessBp
      || control.recruitmentAccessBp !== profile.recruitmentAccessBp
      || control.integrationBp !== profile.integrationBp
    ) {
      violations.push(`region ${region.regionId} control does not match control profile ${control.controlProfileId}`);
    }
    if (control.kind === 'sovereign' && control.legalOwnerPolityId !== control.actualControllerPolityId) {
      violations.push(`region ${region.regionId} sovereign control requires owner and controller to match`);
    }
    if (control.kind === 'occupation' && control.legalOwnerPolityId === control.actualControllerPolityId) {
      violations.push(`region ${region.regionId} occupation requires different owner and controller`);
    }
    for (const deposit of region.resourceDeposits) {
      const usage = catalogCommodities.get(deposit.resourceId);
      if (usage !== 'regional' && usage !== 'both') {
        violations.push(`region ${region.regionId} references unknown regional commodity ${deposit.resourceId}`);
      }
    }
  }
  for (const polity of state.polities) {
    checkUnique(violations, `stockpile commodity in ${polity.id}`, polity.stockpiles.map((entry) => entry.commodityId));
    for (const stock of polity.stockpiles) {
      const usage = catalogCommodities.get(stock.commodityId);
      if (usage !== 'stockpile' && usage !== 'both') {
        violations.push(`polity ${polity.id} references unknown stockpile commodity ${stock.commodityId}`);
      }
    }
  }
  for (const cohort of state.populationCohorts) assertRegion(cohort.regionId, `cohort ${cohort.cohortId}`);
  for (const formation of state.formations) {
    assertPolity(formation.polityId, `formation ${formation.formationId}`);
    const allowedEquipment = formationArchetypes.get(formation.archetypeId);
    if (!allowedEquipment) violations.push(`formation ${formation.formationId} references unknown archetype ${formation.archetypeId}`);
    checkUnique(violations, `personnel origin region in ${formation.formationId}`, formation.personnelOrigins.map((entry) => entry.regionId));
    checkUnique(violations, `equipment class in ${formation.formationId}`, formation.equipment.map((entry) => entry.equipmentClassId));
    let equipmentTotal = 0n;
    for (const equipment of formation.equipment) {
      equipmentTotal += BigInt(equipment.quantity);
      if (!equipmentClasses.has(equipment.equipmentClassId)) {
        violations.push(`formation ${formation.formationId} references unknown equipment class ${equipment.equipmentClassId}`);
      } else if (allowedEquipment && !allowedEquipment.has(equipment.equipmentClassId)) {
        violations.push(`formation ${formation.formationId} equipment class ${equipment.equipmentClassId} is not allowed by archetype ${formation.archetypeId}`);
      }
    }
    checkSafeAggregate(violations, `formation ${formation.formationId} equipment aggregate`, equipmentTotal);
    let originTotal = 0n;
    for (const origin of formation.personnelOrigins) {
      assertRegion(origin.regionId, `formation ${formation.formationId} personnel origin`);
      originTotal += BigInt(origin.personnel);
    }
    checkSafeAggregate(violations, `formation ${formation.formationId} personnel origin sum`, originTotal);
    if (originTotal !== BigInt(formation.manpower)) {
      violations.push(`formation ${formation.formationId} personnel origins sum ${originTotal} does not equal manpower ${formation.manpower}`);
    }
  }
  for (const route of state.routes) {
    if (!routeClasses.has(route.classId)) violations.push(`route ${route.routeId} references unknown route class ${route.classId}`);
    checkUnique(violations, `region in route ${route.routeId}`, route.regionIds);
    checkUnique(violations, `commodity in route ${route.routeId}`, route.allowedCommodityIds);
    for (const regionId of route.regionIds) assertRegion(regionId, `route ${route.routeId}`);
    for (const commodityId of route.allowedCommodityIds) {
      if (!catalogCommodities.has(commodityId)) violations.push(`route ${route.routeId} references unknown commodity ${commodityId}`);
    }
  }
  for (const character of state.characters) if (character.polityId) assertPolity(character.polityId, `character ${character.characterId}`);
  for (const group of state.groups) {
    if (group.polityId) assertPolity(group.polityId, `group ${group.groupId}`);
    if (group.homeRegionId) assertRegion(group.homeRegionId, `group ${group.groupId}`);
  }
  for (const institution of state.institutions) {
    if (institution.polityId) assertPolity(institution.polityId, `institution ${institution.institutionId}`);
    if (institution.regionId) assertRegion(institution.regionId, `institution ${institution.institutionId}`);
  }
  for (const process of state.processes) {
    checkUnique(violations, `process sponsor in ${process.processId}`, process.sponsorPolityIds);
    checkUnique(violations, `affected entity in ${process.processId}`, process.affectedEntityRefs);
    for (const polityId of process.sponsorPolityIds) assertPolity(polityId, `process ${process.processId}`);
    for (const entityId of process.affectedEntityRefs) {
      if (!entityIds.has(entityId)) violations.push(`process ${process.processId} references unknown entity ${entityId}`);
    }
  }
  for (const relationship of state.relationships) {
    checkUnique(violations, `relationship participant in ${relationship.relationshipId}`, relationship.participantPolityIds);
    for (const polityId of relationship.participantPolityIds) assertPolity(polityId, `relationship ${relationship.relationshipId}`);
  }
  for (const record of state.knowledge.records) {
    assertPolity(record.polityId, 'knowledge record');
    if (!conceptIds.has(record.conceptId)) violations.push(`knowledge record references unknown concept ${record.conceptId}`);
  }
  for (const conceptId of state.worldRules.knowledgeBaseline) {
    if (!conceptIds.has(conceptId)) violations.push(`knowledge baseline references unknown concept ${conceptId}`);
  }

  const evidenceBearing: Array<{ label: string; evidenceIds: readonly string[] }> = [
    ...state.polities.map((entry) => ({ label: `polity ${entry.id}`, evidenceIds: entry.evidenceIds })),
    ...state.regions.map((entry) => ({ label: `region ${entry.regionId}`, evidenceIds: entry.evidenceIds })),
    ...state.populationCohorts.map((entry) => ({ label: `cohort ${entry.cohortId}`, evidenceIds: entry.evidenceIds })),
    ...state.formations.map((entry) => ({ label: `formation ${entry.formationId}`, evidenceIds: entry.evidenceIds })),
    ...state.routes.map((entry) => ({ label: `route ${entry.routeId}`, evidenceIds: entry.evidenceIds })),
    ...state.characters.map((entry) => ({ label: `character ${entry.characterId}`, evidenceIds: entry.evidenceIds })),
    ...state.groups.map((entry) => ({ label: `group ${entry.groupId}`, evidenceIds: entry.evidenceIds })),
    ...state.institutions.map((entry) => ({ label: `institution ${entry.institutionId}`, evidenceIds: entry.evidenceIds })),
    ...state.concepts.map((entry) => ({ label: `concept ${entry.conceptId}`, evidenceIds: entry.evidenceIds })),
    ...state.processes.map((entry) => ({ label: `process ${entry.processId}`, evidenceIds: entry.evidenceIds })),
    ...state.relationships.map((entry) => ({ label: `relationship ${entry.relationshipId}`, evidenceIds: entry.evidenceIds })),
    ...state.knowledge.records.map((entry) => ({ label: `knowledge ${entry.polityId}/${entry.conceptId}`, evidenceIds: entry.evidenceIds })),
    ...state.events.map((entry) => ({ label: `event ${entry.eventId}`, evidenceIds: entry.evidenceIds })),
  ];
  for (const entry of evidenceBearing) {
    checkUnique(violations, `evidence reference in ${entry.label}`, entry.evidenceIds);
    for (const evidenceId of entry.evidenceIds) assertEvidence(evidenceId, entry.label);
  }
  for (const evidence of state.evidence) {
    checkUnique(violations, `entity reference in ${evidence.evidenceId}`, evidence.entityRefs);
    checkUnique(violations, `event reference in ${evidence.evidenceId}`, evidence.eventRefs);
    checkUnique(violations, `canonical pointer in ${evidence.evidenceId}`, evidence.canonicalPointers);
    const visibleToPolityIds = 'visibleToPolityIds' in evidence ? evidence.visibleToPolityIds : [];
    checkUnique(violations, `visible polity in ${evidence.evidenceId}`, visibleToPolityIds);
    for (const eventId of evidence.eventRefs) {
      if (!eventIds.has(eventId)) violations.push(`evidence ${evidence.evidenceId} references unknown event ${eventId}`);
    }
    for (const entityId of evidence.entityRefs) {
      if (!entityIds.has(entityId)) violations.push(`evidence ${evidence.evidenceId} references unknown entity ${entityId}`);
    }
    for (const polityId of visibleToPolityIds) assertPolity(polityId, `evidence ${evidence.evidenceId} visibility`);
    if (evidence.visibility === 'public' && visibleToPolityIds.length !== 0) {
      violations.push(`public evidence ${evidence.evidenceId} must not declare polity visibility`);
    }
    if (evidence.visibility === 'polity' && visibleToPolityIds.length === 0) {
      violations.push(`polity evidence ${evidence.evidenceId} must declare at least one visible polity`);
    }
    if (!lineageRevisions.has(evidence.revision)) {
      violations.push(`evidence ${evidence.evidenceId} revision is not in world lineage: ${evidence.revision}`);
    }
  }
  for (const event of state.events) {
    checkUnique(violations, `entity reference in ${event.eventId}`, event.entityRefs);
    for (const entityId of event.entityRefs) {
      if (!entityIds.has(entityId)) violations.push(`event ${event.eventId} references unknown entity ${entityId}`);
    }
    if (!lineageRevisions.has(event.revision)) {
      violations.push(`event ${event.eventId} revision is not in world lineage: ${event.revision}`);
    }
  }

  const regionPopulation = new Map<string, bigint>();
  let worldPopulation = 0n;
  for (const cohort of state.populationCohorts) {
    worldPopulation += BigInt(cohort.population);
    addToBigIntMap(regionPopulation, cohort.regionId, cohort.population);
  }
  checkSafeAggregate(violations, 'world population aggregate', worldPopulation);
  for (const [regionId, population] of regionPopulation) checkSafeAggregate(violations, `region ${regionId} population aggregate`, population);

  const regionalOrigins = new Map<string, bigint>();
  const equipmentTotals = new Map<string, bigint>();
  let worldFielded = 0n;
  for (const formation of state.formations) {
    worldFielded += BigInt(formation.manpower);
    for (const origin of formation.personnelOrigins) addToBigIntMap(regionalOrigins, origin.regionId, origin.personnel);
    for (const equipment of formation.equipment) addToBigIntMap(equipmentTotals, equipment.equipmentClassId, equipment.quantity);
  }
  checkSafeAggregate(violations, 'world fielded personnel aggregate', worldFielded);
  for (const [regionId, personnel] of regionalOrigins) {
    checkSafeAggregate(violations, `region ${regionId} mobilized personnel aggregate`, personnel);
    if (personnel > (regionPopulation.get(regionId) ?? 0n)) {
      violations.push(`region ${regionId} personnel origins ${personnel} exceed population ${regionPopulation.get(regionId) ?? 0n}`);
    }
  }
  for (const [equipmentClassId, total] of equipmentTotals) {
    checkSafeAggregate(violations, `world equipment ${equipmentClassId} aggregate`, total);
  }

  const capacityFields = ['fiscalBase', 'productiveCapacity', 'supplyCapacity'] as const;
  for (const field of capacityFields) {
    let worldTotal = 0n;
    const byController = new Map<string, bigint>();
    for (const region of state.regions) {
      worldTotal += BigInt(region[field]);
      addToBigIntMap(byController, region.control.actualControllerPolityId, region[field]);
    }
    checkSafeAggregate(violations, `world ${field} aggregate`, worldTotal);
    for (const [polityId, total] of byController) checkSafeAggregate(violations, `polity ${polityId} ${field} aggregate`, total);
  }

  for (const polity of state.polities) {
    let stockTotal = 0n;
    for (const stock of polity.stockpiles) stockTotal += BigInt(stock.quantity);
    checkSafeAggregate(violations, `polity ${polity.id} commodity stock aggregate`, stockTotal);
  }
  const regionalResourceTotals = new Map<string, bigint>();
  for (const region of state.regions) {
    for (const resource of region.resourceDeposits) addToBigIntMap(regionalResourceTotals, resource.resourceId, resource.amount);
  }
  for (const [resourceId, total] of regionalResourceTotals) checkSafeAggregate(violations, `world resource ${resourceId} aggregate`, total);

  const { revision: _revision, ...canonicalContent } = state;
  void _revision;
  for (const evidence of state.evidence) {
    for (const pointer of evidence.canonicalPointers) {
      if (!resolvesJsonPointer(canonicalContent, pointer)) {
        violations.push(`evidence ${evidence.evidenceId} canonical pointer ${pointer} does not resolve`);
      }
    }
  }

  return [...new Set(violations)].sort();
}

export function assertWorldStateV2Invariants(state: WorldStateV2): void {
  const violations = worldStateV2InvariantViolations(state);
  if (violations.length > 0) throw new WorldStateInvariantError(violations);
}
