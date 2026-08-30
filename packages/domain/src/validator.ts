import { z } from 'zod';
import {
  scenarioManifestSchema,
  scenarioV2Schema,
  ScenarioManifest,
  ScenarioV2,
  sourceRefSchema,
  SourceRef,
  pregameNarrativeDraftSchema,
  PregameNarrativeDraft,
  draftScenarioPatchSchema,
  DraftScenarioPatch,
  assetRefSchema
} from './scenario.js';
import {
  scenarioIdSchema,
  sourceIdSchema,
  factIdSchema,
  assumptionIdSchema,
  macroRegionIdSchema,
  regionIdSchema,
  polityIdSchema,
  assetIdSchema
} from './ids.js';
import { historicalFactSchema, assumptionSchema } from './facts.js';

/**
 * Diagnostic error with path and references
 */
export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  refs?: string[]; // Referenced IDs or other context
}

/**
 * Validation result
 */
export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors: Diagnostic[];
}

/**
 * Complete scenario bundle for validation
 */
export interface ScenarioBundle {
  manifest: ScenarioManifest;
  scenario: ScenarioV2;
  sources: SourceRef[];
}

/**
 * Validator for Scenario V2 bundles
 */
export class ScenarioV2Validator {
  private idRegistry = new Map<string, Set<string>>();

  /**
   * Validate a complete scenario bundle
   */
  validateBundle(bundle: unknown): ValidationResult<ScenarioBundle> {
    const errors: Diagnostic[] = [];
    
    // Step 1: Parse and validate basic schema
    const manifestResult = this.validateSchema(scenarioManifestSchema, bundle?.manifest, '/manifest');
    if (!manifestResult.valid) {
      errors.push(...manifestResult.errors);
    }
    
    const scenarioResult = this.validateSchema(scenarioV2Schema, bundle?.scenario, '/scenario');
    if (!scenarioResult.valid) {
      errors.push(...scenarioResult.errors);
    }
    
    const sourcesResult = this.validateSchema(z.array(sourceRefSchema), bundle?.sources, '/sources');
    if (!sourcesResult.valid) {
      errors.push(...sourcesResult.errors);
    }
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    const manifest = manifestResult.data!;
    const scenario = scenarioResult.data!;
    const sources = sourcesResult.data!;
    
    // Step 2: Register all IDs
    this.registerIds(manifest, scenario, sources);
    
    // Step 3: Validate references
    const referenceErrors = this.validateReferences(manifest, scenario, sources);
    errors.push(...referenceErrors);
    
    // Step 4: Validate integrity constraints
    const integrityErrors = this.validateIntegrity(manifest, scenario, sources);
    errors.push(...integrityErrors);
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    return {
      valid: true,
      data: { manifest, scenario, sources },
      errors: []
    };
  }
  
  /**
   * Validate a single schema
   */
  private validateSchema<T extends z.ZodType>(
    schema: T,
    value: unknown,
    basePath: string
  ): ValidationResult<z.infer<T>> {
    const result = schema.safeParse(value);
    
    if (result.success) {
      return { valid: true, data: result.data, errors: [] };
    }
    
    const errors = result.error.issues.map(issue => ({
      code: `schema.${issue.code}`,
      path: `${basePath}${issue.path.length > 0 ? '.' + issue.path.join('.') : ''}`,
      message: issue.message
    }));
    
    return { valid: false, errors };
  }
  
  /**
   * Register all IDs from the bundle
   */
  private registerIds(manifest: ScenarioManifest, scenario: ScenarioV2, sources: SourceRef[]): void {
    this.idRegistry.clear();
    
    // Register manifest/scenario IDs
    this.registerId('scenario', manifest.id);
    this.registerId('scenario', scenario.id);
    
    // Register polities
    Object.keys(scenario.polities).forEach(id => this.registerId('polity', id));
    Object.values(scenario.polities).forEach(polity => {
      this.registerId('polity', polity.id);
    });
    
    // Register regions
    scenario.regions.forEach(region => this.registerId('region', region.id));
    
    // Register sources
    sources.forEach(source => this.registerId('source', source.id));
    
    // Register facts
    scenario.historicalFacts.forEach(fact => this.registerId('fact', fact.id));
    
    // Register assumptions
    scenario.assumptions.forEach(assumption => this.registerId('assumption', assumption.id));
    
    // Register macro regions
    scenario.macroRegions.forEach(macro => this.registerId('macro-region', macro.id));
    
    // Register assets
    manifest.assets.forEach(asset => this.registerId('asset', asset.id));
  }
  
  private registerId(type: string, id: string): void {
    if (!this.idRegistry.has(type)) {
      this.idRegistry.set(type, new Set());
    }
    this.idRegistry.get(type)!.add(id);
  }
  
  private hasId(type: string, id: string): boolean {
    return this.idRegistry.get(type)?.has(id) || false;
  }
  
  /**
   * Validate all references in the bundle
   */
  private validateReferences(
    manifest: ScenarioManifest,
    scenario: ScenarioV2,
    sources: SourceRef[]
  ): Diagnostic[] {
    const errors: Diagnostic[] = [];
    
    // Check manifest ID matches scenario ID
    if (manifest.id !== scenario.id) {
      errors.push({
        code: 'reference.id-mismatch',
        path: '/manifest/id',
        message: `Manifest ID ${manifest.id} does not match scenario ID ${scenario.id}`,
        refs: [manifest.id, scenario.id]
      });
    }
    
    // Check scenario-qualified IDs match scenario ID
    const scenarioSlug = manifest.id.replace('scenario:', '');
    
    // Check source IDs
    sources.forEach((source, index) => {
      const expectedPrefix = `source:${scenarioSlug}:`;
      if (!source.id.startsWith(expectedPrefix)) {
        errors.push({
          code: 'reference.wrong-scenario',
          path: `/sources/${index}/id`,
          message: `Source ID ${source.id} does not belong to scenario ${manifest.id}`,
          refs: [source.id, manifest.id]
        });
      }
    });
    
    // Check fact IDs
    scenario.historicalFacts.forEach((fact, index) => {
      const expectedPrefix = `fact:${scenarioSlug}:`;
      if (!fact.id.startsWith(expectedPrefix)) {
        errors.push({
          code: 'reference.wrong-scenario',
          path: `/scenario/historicalFacts/${index}/id`,
          message: `Fact ID ${fact.id} does not belong to scenario ${manifest.id}`,
          refs: [fact.id, manifest.id]
        });
      }
      
      // Check subject references
      fact.subjectRefs.forEach((subjectRef, subjectIndex) => {
        if (!this.hasId('polity', subjectRef) && 
            !this.hasId('region', subjectRef) && 
            !this.hasId('macro-region', subjectRef)) {
          errors.push({
            code: 'reference.unknown-entity',
            path: `/scenario/historicalFacts/${index}/subjectRefs/${subjectIndex}`,
            message: `Unknown entity reference: ${subjectRef}`,
            refs: [subjectRef]
          });
        }
      });
      
      // Check source references
      fact.sourceRefs.forEach((sourceRef, sourceIndex) => {
        if (!this.hasId('source', sourceRef)) {
          errors.push({
            code: 'reference.unknown-source',
            path: `/scenario/historicalFacts/${index}/sourceRefs/${sourceIndex}`,
            message: `Unknown source reference: ${sourceRef}`,
            refs: [sourceRef]
          });
        }
      });
      
      // Check assumption references
      fact.assumptionRefs.forEach((assumptionRef, assumptionIndex) => {
        if (!this.hasId('assumption', assumptionRef)) {
          errors.push({
            code: 'reference.unknown-assumption',
            path: `/scenario/historicalFacts/${index}/assumptionRefs/${assumptionIndex}`,
            message: `Unknown assumption reference: ${assumptionRef}`,
            refs: [assumptionRef]
          });
        }
      });
    });
    
    // Check assumption source references
    scenario.assumptions.forEach((assumption, index) => {
      assumption.sourceRefs.forEach((sourceRef, sourceIndex) => {
        if (!this.hasId('source', sourceRef)) {
          errors.push({
            code: 'reference.unknown-source',
            path: `/scenario/assumptions/${index}/sourceRefs/${sourceIndex}`,
            message: `Unknown source reference: ${sourceRef}`,
            refs: [sourceRef]
          });
        }
      });
    });
    
    // Check region assignments
    if (scenario.regionAssignments) {
      Object.entries(scenario.regionAssignments).forEach(([regionId, polityId], index) => {
        if (!this.hasId('region', regionId)) {
          errors.push({
            code: 'reference.unknown-region',
            path: `/scenario/regionAssignments/${regionId}`,
            message: `Unknown region in assignment: ${regionId}`,
            refs: [regionId]
          });
        }
        if (!this.hasId('polity', polityId)) {
          errors.push({
            code: 'reference.unknown-polity',
            path: `/scenario/regionAssignments/${regionId}`,
            message: `Unknown polity in assignment: ${polityId}`,
            refs: [polityId]
          });
        }
      });
    }
    
    // Check macro region members
    scenario.macroRegions.forEach((macro, macroIndex) => {
      macro.members.forEach((regionId, memberIndex) => {
        if (!this.hasId('region', regionId)) {
          errors.push({
            code: 'reference.unknown-region',
            path: `/scenario/macroRegions/${macroIndex}/members/${memberIndex}`,
            message: `Unknown region in macro region: ${regionId}`,
            refs: [regionId]
          });
        }
      });
      
      // Check geometry asset reference
      if (macro.geometryAssetRef && !this.hasId('asset', macro.geometryAssetRef)) {
        errors.push({
          code: 'reference.unknown-asset',
          path: `/scenario/macroRegions/${macroIndex}/geometryAssetRef`,
          message: `Unknown asset reference: ${macro.geometryAssetRef}`,
          refs: [macro.geometryAssetRef]
        });
      }
    });
    
    // Check fidelity gap assumption references
    scenario.fidelity.gaps.forEach((gap, gapIndex) => {
      if (gap.assumptionRef && !this.hasId('assumption', gap.assumptionRef)) {
        errors.push({
          code: 'reference.unknown-assumption',
          path: `/scenario/fidelity/gaps/${gapIndex}/assumptionRef`,
          message: `Unknown assumption reference: ${gap.assumptionRef}`,
          refs: [gap.assumptionRef]
        });
      }
    });
    
    // Check default player polity
    if (!this.hasId('polity', scenario.game.defaultPlayer)) {
      errors.push({
        code: 'reference.unknown-polity',
        path: '/scenario/game/defaultPlayer',
        message: `Unknown default player polity: ${scenario.game.defaultPlayer}`,
        refs: [scenario.game.defaultPlayer]
      });
    }
    
    return errors;
  }
  
  /**
   * Validate integrity constraints
   */
  private validateIntegrity(
    manifest: ScenarioManifest,
    scenario: ScenarioV2,
    sources: SourceRef[]
  ): Diagnostic[] {
    const errors: Diagnostic[] = [];
    
    // Check that required assets are present
    manifest.assets.forEach((asset, index) => {
      if (asset.required && !asset.contentAddress) {
        errors.push({
          code: 'integrity.missing-required-asset',
          path: `/manifest/assets/${index}`,
          message: `Required asset ${asset.id} missing content address`,
          refs: [asset.id]
        });
      }
    });
    
    // Check that regions in assignments exist in regions list
    if (scenario.regionAssignments) {
      const regionIds = new Set(scenario.regions.map(r => r.id));
      Object.keys(scenario.regionAssignments).forEach(regionId => {
        if (!regionIds.has(regionId)) {
          errors.push({
            code: 'integrity.assignment-to-undefined-region',
            path: `/scenario/regionAssignments/${regionId}`,
            message: `Region ${regionId} is assigned but not defined in regions list`,
            refs: [regionId]
          });
        }
      });
    }
    
    // Check macro region member uniqueness
    scenario.macroRegions.forEach((macro, macroIndex) => {
      const memberSet = new Set();
      macro.members.forEach((member, memberIndex) => {
        if (memberSet.has(member)) {
          errors.push({
            code: 'integrity.duplicate-macro-member',
            path: `/scenario/macroRegions/${macroIndex}/members/${memberIndex}`,
            message: `Duplicate region ${member} in macro region ${macro.id}`,
            refs: [member, macro.id]
          });
        }
        memberSet.add(member);
      });
    });
    
    // Check that facts with confidence "assumption" have assumption references
    scenario.historicalFacts.forEach((fact, index) => {
      if (fact.confidence === 'assumption' && fact.assumptionRefs.length === 0) {
        errors.push({
          code: 'integrity.assumption-without-reference',
          path: `/scenario/historicalFacts/${index}`,
          message: `Fact ${fact.id} has confidence "assumption" but no assumption references`,
          refs: [fact.id]
        });
      }
      
      // Check that known facts have at least one source or assumption
      if (fact.value.kind !== 'unknown' && fact.sourceRefs.length === 0 && fact.assumptionRefs.length === 0) {
        errors.push({
          code: 'integrity.fact-without-provenance',
          path: `/scenario/historicalFacts/${index}`,
          message: `Fact ${fact.id} has known value but no source or assumption references`,
          refs: [fact.id]
        });
      }
    });
    
    // Check that all gaps in fidelity manifest have corresponding paths
    scenario.fidelity.gaps.forEach((gap, index) => {
      // Basic path validation - would need more sophisticated JSON pointer checking
      if (!gap.path.startsWith('/')) {
        errors.push({
          code: 'integrity.invalid-json-pointer',
          path: `/scenario/fidelity/gaps/${index}/path`,
          message: `Invalid JSON pointer: ${gap.path}`,
          refs: [gap.path]
        });
      }
    });
    
    // Check polity levels in fidelity manifest
    Object.entries(scenario.fidelity.polityLevels).forEach(([polityId, level], index) => {
      if (!this.hasId('polity', polityId)) {
        errors.push({
          code: 'reference.unknown-polity',
          path: `/scenario/fidelity/polityLevels/${polityId}`,
          message: `Unknown polity in fidelity manifest: ${polityId}`,
          refs: [polityId]
        });
      }
    });
    
    return errors;
  }
  
  /**
   * Validate pregame narrative draft
   */
  validatePregameNarrative(draft: unknown, bundle: ScenarioBundle): ValidationResult<PregameNarrativeDraft> {
    const errors: Diagnostic[] = [];
    
    // Step 1: Parse schema
    const draftResult = this.validateSchema(pregameNarrativeDraftSchema, draft, '');
    if (!draftResult.valid) {
      return draftResult;
    }
    
    const narrative = draftResult.data!;
    
    // Step 2: Check scenario ID and checksum match
    if (narrative.scenarioId !== bundle.manifest.id) {
      errors.push({
        code: 'integrity.scenario-mismatch',
        path: '/scenarioId',
        message: `Narrative scenario ID ${narrative.scenarioId} does not match bundle ID ${bundle.manifest.id}`,
        refs: [narrative.scenarioId, bundle.manifest.id]
      });
    }
    
    // Step 3: Register fact IDs from bundle
    const factIds = new Set(bundle.scenario.historicalFacts.map(f => f.id));
    
    // Step 4: Check factsUsed references
    narrative.factsUsed.forEach((factId, index) => {
      if (!factIds.has(factId)) {
        errors.push({
          code: 'reference.unknown-fact',
          path: `/factsUsed/${index}`,
          message: `Unknown fact in factsUsed: ${factId}`,
          refs: [factId]
        });
      }
    });
    
    // Step 5: Check segment fact references
    narrative.segments.forEach((segment, segmentIndex) => {
      segment.factRefs.forEach((factId, factIndex) => {
        if (!factIds.has(factId)) {
          errors.push({
            code: 'reference.unknown-fact',
            path: `/segments/${segmentIndex}/factRefs/${factIndex}`,
            message: `Unknown fact reference in segment: ${factId}`,
            refs: [factId]
          });
        }
      });
    });
    
    // Step 6: Check inferred claim evidence references
    narrative.inferredClaims.forEach((claim, claimIndex) => {
      claim.evidenceRefs.forEach((factId, evidenceIndex) => {
        if (!factIds.has(factId)) {
          errors.push({
            code: 'reference.unknown-fact',
            path: `/inferredClaims/${claimIndex}/evidenceRefs/${evidenceIndex}`,
            message: `Unknown fact reference in claim evidence: ${factId}`,
            refs: [factId]
          });
        }
      });
    });
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    return { valid: true, data: narrative, errors: [] };
  }
  
  /**
   * Validate draft scenario patch
   */
  validateDraftPatch(patch: unknown, baseBundle: ScenarioBundle): ValidationResult<DraftScenarioPatch> {
    const errors: Diagnostic[] = [];
    
    // Step 1: Parse schema
    const patchResult = this.validateSchema(draftScenarioPatchSchema, patch, '');
    if (!patchResult.valid) {
      return patchResult;
    }
    
    const draft = patchResult.data!;
    
    // Step 2: Check base scenario matches
    if (draft.base.scenarioId !== baseBundle.manifest.id) {
      errors.push({
        code: 'integrity.scenario-mismatch',
        path: '/base/scenarioId',
        message: `Patch scenario ID ${draft.base.scenarioId} does not match base ID ${baseBundle.manifest.id}`,
        refs: [draft.base.scenarioId, baseBundle.manifest.id]
      });
    }
    
    // Step 3: Check content version (should be same or warn)
    if (draft.base.contentVersion !== baseBundle.manifest.contentVersion) {
      errors.push({
        code: 'integrity.version-mismatch',
        path: '/base/contentVersion',
        message: `Patch content version ${draft.base.contentVersion} does not match base version ${baseBundle.manifest.contentVersion}`,
        refs: [draft.base.contentVersion, baseBundle.manifest.contentVersion]
      });
    }
    
    // Step 4: Validate patch operations against protected paths
    // This would require a more sophisticated implementation
    // For now, just check that operations have required fields
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    return { valid: true, data: draft, errors: [] };
  }
}