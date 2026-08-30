import crypto from 'crypto';
import { ScenarioBundle, ScenarioV2Validator, ValidationResult } from './validator.js';
import { deterministicHash } from './utils.js';

/**
 * Canonical JSON serialization options for deterministic checksums
 */
const CANONICAL_JSON_OPTIONS = {
  // RFC 8785/JCS semantics
  // Sort object keys alphabetically
  // Use stable stringify for deterministic output
  replacer: (key: string, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Sort object keys for deterministic output
      return Object.keys(value).sort().reduce((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {} as Record<string, unknown>);
    }
    return value;
  },
  space: undefined // No whitespace
};

/**
 * Scenario V2 builder for deterministic builds and checksums
 */
export class ScenarioV2Builder {
  private validator = new ScenarioV2Validator();

  /**
   * Build a scenario bundle with canonical checksum
   */
  build(bundle: unknown): BuildResult {
    // Step 1: Validate the bundle
    const validation = this.validator.validateBundle(bundle);
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
        inputChecksum: null,
        artifactChecksums: null
      };
    }

    const validatedBundle = validation.data!;

    // Step 2: Calculate canonical input checksum
    const inputChecksum = this.calculateInputChecksum(validatedBundle);

    // Step 3: Build runtime projections (simplified for Phase 1)
    const projections = this.buildProjections(validatedBundle);

    // Step 4: Calculate artifact checksums
    const artifactChecksums = this.calculateArtifactChecksums(projections);

    return {
      success: true,
      bundle: validatedBundle,
      projections,
      inputChecksum,
      artifactChecksums,
      errors: []
    };
  }

  /**
   * Calculate canonical input checksum according to scenario-v2-integrity.md
   */
  private calculateInputChecksum(bundle: ScenarioBundle): string {
    const hash = crypto.createHash('sha256');
    
    // Include schema-valid manifest/scenario/source data
    const canonicalData = {
      manifest: this.canonicalize(bundle.manifest),
      scenario: this.canonicalize(bundle.scenario),
      sources: this.canonicalize(bundle.sources),
      builderVersion: '1.0.0' // Builder contract version
    };
    
    // Add byte hashes of required assets
    const assetHashes = bundle.manifest.assets
      .filter(asset => asset.required && asset.contentAddress)
      .map(asset => asset.contentAddress)
      .sort(); // Sort for determinism
    
    canonicalData.manifest.assets = assetHashes.map(hash => ({ contentAddress: hash }));
    
    const canonicalJson = JSON.stringify(canonicalData, CANONICAL_JSON_OPTIONS.replacer);
    hash.update(canonicalJson);
    
    return `sha256:${hash.digest('hex')}`;
  }

  /**
   * Build runtime projections from validated bundle
   */
  private buildProjections(bundle: ScenarioBundle): RuntimeProjections {
    // Simplified Phase 1 projections
    // In a full implementation, this would create world.json, economy.json, etc.
    return {
      world: {
        revision: `world-${Date.now()}`, // Placeholder
        scenarioId: bundle.manifest.id,
        startDate: bundle.scenario.game.startDate,
        polities: Object.values(bundle.scenario.polities).map(polity => ({
          id: polity.id,
          name: polity.name,
          color: polity.color
        })),
        regions: bundle.scenario.regions.map(region => ({
          id: region.id,
          dataset: region.dataset,
          nativeId: region.nativeId,
          owner: bundle.scenario.regionAssignments?.[region.id] || null
        })),
        simulationRules: bundle.scenario.simulationRules
      },
      facts: bundle.scenario.historicalFacts.map(fact => ({
        id: fact.id,
        subjectRefs: fact.subjectRefs,
        predicate: fact.predicate,
        value: fact.value,
        confidence: fact.confidence
      }))
    };
  }

  /**
   * Calculate checksums for built artifacts
   */
  private calculateArtifactChecksums(projections: RuntimeProjections): ArtifactChecksums {
    const hash = crypto.createHash('sha256');
    
    // Canonicalize and hash each projection
    const worldHash = this.calculateHash(this.canonicalize(projections.world));
    const factsHash = this.calculateHash(this.canonicalize(projections.facts));
    
    // Combined hash for all artifacts
    const combined = crypto.createHash('sha256');
    combined.update(worldHash);
    combined.update(factsHash);
    
    return {
      world: worldHash,
      facts: factsHash,
      combined: `sha256:${combined.digest('hex')}`
    };
  }

  /**
   * Canonicalize data for deterministic hashing
   */
  private canonicalize(data: unknown): unknown {
    return JSON.parse(JSON.stringify(data, CANONICAL_JSON_OPTIONS.replacer));
  }

  /**
   * Calculate SHA-256 hash of canonicalized data
   */
  private calculateHash(data: unknown): string {
    const canonicalJson = JSON.stringify(data, CANONICAL_JSON_OPTIONS.replacer);
    const hash = crypto.createHash('sha256');
    hash.update(canonicalJson);
    return `sha256:${hash.digest('hex')}`;
  }

  /**
   * Validate pregame narrative draft against bundle
   */
  validatePregameNarrative(draft: unknown, bundle: ScenarioBundle): ValidationResult<any> {
    return this.validator.validatePregameNarrative(draft, bundle);
  }

  /**
   * Validate draft scenario patch
   */
  validateDraftPatch(patch: unknown, baseBundle: ScenarioBundle): ValidationResult<any> {
    return this.validator.validateDraftPatch(patch, baseBundle);
  }
}

/**
 * Build result
 */
export interface BuildResult {
  success: boolean;
  bundle?: ScenarioBundle;
  projections?: RuntimeProjections;
  inputChecksum: string | null;
  artifactChecksums: ArtifactChecksums | null;
  errors: Array<{ code: string; path: string; message: string; refs?: string[] }>;
}

/**
 * Runtime projections (simplified for Phase 1)
 */
export interface RuntimeProjections {
  world: {
    revision: string;
    scenarioId: string;
    startDate: string;
    polities: Array<{ id: string; name: string; color: string }>;
    regions: Array<{ id: string; dataset: string; nativeId: string; owner: string | null }>;
    simulationRules: any;
  };
  facts: Array<{
    id: string;
    subjectRefs: string[];
    predicate: string;
    value: any;
    confidence: string;
  }>;
}

/**
 * Artifact checksums
 */
export interface ArtifactChecksums {
  world: string;
  facts: string;
  combined: string;
}

/**
 * Protected fact contradiction checker
 */
export class ProtectedFactChecker {
  /**
   * Check if inferred claims contradict protected facts
   */
  checkContradictions(
    claims: Array<{ assertion: any }>,
    protectedFacts: Array<{ predicate: string; value: any }>
  ): Array<{ claim: any; contradiction: string }> {
    const contradictions: Array<{ claim: any; contradiction: string }> = [];
    
    // Simplified contradiction checking
    // In a full implementation, this would compare quantities with units,
    // check date ranges, etc.
    
    claims.forEach(claim => {
      const assertion = claim.assertion;
      
      // Find matching protected facts by predicate
      const matchingFacts = protectedFacts.filter(
        fact => fact.predicate === assertion.predicate
      );
      
      matchingFacts.forEach(fact => {
        // Check if assertion contradicts the fact
        // This is a simplified check - real implementation would need
        // to handle different value types and operators
        if (this.valuesContradict(assertion, fact.value)) {
          contradictions.push({
            claim,
            contradiction: `Claim contradicts protected fact for predicate "${assertion.predicate}"`
          });
        }
      });
    });
    
    return contradictions;
  }

  /**
   * Check if two values contradict based on assertion operator
   */
  private valuesContradict(assertion: any, protectedValue: any): boolean {
    // Simplified implementation
    // Real implementation would need to handle:
    // - Quantity comparisons with unit conversion
    // - Date range comparisons
    // - Entity reference comparisons
    // - Text comparisons
    
    if (assertion.operator === 'equals') {
      return !this.valuesEqual(assertion.value, protectedValue);
    } else if (assertion.operator === 'not-equals') {
      return this.valuesEqual(assertion.value, protectedValue);
    }
    
    // For other operators, we'd need more sophisticated checking
    return false;
  }

  /**
   * Check if two fact values are equal
   */
  private valuesEqual(a: any, b: any): boolean {
    if (a.kind !== b.kind) return false;
    
    switch (a.kind) {
      case 'quantity':
        return a.amount === b.amount && a.unit === b.unit;
      case 'text':
        return a.value === b.value;
      case 'boolean':
        return a.value === b.value;
      case 'entity-ref':
        return a.value === b.value;
      default:
        return false;
    }
  }
}