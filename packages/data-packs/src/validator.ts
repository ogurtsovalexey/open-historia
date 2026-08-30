

export interface ValidationError {
  code: string;
  path: string;
  message: string;
  refs?: string[];
}

export class ScenarioV2Validator {
  validateBundle(bundle: any): { valid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    // Basic structure validation
    if (!bundle.manifest || !bundle.scenario || !bundle.sources) {
      errors.push({
        code: 'schema.missing-component',
        path: '',
        message: 'Bundle must have manifest, scenario, and sources'
      });
      return { valid: false, errors };
    }

    const { manifest, scenario, sources } = bundle;

    // Check manifest ID matches scenario ID
    if (manifest.id !== scenario.id) {
      errors.push({
        code: 'reference.id-mismatch',
        path: '/manifest/id',
        message: `Manifest ID ${manifest.id} does not match scenario ID ${scenario.id}`,
        refs: [manifest.id, scenario.id]
      });
    }

    // Build ID registries
    const polityIds = new Set<string>(Object.keys(scenario.polities || {}));
    const regionIds = new Set<string>((scenario.regions || []).map((r: any) => String(r.id)));
    const sourceIds = new Set<string>((sources || []).map((s: any) => String(s.id)));
    const assumptionIds = new Set<string>((scenario.assumptions || []).map((a: any) => String(a.id)));
    const macroRegionIds = new Set<string>((scenario.macroRegions || []).map((m: any) => String(m.id)));

    // Check scenario-qualified IDs
    const scenarioSlug = manifest.id?.replace('scenario:', '') || '';

    // Check fact IDs belong to this scenario
    (scenario.historicalFacts || []).forEach((fact: any, index: number) => {
      if (fact.id && !fact.id.startsWith(`fact:${scenarioSlug}:`)) {
        errors.push({
          code: 'reference.wrong-scenario',
          path: `/scenario/historicalFacts/${index}/id`,
          message: `Fact ID ${fact.id} does not belong to scenario ${manifest.id}`,
          refs: [fact.id, manifest.id]
        });
      }
    });

    // Check source IDs belong to this scenario
    (sources || []).forEach((source: any, index: number) => {
      if (source.id && !source.id.startsWith(`source:${scenarioSlug}:`)) {
        errors.push({
          code: 'reference.wrong-scenario',
          path: `/sources/${index}/id`,
          message: `Source ID ${source.id} does not belong to scenario ${manifest.id}`,
          refs: [source.id, manifest.id]
        });
      }
    });

    // Check assumption IDs belong to this scenario
    (scenario.assumptions || []).forEach((assumption: any, index: number) => {
      if (assumption.id && !assumption.id.startsWith(`assumption:${scenarioSlug}:`)) {
        errors.push({
          code: 'reference.wrong-scenario',
          path: `/scenario/assumptions/${index}/id`,
          message: `Assumption ID ${assumption.id} does not belong to scenario ${manifest.id}`,
          refs: [assumption.id, manifest.id]
        });
      }
    });

    // Check entity references in facts
    (scenario.historicalFacts || []).forEach((fact: any, factIndex: number) => {
      (fact.subjectRefs || []).forEach((subjectRef: string, subjectIndex: number) => {
        if (!this.isValidEntityReference(subjectRef, polityIds, regionIds, macroRegionIds)) {
          errors.push({
            code: 'reference.unknown-entity',
            path: `/scenario/historicalFacts/${factIndex}/subjectRefs/${subjectIndex}`,
            message: `Unknown entity reference: ${subjectRef}`,
            refs: [subjectRef]
          });
        }
      });

      // Check source references
      (fact.sourceRefs || []).forEach((sourceRef: string, sourceIndex: number) => {
        if (!sourceIds.has(sourceRef)) {
          errors.push({
            code: 'reference.unknown-source',
            path: `/scenario/historicalFacts/${factIndex}/sourceRefs/${sourceIndex}`,
            message: `Unknown source reference: ${sourceRef}`,
            refs: [sourceRef]
          });
        }
      });

      // Check assumption references
      (fact.assumptionRefs || []).forEach((assumptionRef: string, assumptionIndex: number) => {
        if (!assumptionIds.has(assumptionRef)) {
          errors.push({
            code: 'reference.unknown-assumption',
            path: `/scenario/historicalFacts/${factIndex}/assumptionRefs/${assumptionIndex}`,
            message: `Unknown assumption reference: ${assumptionRef}`,
            refs: [assumptionRef]
          });
        }
      });

      // Check facts with confidence "assumption" have assumption references
      if (fact.confidence === 'assumption' && (fact.assumptionRefs || []).length === 0) {
        errors.push({
          code: 'integrity.assumption-without-reference',
          path: `/scenario/historicalFacts/${factIndex}`,
          message: `Fact ${fact.id} has confidence "assumption" but no assumption references`,
          refs: [fact.id]
        });
      }
    });

    // Check region assignments
    if (scenario.regionAssignments) {
      Object.entries(scenario.regionAssignments).forEach(([regionId, polityId]) => {
        if (!regionIds.has(regionId)) {
          errors.push({
            code: 'reference.unknown-region',
            path: `/scenario/regionAssignments/${regionId}`,
            message: `Unknown region in assignment: ${regionId}`,
            refs: [regionId]
          });
        }
        if (!polityIds.has(polityId as string)) {
          errors.push({
            code: 'reference.unknown-polity',
            path: `/scenario/regionAssignments/${regionId}`,
            message: `Unknown polity in assignment: ${polityId}`,
            refs: [polityId as string]
          });
        }
      });
    }

    // Check macro region members
    (scenario.macroRegions || []).forEach((macro: any, macroIndex: number) => {
      (macro.members || []).forEach((regionId: string, memberIndex: number) => {
        if (!regionIds.has(regionId)) {
          errors.push({
            code: 'reference.unknown-region',
            path: `/scenario/macroRegions/${macroIndex}/members/${memberIndex}`,
            message: `Unknown region in macro region: ${regionId}`,
            refs: [regionId]
          });
        }
      });
    });

    // Check default player polity exists
    if (scenario.game?.defaultPlayer && !polityIds.has(scenario.game.defaultPlayer)) {
      errors.push({
        code: 'reference.unknown-polity',
        path: '/scenario/game/defaultPlayer',
        message: `Unknown default player polity: ${scenario.game.defaultPlayer}`,
        refs: [scenario.game.defaultPlayer]
      });
    }

    return { valid: errors.length === 0, errors };
  }

  private isValidEntityReference(
    ref: string,
    polityIds: Set<string>,
    regionIds: Set<string>,
    macroRegionIds: Set<string>
  ): boolean {
    if (ref.startsWith('polity:')) return polityIds.has(ref);
    if (ref.startsWith('region:')) return regionIds.has(ref);
    if (ref.startsWith('macro-region:')) return macroRegionIds.has(ref);
    return false;
  }
}