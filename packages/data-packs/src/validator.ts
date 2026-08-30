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

function sortDiagnostics(errors: Diagnostic[]): Diagnostic[] {
  return [...errors].sort((a, b) =>
    a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

function duplicateDiagnostics(
  values: readonly string[],
  path: string,
  code: string,
): Diagnostic[] {
  const seen = new Set<string>();
  const errors: Diagnostic[] = [];
  values.forEach((value, index) => {
    if (seen.has(value)) {
      errors.push(refError(code, `${path}/${index}`, `duplicate ID "${value}"`, [value]));
    }
    seen.add(value);
  });
  return errors;
}

function isProtectedScenarioPath(path: string): boolean {
  if (isProtectedPath(path)) return true;
  return [
    /^\/manifest\/(?:schemaVersion|id|contentVersion)(?:\/|$)/,
    /^\/scenario\/(?:id|schemaVersion)(?:\/|$)/,
    /^\/scenario\/game\/startDate(?:\/|$)/,
    /^\/scenario\/polities\/[^/]+\/id(?:\/|$)/,
    /^\/scenario\/regions\/[^/]+\/(?:id|datasetVersion|nativeId)(?:\/|$)/,
    /^\/scenario\/regionAssignments\/[^/]+(?:\/|$)/,
    /^\/scenario\/simulationRules(?:\/|$)/,
    /^\/scenario\/(?:historicalFacts|assumptions)\/[^/]+(?:\/|$)/,
    /^\/scenario\/macroRegions\/[^/]+\/members(?:\/|$)/,
    /^\/sources\/[^/]+(?:\/|$)/,
  ].some((pattern) => pattern.test(path));
}

function isJsonPointer(value: string): boolean {
  return /^(?:\/(?:[^~/]|~0|~1)*)+$/.test(value);
}

export class ScenarioV2Validator {
  validateBundle(input: unknown): { valid: boolean; bundle?: ScenarioBundle; errors: Diagnostic[] } {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: [{ code: 'schema.invalid-type', path: '', message: 'Bundle must be an object' }] };
    }

    const raw = input as { manifest?: unknown; scenario?: unknown; sources?: unknown };
    const rootKeys = Object.keys(raw);
    const rootErrors: Diagnostic[] = [];
    for (const key of rootKeys) {
      if (!['manifest', 'scenario', 'sources'].includes(key)) {
        rootErrors.push({ code: 'schema.unrecognized_keys', path: `/${key}`, message: `Unrecognized bundle key "${key}"` });
      }
    }
    for (const key of ['manifest', 'scenario', 'sources'] as const) {
      if (!(key in raw)) {
        rootErrors.push({ code: 'schema.missing-document', path: `/${key}`, message: `Missing required ${key} document` });
      }
    }

    const manifestParsed = scenarioManifestSchema.safeParse(raw.manifest);
    const scenarioParsed = scenarioV2Schema.safeParse(raw.scenario);
    const sourcesParsed = sourceRefSchema.array().safeParse(raw.sources);

    const errors: Diagnostic[] = [...rootErrors];
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
      return { valid: false, errors: sortDiagnostics(errors) };
    }

    const bundle: ScenarioBundle = {
      manifest: manifestParsed.data,
      scenario: scenarioParsed.data,
      sources: sourcesParsed.data,
    };

    errors.push(...this.validateReferences(bundle));
    errors.push(...this.validateProvenance(bundle));
    errors.push(...this.validateIntegrity(bundle));

    const sorted = sortDiagnostics(errors);
    return sorted.length === 0 ? { valid: true, bundle, errors: [] } : { valid: false, bundle, errors: sorted };
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

    errors.push(...duplicateDiagnostics(draft.factsUsed, '/factsUsed', 'integrity.duplicate-facts-used'));
    errors.push(...duplicateDiagnostics(draft.inferredClaims.map((claim) => claim.id), '/inferredClaims', 'integrity.duplicate-claim'));

    const knownClaims = new Set(draft.inferredClaims.map((claim) => claim.id));

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
      seg.factRefs.forEach((factId, factIndex) => {
        if (!knownFacts.has(factId)) {
          errors.push(refError('reference.unknown-fact', `/segments/${i}/factRefs/${factIndex}`, `unknown fact "${factId}"`, [factId]));
        }
      });
      seg.claimRefs.forEach((claimId, claimIndex) => {
        if (!knownClaims.has(claimId)) {
          errors.push(refError('reference.unknown-claim', `/segments/${i}/claimRefs/${claimIndex}`, `unknown claim "${claimId}"`, [claimId]));
        }
      });
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
      claim.evidenceRefs.forEach((factId, evidenceIndex) => {
        if (!knownFacts.has(factId)) {
          errors.push(refError('reference.unknown-fact', `/inferredClaims/${i}/evidenceRefs/${evidenceIndex}`, `unknown fact "${factId}"`, [factId]));
        }
      });
      const assumptionEvidence = baseBundle.scenario.historicalFacts.some((fact) =>
        claim.evidenceRefs.includes(fact.id) && (fact.confidence === 'assumption' || fact.assumptionRefs.length > 0));
      if (assumptionEvidence && claim.confidence !== 'low') {
        errors.push({ code: 'integrity.assumption-confidence-too-high', path: `/inferredClaims/${i}/confidence`, message: `claim "${claim.id}" cites assumption-backed evidence and must have low confidence`, refs: [claim.id] });
      }
      errors.push(...this.checkClaim(claim, i, baseBundle));
    });

    const sorted = sortDiagnostics(errors);
    return sorted.length === 0 ? { valid: true, draft, errors: [] } : { valid: false, draft, errors: sorted };
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

    const scenarioSlug = baseBundle.manifest.id.replace(/^scenario:/, '');
    if (!patch.id.startsWith(`draft-patch:${scenarioSlug}:`)) {
      errors.push(refError('reference.wrong-scenario', '/id', `draft patch "${patch.id}" is not scenario-qualified under ${baseBundle.manifest.id}`, [patch.id]));
    }

    patch.operations.forEach((op, i) => {
      if (isProtectedScenarioPath(op.path)) {
        errors.push({
          code: 'integrity.protected-path-mutation',
          path: `/operations/${i}/path`,
          message: `patch operation targets protected path "${op.path}"`,
          refs: [op.path],
        });
      }
      if (op.op === 'remove' && op.value !== undefined) {
        errors.push({ code: 'integrity.remove-has-value', path: `/operations/${i}/value`, message: 'remove operation cannot carry value' });
      }
      if (op.op !== 'remove' && op.value === undefined) {
        errors.push({ code: 'integrity.mutation-missing-value', path: `/operations/${i}/value`, message: `${op.op} operation requires value` });
      }
      op.sourceRefs.forEach((sourceId, sourceIndex) => {
        if (!this.knownSources(baseBundle).has(sourceId)) {
          errors.push(refError('reference.unknown-source', `/operations/${i}/sourceRefs/${sourceIndex}`, `unknown source "${sourceId}"`, [sourceId]));
        }
      });
      op.assumptionRefs.forEach((assumptionId, assumptionIndex) => {
        if (!this.knownAssumptions(baseBundle).has(assumptionId)) {
          errors.push(refError('reference.unknown-assumption', `/operations/${i}/assumptionRefs/${assumptionIndex}`, `unknown assumption "${assumptionId}"`, [assumptionId]));
        }
      });
    });

    const sorted = sortDiagnostics(errors);
    return sorted.length === 0 ? { valid: true, patch, errors: [] } : { valid: false, patch, errors: sorted };
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

    errors.push(...duplicateDiagnostics(sources.map((source) => source.id), '/sources', 'reference.duplicate-source'));
    errors.push(...duplicateDiagnostics(scenario.historicalFacts.map((fact) => fact.id), '/scenario/historicalFacts', 'reference.duplicate-fact'));
    errors.push(...duplicateDiagnostics(scenario.assumptions.map((assumption) => assumption.id), '/scenario/assumptions', 'reference.duplicate-assumption'));
    errors.push(...duplicateDiagnostics(scenario.regions.map((region) => region.id), '/scenario/regions', 'reference.duplicate-region'));
    errors.push(...duplicateDiagnostics(scenario.macroRegions.map((macro) => macro.id), '/scenario/macroRegions', 'reference.duplicate-macro-region'));
    errors.push(...duplicateDiagnostics(manifest.assets.map((asset) => asset.id), '/manifest/assets', 'reference.duplicate-asset'));

    Object.entries(scenario.polities).forEach(([key, polity]) => {
      if (key !== polity.id) {
        errors.push(refError('reference.polity-key-mismatch', `/scenario/polities/${key}/id`, `polity record key "${key}" does not equal embedded id "${polity.id}"`, [key, polity.id]));
      }
    });

    scenario.regions.forEach((region, i) => {
      const datasetSlug = `${region.dataset}-${region.datasetVersion}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const expected = `region:${datasetSlug}:${region.nativeId}`;
      if (region.id !== expected) {
        errors.push(refError('reference.region-id-mismatch', `/scenario/regions/${i}/id`, `region id must be "${expected}" for its dataset, version and nativeId`, [region.id, expected]));
      }
    });

    sources.forEach((source, i) => {
      if (!source.id.startsWith(expectPrefix('source'))) {
        errors.push(refError('reference.wrong-scenario', `/sources/${i}/id`, `source "${source.id}" is not scenario-qualified under ${scenario.id}`, [source.id]));
      }
    });

    manifest.assets.forEach((asset, i) => {
      if (!asset.id.startsWith(expectPrefix('asset'))) {
        errors.push(refError('reference.wrong-scenario', `/manifest/assets/${i}/id`, `asset "${asset.id}" is not scenario-qualified under ${scenario.id}`, [asset.id]));
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
      fact.transformation.forEach((step, stepIndex) => {
        step.inputSourceRefs.forEach((sid, sourceIndex) => {
          if (!this.knownSources(bundle).has(sid)) {
            errors.push(refError('reference.unknown-source', `/scenario/historicalFacts/${i}/transformation/${stepIndex}/inputSourceRefs/${sourceIndex}`, `unknown source "${sid}"`, [sid]));
          }
        });
      });
      if (fact.value.kind === 'entity-ref' && !this.isKnownEntity(bundle, fact.value.value)) {
        errors.push(refError('reference.unknown-entity', `/scenario/historicalFacts/${i}/value/value`, `unknown entity reference "${fact.value.value}"`, [fact.value.value]));
      }
    });

    scenario.assumptions.forEach((assumption, i) => {
      if (!assumption.id.startsWith(expectPrefix('assumption'))) {
        errors.push(refError('reference.wrong-scenario', `/scenario/assumptions/${i}/id`, `assumption "${assumption.id}" is not scenario-qualified under ${scenario.id}`, [assumption.id]));
      }
      assumption.sourceRefs.forEach((sid, j) => {
        if (!this.knownSources(bundle).has(sid)) {
          errors.push(refError('reference.unknown-source', `/scenario/assumptions/${i}/sourceRefs/${j}`, `unknown source "${sid}"`, [sid]));
        }
      });
      assumption.affectedPaths.forEach((affectedPath, pathIndex) => {
        if (!isJsonPointer(affectedPath)) {
          errors.push({ code: 'schema.invalid-json-pointer', path: `/scenario/assumptions/${i}/affectedPaths/${pathIndex}`, message: `invalid JSON pointer "${affectedPath}"`, refs: [assumption.id] });
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

    scenario.cities?.forEach((city, i) => {
      if (!this.knownRegions(bundle).has(city.regionId)) {
        errors.push(refError('reference.unknown-region', `/scenario/cities/${i}/regionId`, `unknown region "${city.regionId}"`, [city.regionId]));
      }
    });

    scenario.simulationRules.activeConflicts?.forEach((conflict, i) => {
      conflict.participants.forEach((polityId, j) => {
        if (!this.knownPolities(bundle).has(polityId)) {
          errors.push(refError('reference.unknown-polity', `/scenario/simulationRules/activeConflicts/${i}/participants/${j}`, `unknown polity "${polityId}"`, [polityId]));
        }
      });
    });

    scenario.macroRegions.forEach((macro, i) => {
      if (!macro.id.startsWith(expectPrefix('macro-region'))) {
        errors.push(refError('reference.wrong-scenario', `/scenario/macroRegions/${i}/id`, `macro-region "${macro.id}" is not scenario-qualified under ${scenario.id}`, [macro.id]));
      }
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

    if (scenario.meta.locales && !(manifest.defaultLocale in scenario.meta.locales)) {
      errors.push(refError('reference.unknown-default-locale', '/manifest/defaultLocale', `default locale "${manifest.defaultLocale}" is absent from scenario.meta.locales`, [manifest.defaultLocale]));
    }

    return errors;
  }

  // ── Provenance validation ───────────────────────────────────────────────────
  private validateProvenance(bundle: ScenarioBundle): Diagnostic[] {
    const errors: Diagnostic[] = [];
    bundle.scenario.historicalFacts.forEach((fact, i) => {
      const basePath = `/scenario/historicalFacts/${i}`;
      const scenarioPath = `/historicalFacts/${i}`;

      if (fact.confidence === 'assumption') {
        if (fact.assumptionRefs.length === 0) {
          errors.push({ code: 'provenance.assumption-confidence-missing-ref', path: basePath, message: `fact "${fact.id}" has confidence "assumption" but no assumptionRefs`, refs: [fact.id] });
        }
        if (!fact.transformation.some((step) => step.operation === 'scenario-choice')) {
          errors.push({ code: 'provenance.assumption-missing-scenario-choice', path: `${basePath}/transformation`, message: `fact "${fact.id}" with confidence "assumption" must carry a "scenario-choice" transformation`, refs: [fact.id] });
        }
        for (const assumptionId of fact.assumptionRefs) {
          const assumption = bundle.scenario.assumptions.find((candidate) => candidate.id === assumptionId);
          if (assumption && !assumption.affectedPaths.some((path) => path === scenarioPath || path.startsWith(`${scenarioPath}/`))) {
            errors.push({ code: 'provenance.assumption-path-mismatch', path: `${basePath}/assumptionRefs`, message: `assumption "${assumptionId}" does not cover fact path "${scenarioPath}"`, refs: [fact.id, assumptionId] });
          }
          const hasGap = bundle.scenario.fidelity.gaps.some((gap) =>
            gap.assumptionRef === assumptionId && (gap.path === scenarioPath || gap.path.startsWith(`${scenarioPath}/`)));
          if (assumption && !hasGap) {
            errors.push({ code: 'provenance.assumption-gap-missing', path: `${basePath}/assumptionRefs`, message: `assumption-backed fact "${fact.id}" has no linked fidelity gap`, refs: [fact.id, assumptionId] });
          }
        }
      }

      if (fact.value.kind !== 'unknown' && fact.sourceRefs.length === 0 && fact.assumptionRefs.length === 0) {
        errors.push({ code: 'provenance.missing-source-or-assumption', path: basePath, message: `known fact "${fact.id}" has neither sourceRefs nor assumptionRefs`, refs: [fact.id] });
      }

      if (fact.value.kind === 'unknown') {
        const valuePath = `${scenarioPath}/value`;
        const hasGap = bundle.scenario.fidelity.gaps.some((gap) => gap.disposition === 'unknown' && gap.path === valuePath);
        if (!hasGap) {
          errors.push({ code: 'provenance.unknown-gap-missing', path: `${basePath}/value`, message: `unknown fact "${fact.id}" requires a matching fidelity gap at "${valuePath}"`, refs: [fact.id] });
        }
      }
    });

    bundle.scenario.fidelity.gaps.forEach((gap, i) => {
      if (gap.disposition === 'assumption' && !gap.assumptionRef) {
        errors.push({ code: 'provenance.gap-assumption-missing-ref', path: `/scenario/fidelity/gaps/${i}/assumptionRef`, message: 'assumption gap requires assumptionRef' });
      }
      if (gap.disposition !== 'assumption' && gap.assumptionRef) {
        errors.push({ code: 'provenance.gap-unexpected-assumption-ref', path: `/scenario/fidelity/gaps/${i}/assumptionRef`, message: `${gap.disposition} gap cannot carry assumptionRef`, refs: [gap.assumptionRef] });
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
      if (!asset.path && !asset.contentAddress) {
        errors.push({ code: 'integrity.unresolved-asset-reference', path: `/manifest/assets/${i}`, message: `asset "${asset.id}" requires a path or contentAddress`, refs: [asset.id] });
      }
    });

    if (bundle.scenario.fidelity.intendedUse === 'playable-scenario') {
      Object.keys(bundle.scenario.polities).forEach((polityId) => {
        if (!Object.prototype.hasOwnProperty.call(bundle.scenario.fidelity.polityLevels, polityId)) {
          errors.push(refError('integrity.playable-polity-missing-baseline', `/scenario/fidelity/polityLevels/${polityId}`, `playable polity "${polityId}" has no fidelity level`, [polityId]));
        }
      });
    }

    const startingFacts = bundle.scenario.historicalFacts.filter((fact) => fact.role === 'starting-value');
    for (let leftIndex = 0; leftIndex < startingFacts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < startingFacts.length; rightIndex += 1) {
        const left = startingFacts[leftIndex];
        const right = startingFacts[rightIndex];
        const sameSubject = left.subjectRefs.some((subject) => right.subjectRefs.includes(subject));
        const comparable = left.predicate === right.predicate && comparableFactValues(left, right);
        if (sameSubject && comparable && rangesOverlap(left.effectiveRange, right.effectiveRange)) {
          errors.push(refError('integrity.multiple-starting-values', '/scenario/historicalFacts', `starting values "${left.id}" and "${right.id}" overlap for the same subject and predicate`, [left.id, right.id]));
        }
      }
    }

    bundle.scenario.macroRegions.forEach((macro, i) => {
      const seen = new Set<string>();
      macro.members.forEach((regionId, j) => {
        if (seen.has(regionId)) {
          errors.push({ code: 'integrity.duplicate-macro-member', path: `/scenario/macroRegions/${i}/members/${j}`, message: `duplicate region "${regionId}" in macro-region "${macro.id}"`, refs: [regionId, macro.id] });
        }
        seen.add(regionId);
      });
    });

    // One source region may not belong to two macro-regions with the same purpose
    // unless an authored assumption explicitly covers both membership paths.
    const byPurpose = new Map<string, Map<string, string>>();
    bundle.scenario.macroRegions.forEach((macro) => {
      const base = byPurpose.get(macro.purpose) ?? new Map<string, string>();
      macro.members.forEach((regionId) => {
        const prior = base.get(regionId);
        if (prior && prior !== macro.id) {
          const priorIndex = bundle.scenario.macroRegions.findIndex((candidate) => candidate.id === prior);
          const currentIndex = bundle.scenario.macroRegions.findIndex((candidate) => candidate.id === macro.id);
          const expectedPaths = [`/macroRegions/${priorIndex}/members`, `/macroRegions/${currentIndex}/members`];
          const declared = bundle.scenario.assumptions.some((assumption) =>
            expectedPaths.every((path) => assumption.affectedPaths.some((affected) => affected === path || affected.startsWith(`${path}/`))));
          if (!declared) {
            errors.push({
              code: 'integrity.macro-member-overlap',
              path: '/scenario/macroRegions',
              message: `region "${regionId}" belongs to both "${prior}" and "${macro.id}" (purpose "${macro.purpose}") without an overlap assumption`,
              refs: [regionId, prior, macro.id],
            });
          }
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

    if (!this.isKnownEntity(baseBundle, subjectRef)) {
      errors.push(refError('reference.unknown-entity', `/inferredClaims/${index}/assertion/subjectRef`, `unknown entity reference "${subjectRef}"`, [subjectRef]));
    }

    const evidence = baseBundle.scenario.historicalFacts.filter((fact) => claim.evidenceRefs.includes(fact.id));
    for (const fact of evidence) {
      if (!fact.subjectRefs.includes(subjectRef) || fact.predicate !== predicate) {
        errors.push({ code: 'integrity.incomparable-evidence', path: `/inferredClaims/${index}/evidenceRefs`, message: `evidence fact "${fact.id}" does not match assertion subject and predicate`, refs: [claim.id, fact.id] });
        continue;
      }
      const outcome = compareAssertionToFact(value, operator, fact);
      if (outcome === 'unknown-evidence') {
        errors.push({ code: 'integrity.unknown-evidence', path: `/inferredClaims/${index}/evidenceRefs`, message: `unknown fact "${fact.id}" cannot prove assertion "${claim.id}"`, refs: [claim.id, fact.id] });
      } else if (outcome === 'unsupported') {
        errors.push({ code: 'integrity.unsupported-comparison', path: `/inferredClaims/${index}/assertion`, message: `claim "${claim.id}" is not comparable with evidence fact "${fact.id}"`, refs: [claim.id, fact.id] });
      } else if (outcome === 'contradiction') {
        errors.push({ code: 'integrity.claim-evidence-contradiction', path: `/inferredClaims/${index}/assertion`, message: `claim "${claim.id}" contradicts evidence fact "${fact.id}"`, refs: [claim.id, fact.id] });
      }
    }

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

function rangesOverlap(
  left: { from: string; until?: string },
  right: { from: string; until?: string },
): boolean {
  const leftUntil = left.until ?? '9999-12-31';
  const rightUntil = right.until ?? '9999-12-31';
  return left.from <= rightUntil && right.from <= leftUntil;
}

function comparableFactValues(left: HistoricalFact, right: HistoricalFact): boolean {
  if (left.value.kind !== right.value.kind) return false;
  if (left.value.kind === 'quantity' && right.value.kind === 'quantity') {
    return left.value.unit === right.value.unit && (left.value.scope ?? '') === (right.value.scope ?? '');
  }
  return true;
}

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
        case 'less-than': return cmp > 0 ? 'consistent' : 'contradiction';
        case 'less-or-equal': return cmp >= 0 ? 'consistent' : 'contradiction';
        case 'greater-than': return cmp < 0 ? 'consistent' : 'contradiction';
        case 'greater-or-equal': return cmp <= 0 ? 'consistent' : 'contradiction';
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
