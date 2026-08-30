import { createHash } from 'node:crypto';
import { canonicalStringify } from './builder.js';

// The adapter operates on the resolved `export default` of a legacy `.spec.mjs`
// preset. It reads the spec, never writes back into it, and never resolves GADM
// codes to typed region IDs (that policy is owned by the region catalog, which
// is out of scope for this adapter).

export interface LegacyLoss {
  path: string;
  reason: string;
}

export interface LegacyWarning {
  path: string;
  message: string;
}

export interface CollisionEntry {
  originalCode: string;
  proposedId: string;
  collideWith: string;
}

export interface LegacyMigrationReport {
  scenarioId: string;
  originalSpecId: string;
  polityCount: number;
  losses: LegacyLoss[];
  warnings: LegacyWarning[];
  collisionReport: CollisionEntry[];
}

export interface LegacyMigrationResult {
  draft: unknown;
  report: LegacyMigrationReport;
  draftChecksum: string;
}

interface LegacyPolity {
  name?: unknown;
  color?: unknown;
  aliases?: unknown;
  note?: unknown;
}

interface LegacySpec {
  id?: unknown;
  meta?: { name?: unknown; description?: unknown } | null;
  game?: { country?: unknown; startDate?: unknown; gameDate?: unknown } | null;
  polities?: Record<string, LegacyPolity> | null;
  countryAssignments?: Record<string, unknown> | null;
  regionAssignments?: Record<string, unknown> | null;
  cities?: unknown;
  allowedUnitTypes?: unknown;
  simulationRules?: unknown;
  startingTimelineText?: unknown;
}

export class LegacySpecAdapter {
  migrate(spec: unknown): LegacyMigrationResult {
    const losses: LegacyLoss[] = [];
    const warnings: LegacyWarning[] = [];
    const collisions: CollisionEntry[] = [];

    const legacy = spec as LegacySpec;

    const rawId = typeof legacy.id === 'string' ? legacy.id : 'legacy';
    const scenarioSlug = slugify(rawId);
    const scenarioId = `scenario:${scenarioSlug}`;

    // ── Polities ───────────────────────────────────────────────────────────────
    const polityEntries = new Map<string, { name: string; color: string; aliases: string[] }>();
    const codeToPolityId = new Map<string, string>();
    const idToCode = new Map<string, string>();
    const usedIds = new Set<string>();

    const polityTable = legacy.polities ?? {};
    for (const [code, polity] of Object.entries(polityTable)) {
      const codeSlug = slugify(code);
      let proposedId = `polity:${scenarioSlug}-${codeSlug}`;
      let suffix = 2;
      while (usedIds.has(proposedId)) {
        collisions.push({ originalCode: code, proposedId, collideWith: idToCode.get(proposedId) ?? '<unknown>' });
        proposedId = `polity:${scenarioSlug}-${codeSlug}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(proposedId);
      idToCode.set(proposedId, code);
      codeToPolityId.set(code, proposedId);
      polityEntries.set(proposedId, {
        name: typeof polity.name === 'string' ? polity.name : code,
        color: typeof polity.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(polity.color) ? polity.color : '#888888',
        aliases: Array.isArray(polity.aliases) ? polity.aliases.filter((a): a is string => typeof a === 'string') : [],
      });
    }

    const polities: Record<string, unknown> = {};
    for (const [id, entry] of polityEntries) {
      polities[id] = { id, name: entry.name, color: entry.color, aliases: entry.aliases };
    }

    // ── Simulation rules ───────────────────────────────────────────────────────
    const story = typeof legacy.simulationRules === 'string' ? legacy.simulationRules : '';
    const narrativeRules = story.length ? [story] : [];
    if (story.length) {
      warnings.push({
        path: '/scenario/simulationRules',
        message: 'Legacy prose simulationRules moved to constraints.narrativeRules[]; mechanical capabilities require review',
      });
    }

    const allowed = Array.isArray(legacy.allowedUnitTypes) && legacy.allowedUnitTypes.every((u) => typeof u === 'string')
      ? (legacy.allowedUnitTypes as string[])
      : [];
    const constraints: Record<string, unknown> = { narrativeRules };
    if (allowed.length) {
      constraints.noAirPower = !allowed.includes('air');
      constraints.noNaval = !allowed.includes('naval');
    }

    // ── Start / default player ─────────────────────────────────────────────────
    const startDate = typeof legacy.game?.startDate === 'string' ? legacy.game.startDate : '';
    const playerCode = typeof legacy.game?.country === 'string' ? legacy.game.country : '';
    const defaultPlayer = codeToPolityId.get(playerCode) ?? '';

    // ── Metadata ───────────────────────────────────────────────────────────────
    const name = typeof legacy.meta?.name === 'string' ? legacy.meta.name : rawId;
    const description = typeof legacy.meta?.description === 'string' ? legacy.meta.description : undefined;

    // ── Losses (deferred without the region catalog / provenance) ─────────────
    if (legacy.countryAssignments && Object.keys(legacy.countryAssignments).length) {
      losses.push({ path: '/scenario/regionAssignments', reason: 'countryAssignments reference GADM GID_0 codes; mapping to typed RegionId is deferred to the region catalog' });
    }
    if (legacy.regionAssignments && Object.keys(legacy.regionAssignments).length) {
      losses.push({ path: '/scenario/regions', reason: 'regionAssignments reference GADM GID_1 codes; mapping to typed RegionId is deferred to the region catalog' });
    }
    if (Array.isArray(legacy.cities) && legacy.cities.length) {
      losses.push({ path: '/scenario/cities', reason: 'legacy city rows carry names/coords, not typed RegionId; region resolution deferred' });
    }
    losses.push({ path: '/scenario/historicalFacts', reason: 'legacy spec carries no sourced facts; provenance must be authored for V2' });
    losses.push({ path: '/scenario/assumptions', reason: 'legacy spec declares no authored assumptions' });
    losses.push({ path: '/scenario/simulationRules/era', reason: 'legacy prose does not encode a structured era identifier' });

    const draft = {
      manifest: {
        schemaVersion: 2,
        id: scenarioId,
        contentVersion: '0.1.0',
        engineRange: '>=0.1.0 <1.0.0',
        defaultLocale: 'en',
        scenarioPath: 'scenario.json',
        sourcesPath: 'sources.json',
        assets: [],
      },
      scenario: {
        schemaVersion: 2,
        id: scenarioId,
        meta: description ? { title: name, description } : { title: name },
        game: { startDate, defaultPlayer },
        polities,
        regions: [],
        simulationRules: {
          era: 'unknown',
          aiHistoryMode: 'conditional',
          constraints,
          technologyLevel: { era: 'unknown' },
        },
        historicalFacts: [],
        assumptions: [],
        macroRegions: [],
        fidelity: {
          intendedUse: 'development-scenario',
          polityLevels: Object.fromEntries([...polityEntries.keys()].map((id) => [id, 'Baseline'])),
          gaps: losses.map((l) => ({ path: l.path, disposition: 'unknown' as const, reason: l.reason })),
        },
      },
      sources: [],
    };

    const draftChecksum = checksum(draft);
    const report: LegacyMigrationReport = {
      scenarioId,
      originalSpecId: rawId,
      polityCount: polityEntries.size,
      losses,
      warnings,
      collisionReport: collisions,
    };

    return { draft, report, draftChecksum };
  }
}

export function slugify(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || 'legacy';
}

function checksum(draft: unknown): string {
  const json = canonicalStringify(draft);
  return `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`;
}