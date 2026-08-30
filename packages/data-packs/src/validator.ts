import { isProtectedPath, sourceRefSchema } from '@open-historia/domain';
import type { HistoricalFact, SourceRef, Assumption } from '@open-historia/domain';
import {
  scenarioManifestSchema,
  scenarioV2Schema,
  pregameNarrativeDraftSchema,
  draftScenarioPatchSchema,
} from './schemas.js';
import type {
  ScenarioV2Manifest,
  ScenarioV2,
  PregameNarrativeDraft,
  DraftScenarioPatch,
  InferredClaim,
  AssertionValue,
} from './schemas.js';

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  refs?: string[];
}

export interface ScenarioBundle {
  manifest: ScenarioV2Manifest;
  scenario: ScenarioV2;
  sources: SourceRef[];
}

interface ZodIssueLike {
  code: string;
  path: PropertyKey[];
  message: string;
}

function toDiagnostics(issues: ZodIssueLike[]): Diagnostic[] {
  return issues.map((issue) => ({
    code: `schema.${issue.code}`,
    path: issue.path.length ? `/${issue.path.join('/')}` : '',
    message: issue.message,
  }));
}

function refError(code: string, path: string, message: string, refs: string[]): Diagnostic {
  return { code, path, message, refs };
}

export class ScenarioV2Validator {
  validateBundle(input: unknown): { valid: boolean; bundle?: ScenarioBundle; errors: Diagnostic[] } {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: [{ code: 'schema.invalid-type', path: '', message: 'Bundle must be an object' }] };
    }

    const raw = input as { manifest?: unknown; scenario?: unknown; sources?: unknown };

    const manifestParsed = scenarioManifestSchema.safeParse(raw.manifest);
    const scenarioParsed = scenarioV2Schema.safeParse(raw.scenario);
    const sourcesParsed = sourceRefSchema.array().safeParse(raw.sources ?? []);

    const errors: Diagnostic[] = [];
    if (!manifestParsed.success) {
      errors.push(...toDiagnostics(manifestParsed.error.issues).map((d) => ({ ...d, path: `/manifest${d.path}` })));
    }
    if (!scenarioParsed.success) {
      errors.push(...toDiagnostics(scenarioParsed.error.issues).map((d) => ({ ...d, path: `/scenario${d.path}` })));
    }
    if (!sourcesParsed.success) {
      errors.push(...toDiagnostics(sourcesParsed.error.issues).map((d) => ({ ...d, path: `/sources${d.path}` })));
    }

    if (!manifestParsed.success || !scenarioParsed.success || !sourcesParsed.success) {
      return { valid: false, errors };
    }

    const bundle: ScenarioBundle = {
      manifest: manifestParsed.data,
      scenario: scenarioParsed.data,
      sources: sourcesParsed.data,
    };

    errors.push(...this.validateReferences(bundle));
    errors.push(...this.validateProvenance(bundle));
    errors.push(...this.validateIntegrity(bundle));

    return errors.length === 0 ? { valid: true, bundle, errors: [] } : { valid: false, bundle, errors };
  }

  validatePregameNarrative(
    input: unknown,
    baseChecksum: string,
    baseBundle: ScenarioBundle,
  ): { valid: boolean; draft?: PregameNarrativeDraft; errors: Diagnostic[] } {
    const parsed = pregameNarrativeDraftSchema.safeParse(input);
    if (!parsed.success) {
      return { valid: false, errors: toDiagnostics(parsed.error.issues) };
    }
    const draft = parsed.data;
    const errors: Diagnostic[] = [];

    if (draft.scenarioId !== baseBundle.manifest.id) {
      errors.push({
        code: 'integrity.scenario-mismatch',
        path: '/scenarioId',
        message: `draft scenarioId "${draft.scenarioId}" != "${baseBundle.manifest.id}"`,
        refs: [draft.scenarioId, baseBundle.manifest.id],
      });
    }
    if (draft.baseInputChecksum !== baseChecksum) {
      errors.push({
        code: 'integrity.stale-base-checksum',
        path: '/baseInputChecksum',
        message: 'draft baseInputChecksum does not match the pinned input',
      });
    }

    const knownFacts = this.knownFacts(baseBundle);
    draft.factsUsed.forEach((fid, i) => {
      if (!knownFacts.has(fid)) {
        errors.push(refError('reference.unknown-fact', `/factsUsed/${i}`, `unknown fact "${fid}"`, [fid]));
      }
    });

    const referenced = new Set<string>();
    draft.segments.forEach((seg) => seg.factRefs.forEach((f) => referenced.add(f)));
    draft.inferredClaims.forEach((claim) => claim.evidenceRefs.forEach((f) => referenced.add(f)));
    const used = new Set(draft.factsUsed);
    if (used.size !== referenced.size || [...used].some((f) => !referenced.has(f))) {
      errors.push({
        code: 'integrity.facts-used-mismatch',
        path: '/factsUsed',
        message: 'factsUsed is not the de-duplicated union of segment.factRefs and claim evidenceRefs',
      });
    }

    draft.segments.forEach((seg, i) => {
      if (seg.kind === 'fact' && seg.factRefs.length === 0) {
        errors.push({ code: 'integrity.fact-segment-missing-ref', path: `/segments/${i}`, message: 'fact segment requires at least one factRefs entry' });
      }
      if (seg.kind === 'inference' && seg.claimRefs.length === 0) {
        errors.push({ code: 'integrity.inference-segment-missing-claim', path: `/segments/${i}`, message: 'inference segment requires at least one claimRefs entry' });
      }
      if (seg.kind === 'narrative-color' && (seg.factRefs.length > 0 || seg.claimRefs.length > 0)) {
        errors.push({ code: 'integrity.narrative-color-references', path: `/segments/${i}`, message: 'narrative-color segment cannot carry references' });
      }
      if (seg.kind === 'narrative-color' && /\d/.test(seg.text)) {
        errors.push({ code: 'integrity.narrative-color-number', path: `/segments/${i}`, message: 'narrative-color segment cannot contain numeric tokens' });
      }
    });

    draft.inferredClaims.forEach((claim, i) => {
      errors.push(...this.checkClaim(claim, i, baseBundle));
    });

    return errors.length === 0 ? { valid: true, draft, errors: [] } : { valid: false, draft, errors };
  }

  validateDraftPatch(
    input: unknown,
    baseChecksum: string,
    baseBundle: ScenarioBundle,
  ): { valid: boolean; patch?: DraftScenarioPatch; errors: Diagnostic[] } {
    const parsed = draftScenarioPatchSchema.safeParse(input);
    if (!parsed.success) {
      return { valid: false, errors: toDiagnostics(parsed.error.issues) };
    }
    const patch = parsed.data;
    const errors: Diagnostic[] = [];

    if (patch.base.scenarioId !== baseBundle.manifest.id) {
      errors.push({
        code: 'integrity.scenario-mismatch',
        path: '/base/scenarioId',
        message: `patch base scenarioId "${patch.base.scenarioId}" != "${baseBundle.manifest.id}"`,
        refs: [patch.base.scenarioId, baseBundle.manifest.id],
      });
    }
    if (patch.base.contentVersion !== baseBundle.manifest.contentVersion) {
      errors.push({
        code: 'integrity.version-mismatch',
        path: '/base/contentVersion',
        message: `patch base contentVersion "${patch.base.contentVersion}" != "${baseBundle.manifest.contentVersion}"`,
      });
    }
    if (patch.base.inputChecksum !== baseChecksum) {
      errors.push({
        code: 'integrity.stale-base-checksum',
        path: '/base/inputChecksum',
        message: 'patch base inputChecksum is stale',
      });
    }

    patch.operations.forEach((op, i) => {
      if (isProtectedPath(op.path)) {
        errors.push({
          code: 'integrity.protected-path-mutation',
          path: `/operations/${i}/path`,
          message: `patch operation targets protected path "${op.path}"`,
          refs: [op.path],
        });
      }
    });

    return errors.length === 0 ? { valid: true, patch, errors: [] } : { valid: false, patch, errors };
  }

  // ── Reference validation ────────────────────────────────────────────────────
  private validateReferences(bundle: ScenarioBundle): Diagnostic[] {
    const errors: Diagnostic[] = [];
    const { manifest, scenario, sources } = bundle;

    if (manifest.id !== scenario.id) {
      errors.push({
        code: 'reference.id-mismatch',
        path: '/manifest/id',
        message: `manifest.id ${manifest.id} != scenario.id ${scenario.id}`,
        refs: [manifest.id, scenario.id],
      });
    }

    const slug = scenario.id.replace(/^scenario:/, '');
    const expectPrefix = (prefix: string): string => `${prefix}:${slug}:`;

    sources.forEach((source, i) => {
      if (!source.id.startsWith(expectPrefix('source'))) {
        errors.push(refError('reference.wrong-scenario', `/sources/${i}/id`, `source "${source.id}" is not scenario-qualified under ${scenario.id}`, [source.id]));
      }
    });

    scenario.historicalFacts.forEach((fact, i) => {
      if (!fact.id.startsWith(expectPrefix('fact'))) {
        errors.push(refError('reference.wrong-scenario', `/scenario/historicalFacts/${i}/id`, `fact "${fact.id}" is not scenario-qualified under ${scenario.id}`, [fact.id]));
      }
      fact.subjectRefs.forEach((subj, j) => {
        if (!this.isKnownEntity(bundle, subj)) {
          errors.push(refError('reference.unknown-entity', `/scenario/historicalFacts/${i}/subjectRefs/${j}`, `unknown entity reference "${subj}"`, [subj]));
        }
      });
      fact.sourceRefs.forEach((sid, j) => {
        if (!this.knownSources(bundle).has(sid)) {
          errors.push(refError('reference.unknown-source', `/scenario/historicalFacts/${i}/sourceRefs/${j}`, `unknown source "${sid}"`, [sid]));
        }
      });
      fact.assumptionRefs.forEach((aid, j) => {
        if (!this.knownAssumptions(bundle).has(aid)) {
          errors.push(refError('reference.unknown-assumption', `/scenario/historicalFacts/${i}/assumptionRefs/${j}`, `unknown assumption "${aid}"`, [aid]));
        }
      });
    });

    scenario.assumptions.forEach((assumption, i) => {
      assumption.sourceRefs.forEach((sid, j) => {
        if (!this.knownSources(bundle).has(sid)) {
          errors.push(refError('reference.unknown-source', `/scenario/assumptions/${i}/sourceRefs/${j}`, `unknown source "${sid}"`, [sid]));
        }
      });
    });

    if (scenario.regionAssignments) {
      Object.entries(scenario.regionAssignments).forEach(([regionId, polityId]) => {
        if (!this.knownRegions(bundle).has(regionId)) {
          errors.push(refError('reference.unknown-region', `/scenario/regionAssignments/${regionId}`, `region "${regionId}" is not declared in regions[]`, [regionId]));
        }
        if (!this.knownPolities(bundle).has(polityId)) {
          errors.push(refError('reference.unknown-polity', `/scenario/regionAssignments/${regionId}`, `unknown polity "${polityId}"`, [polityId]));
        }
      });
    }

    scenario.macroRegions.forEach((macro, i) => {
      macro.members.forEach((regionId, j) => {
        if (!this.knownRegions(bundle).has(regionId)) {
          errors.push(refError('reference.unknown-region', `/scenario/macroRegions/${i}/members/${j}`, `unknown region "${regionId}"`, [regionId]));
        }
      });
      if (macro.geometryAssetRef && !this.knownAssets(bundle).has(macro.geometryAssetRef)) {
        errors.push(refError('reference.unknown-asset', `/scenario/macroRegions/${i}/geometryAssetRef`, `unknown asset "${macro.geometryAssetRef}"`, [macro.geometryAssetRef]));
      }
    });

    scenario.fidelity.gaps.forEach((gap, i) => {
      if (gap.assumptionRef && !this.knownAssumptions(bundle).has(gap.assumptionRef)) {
        errors.push(refError('reference.unknown-assumption', `/scenario/fidelity/gaps/${i}/assumptionRef`, `unknown assumption "${gap.assumptionRef}"`, [gap.assumptionRef]));
      }
    });

    Object.entries(scenario.fidelity.polityLevels).forEach(([polityId]) => {
      if (!this.knownPolities(bundle).has(polityId)) {
        errors.push(refError('reference.unknown-polity', `/scenario/fidelity/polityLevels/${polityId}`, `unknown polity "${polityId}" in fidelity`, [polityId]));
      }
    });

    if (!this.knownPolities(bundle).has(scenario.game.defaultPlayer)) {
      errors.push(refError('reference.unknown-polity', '/scenario/game/defaultPlayer', `unknown default player polity "${scenario.game.defaultPlayer}"`, [scenario.game.defaultPlayer]));
    }

    return errors;
  }

  // ── Provenance validation ───────────────────────────────────────────────────
  private validateProvenance(bundle: ScenarioBundle): Diagnostic[] {
    const errors: Diagnostic[] = [];
    bundle.scenario.historicalFacts.forEach((fact, i) => {
      const basePath = `/scenario/historicalFacts/${i}`;

      if (fact.confidence === 'assumption') {
        if (fact.assumptionRefs.length === 0) {
          errors.push({ code: 'provenance.assumption-confidence-missing-ref', path: basePath, message: `fact "${fact.id}" has confidence "assumption" but no assumptionRefs`, refs: [fact.id] });
        }
        if (!fact.transformation.some((step) => step.operation === 'scenario-choice')) {
          errors.push({ code: 'provenance.assumption-missing-scenario-choice', path: `${basePath}/transformation`, message: `fact "${fact.id}" with confidence "assumption" must carry a "scenario-choice" transformation`, refs: [fact.id] });
        }
      }

      if (fact.value.kind !== 'unknown' && fact.sourceRefs.length === 0 && fact.assumptionRefs.length === 0) {
        errors.push({ code: 'provenance.missing-source-or-assumption', path: basePath, message: `known fact "${fact.id}" has neither sourceRefs nor assumptionRefs`, refs: [fact.id] });
      }
    });
    return errors;
  }

  // ── Integrity validation ────────────────────────────────────────────────────
  private validateIntegrity(bundle: ScenarioBundle): Diagnostic[] {
    const errors: Diagnostic[] = [];
    bundle.manifest.assets.forEach((asset, i) => {
      if (asset.required && !asset.contentAddress) {
        errors.push({ code: 'integrity.missing-required-asset', path: `/manifest/assets/${i}`, message: `required asset "${asset.id}" lacks a contentAddress`, refs: [asset.id] });
      }
    });

    bundle.scenario.macroRegions.forEach((macro, i) => {
      const seen = new Set<string>();
      macro.members.forEach((regionId, j) => {
        if (seen.has(regionId)) {
          errors.push({ code: 'integrity.duplicate-macro-member', path: `/scenario/macroRegions/${i}/members/${j}`, message: `duplicate region "${regionId}" in macro-region "${macro.id}"`, refs: [regionId, macro.id] });
        }
        seen.add(regionId);
      });
    });

    // One source region may not belong to two macro-regions with the same purpose.
    const byPurpose = new Map<string, Map<string, string>>();
    bundle.scenario.macroRegions.forEach((macro) => {
      const base = byPurpose.get(macro.purpose) ?? new Map<string, string>();
      macro.members.forEach((regionId) => {
        const prior = base.get(regionId);
        if (prior && prior !== macro.id) {
          errors.push({
            code: 'integrity.macro-member-overlap',
            path: '/scenario/macroRegions',
            message: `region "${regionId}" belongs to both "${prior}" and "${macro.id}" (purpose "${macro.purpose}")`,
            refs: [regionId, prior, macro.id],
          });
        }
        base.set(regionId, macro.id);
      });
      byPurpose.set(macro.purpose, base);
    });

    return errors;
  }

  private checkClaim(claim: InferredClaim, index: number, baseBundle: ScenarioBundle): Diagnostic[] {
    const errors: Diagnostic[] = [];
    const { subjectRef, predicate, operator, value } = claim.assertion;

    const protectedFacts = baseBundle.scenario.historicalFacts.filter(
      (f) => f.role === 'starting-value' && f.subjectRefs.includes(subjectRef) && f.predicate === predicate,
    );

    for (const fact of protectedFacts) {
      const outcome = compareAssertionToFact(value, operator, fact);
      if (outcome === 'contradiction') {
        errors.push({ code: 'integrity.claim-contradiction', path: `/inferredClaims/${index}/assertion`, message: `claim "${claim.id}" contradicts protected starting-value fact "${fact.id}"`, refs: [claim.id, fact.id] });
        break;
      }
      if (outcome === 'unsupported') {
        errors.push({ code: 'integrity.unsupported-comparison', path: `/inferredClaims/${index}/assertion`, message: `claim "${claim.id}" uses an unsupported comparison against fact "${fact.id}"`, refs: [claim.id, fact.id] });
        break;
      }
    }

    return errors;
  }

  // ── ID lookups ──────────────────────────────────────────────────────────────
  private knownPolities(bundle: ScenarioBundle): Set<string> {
    return new Set(Object.keys(bundle.scenario.polities));
  }
  private knownRegions(bundle: ScenarioBundle): Set<string> {
    return new Set(bundle.scenario.regions.map((r) => r.id));
  }
  private knownSources(bundle: ScenarioBundle): Set<string> {
    return new Set(bundle.sources.map((s) => s.id));
  }
  private knownFacts(bundle: ScenarioBundle): Set<string> {
    return new Set(bundle.scenario.historicalFacts.map((f) => f.id));
  }
  private knownAssumptions(bundle: ScenarioBundle): Set<string> {
    return new Set(bundle.scenario.assumptions.map((a) => a.id));
  }
  private knownMacroRegions(bundle: ScenarioBundle): Set<string> {
    return new Set(bundle.scenario.macroRegions.map((m) => m.id));
  }
  private knownAssets(bundle: ScenarioBundle): Set<string> {
    return new Set(bundle.manifest.assets.map((a) => a.id));
  }

  private isKnownEntity(bundle: ScenarioBundle, id: string): boolean {
    if (id.startsWith('polity:')) return this.knownPolities(bundle).has(id);
    if (id.startsWith('region:')) return this.knownRegions(bundle).has(id);
    if (id.startsWith('macro-region:')) return this.knownMacroRegions(bundle).has(id);
    return false;
  }
}

type ComparisonOutcome = 'consistent' | 'contradiction' | 'unsupported' | 'unknown-evidence';

export function compareAssertionToFact(value: AssertionValue, operator: string, fact: HistoricalFact): ComparisonOutcome {
  const factValue = fact.value;
  if (factValue.kind === 'unknown') return 'unknown-evidence';
  if (value.kind !== factValue.kind) return 'unsupported';

  switch (value.kind) {
    case 'quantity': {
      if (factValue.kind !== 'quantity') return 'unsupported';
      if (value.unit !== factValue.unit) return 'unsupported';
      const cmp = compareDecimal(value.amount, factValue.amount);
      switch (operator) {
        case 'equals': return cmp === 0 ? 'consistent' : 'contradiction';
        case 'not-equals': return cmp !== 0 ? 'consistent' : 'contradiction';
        case 'less-than': return cmp < 0 ? 'contradiction' : 'consistent';
        case 'less-or-equal': return cmp <= 0 ? 'contradiction' : 'consistent';
        case 'greater-than': return cmp > 0 ? 'contradiction' : 'consistent';
        case 'greater-or-equal': return cmp >= 0 ? 'contradiction' : 'consistent';
        default: return 'unsupported';
      }
    }
    case 'text': {
      if (factValue.kind !== 'text') return 'unsupported';
      const equal = factValue.value === value.value;
      const contains = factValue.value.includes(value.value);
      switch (operator) {
        case 'equals': return equal ? 'consistent' : 'contradiction';
        case 'not-equals': return !equal ? 'consistent' : 'contradiction';
        case 'contains': return contains ? 'consistent' : 'contradiction';
        default: return 'unsupported';
      }
    }
    case 'boolean': {
      if (factValue.kind !== 'boolean') return 'unsupported';
      const equal = factValue.value === value.value;
      switch (operator) {
        case 'equals': return equal ? 'consistent' : 'contradiction';
        case 'not-equals': return !equal ? 'consistent' : 'contradiction';
        default: return 'unsupported';
      }
    }
    case 'entity-ref': {
      if (factValue.kind !== 'entity-ref') return 'unsupported';
      const equal = factValue.value === value.value;
      switch (operator) {
        case 'equals': return equal ? 'consistent' : 'contradiction';
        case 'not-equals': return !equal ? 'consistent' : 'contradiction';
        default: return 'unsupported';
      }
    }
    default:
      return 'unsupported';
  }
}

interface ParsedDecimal {
  negative: boolean;
  int: string;
  frac: string;
}

function parseDecimal(input: string): ParsedDecimal {
  const negative = input.startsWith('-');
  const body = negative ? input.slice(1) : input;
  const dot = body.indexOf('.');
  const intRaw = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? '' : body.slice(dot + 1).replace(/0+$/, '');
  const int = intRaw.replace(/^0+(?=\d)/, '') || '0';
  return { negative, int, frac };
}

function compareDecimal(a: string, b: string): number {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const paZero = pa.int === '0' && pa.frac === '';
  const pbZero = pb.int === '0' && pb.frac === '';
  if (paZero && pbZero) return 0;
  if (pa.negative !== pb.negative) return pa.negative ? -1 : 1;
  const mag = compareMagnitude(pa, pb);
  return pa.negative ? -mag : mag;
}

function compareMagnitude(a: ParsedDecimal, b: ParsedDecimal): number {
  if (a.int.length !== b.int.length) return a.int.length < b.int.length ? -1 : 1;
  if (a.int !== b.int) return a.int < b.int ? -1 : 1;
  const len = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(len, '0');
  const fb = b.frac.padEnd(len, '0');
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}

export type { HistoricalFact, SourceRef, Assumption };
export type { ScenarioV2Manifest, ScenarioV2, PregameNarrativeDraft, DraftScenarioPatch, InferredClaim, AssertionValue };