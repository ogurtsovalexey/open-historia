import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initState, parseScenario, runTurn, stateChecksum } from '../packages/engine/dist/index.js';
import {
  buildStrategicBatchesV3, expandStrategicAffordancesV3, materializeStrategicBatchV3, strategicDecisionBatchV2Schema,
} from '../packages/agent-runtime/dist/index.js';
import {
  assessCodexDecisionReferences, buildCodexDecisionResponseSchema, normalizeCodexDecisionWire,
} from './lib/campaign-lab-contract.mjs';
import { CODEX_PROMPT_CONTRACT, CODEX_SUBSCRIPTION_MODEL, codexCliVersion, invokeCodexSubscription } from './lib/codex-subscription.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = process.env.CAMPAIGN_LAB_RUNS_DIR ? path.resolve(process.env.CAMPAIGN_LAB_RUNS_DIR) : path.join(ROOT, 'runs/campaign-lab');
const SCENARIO = path.join(ROOT, 'packages/data-packs/fixtures/europe-1935-benchmark/engine/scenario.json');
const EXTERNAL_SUPPLIERS = Object.freeze(['polity:soviet-union', 'polity:united-states']);
const SYSTEM_TEXT = `Return one independent decision per required polity ID. Each listed StrategicBriefV3 choice is executable at the frozen state: use exact listed combinations and public IDs only; omitted tools are unavailable. Invent no IDs, facts, doctrine, hidden/private information, numeric effects or outcomes. Previews are immutable evidence; plans are future intentions. Non-holds need a material choice, else conserve with a typed hold.
Every unused action field is "". Fields by tool: invest=targetRegionId+scale; reallocate-production=targetRegionId+priority+scale; conserve=none; negotiate-trade/external-import=partner+resource+desiredRunway+budgetAttitude; propose-agreement=partner+agreementType; apply-diplomatic-pressure=partner+optional targetRegionId+demand+pressure; respond-proposal=proposalId+response; change-policy=taxStance+budgetPriority; respond-faction=factionId+response; start-project=templateId+scale+optional targetRegionId/targetPolityId; mobilize=targetRegionId+scale+commanderId; declare-war=defender+reason; issue-order=formationId+posture+optional targetRegionId; negotiate-peace=warId+approach.`;
const APPLICATION_PREFIX = '\n\nAPPLICATION PAYLOAD:\n';
const MEASURED_SYSTEM_TEXT = `${SYSTEM_TEXT}${APPLICATION_PREFIX}`;

const parseArgs = (values) => Object.fromEntries(values.reduce((rows, value, index) => {
  if (index % 2 === 0) {
    if (!value.startsWith('--') || values[index + 1] === undefined) throw new Error(`invalid argument ${value}`);
    rows.push([value.slice(2), values[index + 1]]);
  }
  return rows;
}, []));
const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const atomicJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); fs.renameSync(temp, file);
};
const gitRevision = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const assertFrozen = () => {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (status) throw new Error('renewed Luna evaluation requires a clean checkpoint worktree');
};
const initial = () => initState(parseScenario(JSON.parse(fs.readFileSync(SCENARIO, 'utf8'))));
const commandBase = (state, actorPolityId, suffix) => ({ commandId: `93000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
  actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month });
const contextFor = (ids) => Object.fromEntries(ids.map((id) => [id, { interests: ['preserve sovereignty and productive capacity'],
  threats: ['resource exhaustion and coercion'], obligations: ['honour active canonical obligations'], redLines: ['do not rely on invented outcomes'],
  causalAnchors: [{ anchorId: `anchor:${id.slice(7)}`, interest: 'preserve strategic capacity', applicability: ['current canonical state'], invalidators: ['material state change'] }],
  memory: ['The cabinet reviews executable choices at each material checkpoint.'] }]));

const makeProbe = (id, state, playerPolityId, requestedPolityIds, options = {}) => {
  const batches = buildStrategicBatchesV3(state, playerPolityId, { systemText: MEASURED_SYSTEM_TEXT, requestedPolityIds,
    strategicContextByPolity: contextFor(requestedPolityIds), externalSupplierPolityIds: EXTERNAL_SUPPLIERS, ...options });
  if (batches.length !== 1) throw new Error(`${id} must fit one application call; produced ${batches.length} batches`);
  return { id, state, batch: batches[0], focalPolityId: options.focalPolityId ?? requestedPolityIds[0] };
};

const buildProbes = () => {
  const base = initial();
  const initialIds = ['polity:austria', 'polity:czechoslovakia', 'polity:france', 'polity:italy', 'polity:poland', 'polity:united-kingdom'];
  const probe1 = makeProbe('initial-six-opponents', base, 'polity:germany', initialIds, { maxMaterialToolAffordances: 1, focalPolityId: 'polity:austria' });

  let ukState = base;
  for (let index = 0; index < 18; index += 1) {
    const brief = buildStrategicBatchesV3(ukState, 'polity:germany', { requestedPolityIds: ['polity:united-kingdom'], systemText: MEASURED_SYSTEM_TEXT,
      requestedTools: ['reallocate-production', 'negotiate-trade', 'external-import'], maxMaterialToolAffordances: 3,
      externalSupplierPolityIds: EXTERNAL_SUPPLIERS })[0]?.briefs[0];
    const iron = brief?.economy.resources.find((entry) => entry.resource === 'iron');
    if (iron?.runwayMonths !== null && iron.runwayMonths <= 3) break;
    ukState = runTurn(ukState, { commands: [] }).result.state;
  }
  const probe2 = makeProbe('uk-iron-exhaustion', ukState, 'polity:germany', ['polity:united-kingdom'], {
    requestedTools: ['reallocate-production', 'negotiate-trade', 'external-import'], maxMaterialToolAffordances: 3,
    focalPolityId: 'polity:united-kingdom',
  });

  const germanRegion = base.regions.find((entry) => entry.controllerId === 'polity:germany');
  if (!germanRegion) throw new Error('benchmark has no German region for proposal probe');
  const proposalTurn = runTurn(base, { commands: [{ kind: 'diplomacy.propose', ...commandBase(base, 'polity:germany', 1),
    proposalId: 'proposal:luna-territorial-probe', recipientPolityId: 'polity:czechoslovakia',
    terms: { kind: 'territorial-settlement', fromPolityId: 'polity:germany', toPolityId: 'polity:czechoslovakia', regionIds: [germanRegion.regionId] } }] }).result;
  if (proposalTurn.rejections.length) throw new Error(`proposal probe setup rejected: ${proposalTurn.rejections[0].detail}`);
  const probe3 = makeProbe('czechoslovakia-territorial-proposal', proposalTurn.state, 'polity:germany', ['polity:czechoslovakia'], {
    requestedTools: ['respond-proposal', 'propose-agreement', 'apply-diplomatic-pressure'], maxMaterialToolAffordances: 3,
    focalPolityId: 'polity:czechoslovakia',
  });

  const warTurn = runTurn(base, { commands: [{ kind: 'war.declare', ...commandBase(base, 'polity:germany', 2),
    warId: 'war:luna-germany-poland', defenderPolityId: 'polity:poland', reason: 'rivalry' }] }).result;
  if (warTurn.rejections.length) throw new Error(`war probe setup rejected: ${warTurn.rejections[0].detail}`);
  const probe4 = makeProbe('poland-active-german-war', warTurn.state, 'polity:germany', ['polity:poland'], {
    requestedTools: ['mobilize', 'issue-order', 'reallocate-production', 'negotiate-trade', 'propose-agreement', 'negotiate-peace'],
    maxMaterialToolAffordances: 6, focalPolityId: 'polity:poland',
  });
  return [probe1, probe2, probe3, probe4];
};

const promptFor = (probe) => `${MEASURED_SYSTEM_TEXT}${JSON.stringify({ requiredPolityIds: probe.batch.polityIds, briefs: probe.batch.briefs })}`;
const mockBatch = (probe) => ({ decisions: probe.batch.briefs.map((brief) => {
  const action = expandStrategicAffordancesV3(brief).find((entry) => entry.tool !== 'conserve');
  return action ? { polityId: brief.polity.id, objective: { domain: 'campaign', summary: 'Use the highest-ranked executable response.', horizon: 'short' },
    actions: [action], futurePlan: [{ summary: 'Reassess after engine resolution.', condition: 'Canonical state changes.' }],
    contingency: 'Use another published affordance if conditions change.', rationale: 'The selected action has an engine dry-run preview.', hold: null }
    : { polityId: brief.polity.id, objective: { domain: 'campaign', summary: 'Preserve flexibility.', horizon: 'short' }, actions: [{ tool: 'conserve' }],
      futurePlan: [], contingency: 'Reassess after new evidence.', rationale: 'No material affordance is published.',
      hold: { reason: 'no-legal-action', detail: 'Only conserve is available.', revisit: { afterMonths: 1, triggers: ['resource-deficit'] } } };
}) });

let activeManifest = null;
let activeManifestPath = null;
const main = () => {
  const args = parseArgs(process.argv.slice(2)); const mode = args.mode ?? 'live';
  if (!['live', 'mock'].includes(mode)) throw new Error('mode must be live or mock');
  if (mode === 'live') assertFrozen();
  const revision = gitRevision(); const cliVersion = codexCliVersion();
  const runId = args.run ?? `luna-gate0-${revision.slice(0, 12)}`; const outputDir = path.join(RUNS, runId);
  if (fs.existsSync(outputDir)) throw new Error(`evaluation output already exists: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const probes = buildProbes();
  const schemas = Object.fromEntries(probes.map((probe) => [probe.id, buildCodexDecisionResponseSchema(probe.batch.polityIds)]));
  const manifest = { schemaVersion: 'open-historia-luna-capability/1', runId, mode, model: CODEX_SUBSCRIPTION_MODEL,
    authMode: 'chatgpt', reasoning: 'low', verbosity: 'low', fastMode: false, ephemeral: true, codeRevision: revision,
    cliVersion, promptContract: CODEX_PROMPT_CONTRACT, externalSupplierPolityIds: EXTERNAL_SUPPLIERS,
    externalSupplierProfileChecksum: sha256(JSON.stringify(EXTERNAL_SUPPLIERS)),
    outputSchemaChecksum: sha256(JSON.stringify(schemas)), completedCodexTurns: 0, status: 'running', probes: [] };
  activeManifest = manifest; activeManifestPath = path.join(outputDir, 'manifest.json');
  atomicJson(activeManifestPath, manifest);
  for (const [index, probe] of probes.entries()) {
    const prompt = promptFor(probe);
    if (prompt.length >= 40000 || probe.batch.characterCount !== prompt.length) throw new Error(`${probe.id} prompt is ${prompt.length}, batch measured ${probe.batch.characterCount}`);
    const probeDir = path.join(outputDir, `${index + 1}-${probe.id}`); fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(path.join(probeDir, 'prompt.txt'), prompt, 'utf8');
    atomicJson(path.join(probeDir, 'brief-batch.json'), probe.batch); atomicJson(path.join(probeDir, 'state.json'), probe.state);
    const beforeChecksum = stateChecksum(probe.state);
    const schema = schemas[probe.id];
    atomicJson(path.join(probeDir, 'output-schema.json'), schema);
    const invocation = mode === 'mock' ? null : invokeCodexSubscription({ prompt, schema });
    if (invocation) {
      fs.writeFileSync(path.join(probeDir, 'events.jsonl'), invocation.stdout, 'utf8');
      fs.writeFileSync(path.join(probeDir, 'response.json'), invocation.responseText ?? '', 'utf8');
      atomicJson(path.join(probeDir, 'transport.json'), { status: invocation.status, transportAttempt: invocation.transportAttempt,
        latencyMs: invocation.latencyMs, threadIds: invocation.threadIds, usage: invocation.usage, stderr: invocation.stderr ?? '' });
      if (invocation.completed) manifest.completedCodexTurns += 1;
      if (invocation.status !== 'success') {
        manifest.status = invocation.status; manifest.probes.push({ probeId: probe.id, status: invocation.status });
        atomicJson(path.join(outputDir, 'manifest.json'), manifest); process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`); return;
      }
    }
    let normalized; let normalizationError = null;
    try { normalized = mode === 'mock' ? mockBatch(probe) : normalizeCodexDecisionWire(invocation.response); }
    catch (error) { normalizationError = error instanceof Error ? error.message : String(error); normalized = { decisions: [] }; }
    const strict = normalizationError ? { success: false, error: { issues: [{ message: normalizationError }] } }
      : strategicDecisionBatchV2Schema.safeParse(normalized);
    const materialized = strict.success ? materializeStrategicBatchV3(probe.state, strict.data, probe.batch)
      : { commands: [], rejected: [{ actionIndex: -1, reason: strict.error.issues[0]?.message ?? 'schema rejection' }], unsupportedResidual: [] };
    const afterChecksum = stateChecksum(probe.state); const refs = assessCodexDecisionReferences(invocation?.response ?? normalized, prompt);
    const focal = strict.success ? strict.data.decisions.find((entry) => entry.polityId === probe.focalPolityId) : null;
    const result = { probeId: probe.id, promptCharacters: prompt.length, requestedPolityIds: probe.batch.polityIds,
      strictValid: strict.success, normalizedDecision: normalized, materialized, focalPolityId: probe.focalPolityId,
      focalMaterial: Boolean(focal && focal.hold === null && focal.actions.some((entry) => entry.tool !== 'conserve')),
      stateChecksumBefore: beforeChecksum, stateChecksumAfter: afterChecksum, stateMutated: beforeChecksum !== afterChecksum, ...refs };
    atomicJson(path.join(probeDir, 'validation.json'), result);
    manifest.probes.push({ probeId: probe.id, status: strict.success && materialized.rejected.length === 0 ? 'valid' : 'invalid',
      promptCharacters: prompt.length, focalMaterial: result.focalMaterial, rejected: materialized.rejected.length,
      threadIds: invocation?.threadIds ?? [], usage: invocation?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
    atomicJson(path.join(outputDir, 'manifest.json'), manifest);
    if (mode === 'live' && (!strict.success || materialized.rejected.length || !result.focalMaterial || refs.inventedReferences.length
      || refs.privateDoctrine || refs.authoritativeNumericClaims.length || result.stateMutated)) {
      manifest.status = 'failed'; atomicJson(path.join(outputDir, 'manifest.json'), manifest); process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`); return;
    }
  }
  const threadIds = [...new Set(manifest.probes.flatMap((entry) => entry.threadIds))];
  manifest.status = mode === 'mock' ? 'mock-pass' : manifest.probes.length === 4 && threadIds.length === 4 ? 'awaiting-primary-review' : 'failed';
  manifest.threadIds = threadIds; atomicJson(path.join(outputDir, 'manifest.json'), manifest);
  activeManifest = null; activeManifestPath = null;
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
};

try { main(); } catch (error) {
  if (activeManifest && activeManifestPath) {
    activeManifest.status = 'failed';
    activeManifest.failure = { stage: 'evaluation', detail: error instanceof Error ? error.message : String(error) };
    atomicJson(activeManifestPath, activeManifest);
  }
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1;
}
