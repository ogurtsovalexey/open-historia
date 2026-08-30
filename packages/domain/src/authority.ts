import { z } from 'zod';
import { deepEqual } from './utils.js';

/**
 * Protected path categories from scenario-v2-integrity.md
 */
export const protectedPathCategorySchema = z.enum([
  'scenario-manifest',
  'scenario-identity',
  'scenario-game-start',
  'scenario-politics',
  'scenario-regions',
  'scenario-region-assignments',
  'scenario-simulation-rules',
  'scenario-historical-facts',
  'scenario-assumptions',
  'scenario-macro-regions',
  'scenario-sources'
]);

export type ProtectedPathCategory = z.infer<typeof protectedPathCategorySchema>;

/**
 * Authority level for state modification
 */
export const authorityLevelSchema = z.enum([
  'authored-scenario',      // Immutable starting truth
  'authoritative-total',    // Engine-computed totals (economy, resources, etc.)
  'mutable-campaign',       // Player/AI mutable game state
  'derived-projection'      // Derived projections (culture, religion, etc.)
]);

export type AuthorityLevel = z.infer<typeof authorityLevelSchema>;

/**
 * Path protection rule
 */
export const pathProtectionRuleSchema = z.object({
  pathPattern: z.string(), // JSON pointer pattern
  category: protectedPathCategorySchema,
  authority: authorityLevelSchema,
  description: z.string()
});

export type PathProtectionRule = z.infer<typeof pathProtectionRuleSchema>;

export interface AuthorityPathRule {
  pathPattern: string;
  authority: AuthorityLevel;
  description: string;
  category?: ProtectedPathCategory;
}

/**
 * Protected path families from scenario-v2-integrity.md section 7
 */
export const SCENARIO_PROTECTED_PATHS: readonly PathProtectionRule[] = [
  {
    pathPattern: '/manifest/schemaVersion',
    category: 'scenario-manifest',
    authority: 'authored-scenario',
    description: 'Schema version identifier'
  },
  {
    pathPattern: '/manifest/id',
    category: 'scenario-identity',
    authority: 'authored-scenario',
    description: 'Scenario package ID'
  },
  {
    pathPattern: '/manifest/contentVersion',
    category: 'scenario-identity',
    authority: 'authored-scenario',
    description: 'Scenario content version'
  },
  {
    pathPattern: '/scenario/id',
    category: 'scenario-identity',
    authority: 'authored-scenario',
    description: 'Scenario identity'
  },
  {
    pathPattern: '/scenario/schemaVersion',
    category: 'scenario-identity',
    authority: 'authored-scenario',
    description: 'Scenario schema version'
  },
  {
    pathPattern: '/scenario/game/startDate',
    category: 'scenario-game-start',
    authority: 'authored-scenario',
    description: 'Game start date'
  },
  {
    pathPattern: '/scenario/polities/*/id',
    category: 'scenario-politics',
    authority: 'authored-scenario',
    description: 'Polity identity'
  },
  {
    pathPattern: '/scenario/regions/*/id',
    category: 'scenario-regions',
    authority: 'authored-scenario',
    description: 'Region identity'
  },
  {
    pathPattern: '/scenario/regions/*/datasetVersion',
    category: 'scenario-regions',
    authority: 'authored-scenario',
    description: 'Region dataset version'
  },
  {
    pathPattern: '/scenario/regions/*/nativeId',
    category: 'scenario-regions',
    authority: 'authored-scenario',
    description: 'Region native ID'
  },
  {
    pathPattern: '/scenario/regionAssignments/*',
    category: 'scenario-region-assignments',
    authority: 'authored-scenario',
    description: 'Starting region assignments'
  },
  {
    pathPattern: '/scenario/simulationRules',
    category: 'scenario-simulation-rules',
    authority: 'authored-scenario',
    description: 'Simulation rules'
  },
  {
    pathPattern: '/scenario/historicalFacts/*',
    category: 'scenario-historical-facts',
    authority: 'authored-scenario',
    description: 'Historical facts'
  },
  {
    pathPattern: '/scenario/assumptions/*',
    category: 'scenario-assumptions',
    authority: 'authored-scenario',
    description: 'Authored assumptions'
  },
  {
    pathPattern: '/scenario/macroRegions/*/members',
    category: 'scenario-macro-regions',
    authority: 'authored-scenario',
    description: 'Macro region membership'
  },
  {
    pathPattern: '/sources/*',
    category: 'scenario-sources',
    authority: 'authored-scenario',
    description: 'Source references'
  }
] as const;

/**
 * Representative engine-owned totals. Simulation commands may change their
 * inputs, but AI/player payloads cannot assign the derived totals directly.
 */
export const ENGINE_AUTHORITATIVE_PATHS: readonly AuthorityPathRule[] = [
  {
    pathPattern: '/world/polities/*/populationTotal',
    authority: 'authoritative-total',
    description: 'Engine-computed polity population total'
  },
  {
    pathPattern: '/world/polities/*/economy/*',
    authority: 'authoritative-total',
    description: 'Engine-computed polity economy total'
  },
  {
    pathPattern: '/world/polities/*/resources/*',
    authority: 'authoritative-total',
    description: 'Engine-computed polity resource total'
  }
] as const;

const ALL_AUTHORITY_PATHS: readonly AuthorityPathRule[] = [
  ...SCENARIO_PROTECTED_PATHS,
  ...ENGINE_AUTHORITATIVE_PATHS
];

/**
 * Check if a JSON pointer matches a protected path pattern
 */
export function isProtectedPath(path: string): boolean {
  return ALL_AUTHORITY_PATHS.some(rule =>
    matchJsonPointerPattern(path, rule.pathPattern)
  );
}

/**
 * Get protection rules for a path
 */
export function getPathProtection(path: string): AuthorityPathRule[] {
  return ALL_AUTHORITY_PATHS.filter(rule =>
    matchJsonPointerPattern(path, rule.pathPattern)
  );
}

/**
 * Check if a mutation is allowed based on authority level
 */
export function isMutationAllowed(
  path: string,
  authority: AuthorityLevel,
  currentValue: unknown,
  newValue: unknown
): { allowed: boolean; reason?: string } {
  const protections = getPathProtection(path);

  if (protections.length === 0) {
    // Path not explicitly protected - check authority level
    if (authority === 'authored-scenario') {
      return {
        allowed: false,
        reason: 'Cannot modify non-protected paths with authored-scenario authority'
      };
    }
    return { allowed: true };
  }

  // Check each protection rule
  for (const rule of protections) {
    if (authority === 'authored-scenario' && rule.authority === 'authored-scenario') {
      return {
        allowed: false,
        reason: `Cannot modify authored-scenario path: ${rule.description}`
      };
    }

    if (rule.authority === 'authored-scenario') {
      // Check if value is actually changing
      if (deepEqual(currentValue, newValue)) {
        return {
          allowed: false,
          reason: `Cannot modify ${rule.description} to same value`
        };
      }
      return {
        allowed: false,
        reason: `Protected authored-scenario path: ${rule.description}`
      };
    }

    // Check if this is an authoritative-total path being modified by AI
    if (rule.authority === 'authoritative-total' && authority !== 'authoritative-total') {
      return {
        allowed: false,
        reason: `Cannot modify authoritative-total path with ${authority} authority`
      };
    }
  }

  return { allowed: true };
}

/**
 * Match JSON pointer against pattern with wildcards
 * Pattern uses * for single segment wildcard
 */
function matchJsonPointerPattern(path: string, pattern: string): boolean {
  const pathSegments = path.split('/').filter(Boolean);
  const patternSegments = pattern.split('/').filter(Boolean);

  if (patternSegments.length !== pathSegments.length) {
    return false;
  }

  for (let i = 0; i < patternSegments.length; i++) {
    if (patternSegments[i] === '*') {
      continue; // Wildcard matches any segment
    }
    if (patternSegments[i] !== pathSegments[i]) {
      return false;
    }
  }

  return true;
}
