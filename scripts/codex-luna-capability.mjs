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
import { CODEX_DECISION_RESPONSE_SCHEMA, normalizeCodexDecisionWire } from './lib/campaign-lab-contract.mjs';
import { CODEX_PROMPT_CONTRACT, CODEX_SUBSCRIPTION_MODEL, codexCliVersion, invokeCodexSubscription } from './lib/codex-subscription.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = process.env.CAMPAIGN_LAB_RUNS_DIR ? path.resolve(process.env.CAMPAIGN_LAB_RUNS_DIR) : path.join(ROOT, 'runs/campaign-lab');
const SCENARIO = path.join(ROOT, 'packages/data-packs/fixtures/europe-1935-benchmark/engine/scenario.json');
const EXTERNAL_SUPPLIERS = Object.freeze(['polity:soviet-union', 'polity:united-states']);
const SYSTEM_TEXT = `You are an autonomous opponent strategist in Open Historia. Return exactly one decision for every polity in the supplied batch using the output schema.
All listed StrategicBriefV3 affordances are executable at the frozen month and revision. Omitted tools and unlisted option combinations are unavailable. Select only exact listed choices.
Use supplied polity, region, proposal, faction, formation, project, and war IDs in action fields. Never invent command IDs or new proposal, project, formation, war, effect, fact, or evidence IDs.
Do not invent effects, numeric outcomes, authoritative consequences, doctrine, hidden intelligence, private character information, or facts. Engine previews are evidence, not values you may alter.
Future plans and contingencies describe intentions and conditions, never completed outcomes. A non-hold decision must choose at least one relevant material affordance. Use conserve with a typed hold only when no material action is justified.`;
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

const promptFor = (probe) => `${MEASURED_SYSTEM_TEXT}${JSON.stringify({ briefs: probe.batch.briefs })}`;
const mockBatch = (probe) => ({ decisions: probe.batch.briefs.map((brief) => {
  const action = expandStrategicAffordancesV3(brief).find((entry) => entry.tool !== 'conserve');
  return action ? { polityId: brief.polity.id, objective: { domain: 'campaign', summary: 'Use the highest-ranked executable response.', horizon: 'short' },
    actions: [action], futurePlan: [{ summary: 'Reassess after engine resolution.', condition: 'Canonical state changes.' }],
    contingency: 'Use another published affordance if conditions change.', rationale: 'The selected action has an engine dry-run preview.', hold: null }
    : { polityId: brief.polity.id, objective: { domain: 'campaign', summary: 'Preserve flexibility.', horizon: 'short' }, actions: [{ tool: 'conserve' }],
      futurePlan: [], contingency: 'Reassess after new evidence.', rationale: 'No material affordance is published.',
      hold: { reason: 'no-legal-action', detail: 'Only conserve is available.', revisit: { afterMonths: 1, triggers: ['resource-deficit'] } } };
}) });

const assessReferences = (raw, prompt) => {
  const text = JSON.stringify(raw);
  const ids = text.match(/(?:polity|region|proposal|faction|formation|project|war|effect|intel|character):[a-z0-9._:-]+/gi) ?? [];
  const invented = [...new Set(ids.filter((id) => !prompt.includes(id)))].sort();
  const narrative = (raw?.decisions ?? []).flatMap((entry) => [entry.objectiveSummary, entry.rationale, entry.intendedOutcome,
    entry.contingency, ...(entry.futurePlan ?? []).flatMap((plan) => [plan.summary, plan.condition])]).filter(Boolean).join(' ');
  return { inventedReferences: invented, privateDoctrine: /lebensraum|private german doctrine|player doctrine/i.test(narrative),
    authoritativeNumericClaims: /\b\d+(?:[.,]\d+)?\s*(?:%|bp|gold|men|equipment|months?)\b/i.test(narrative) };
};

const main = () => {
  const args = parseArgs(process.argv.slice(2)); const mode = args.mode ?? 'live';
  if (!['live', 'mock'].includes(mode)) throw new Error('mode must be live or mock');
  if (mode === 'live') assertFrozen();
  const revision = gitRevision(); const cliVersion = codexCliVersion();
  const runId = args.run ?? `luna-gate0-${revision.slice(0, 12)}`; const outputDir = path.join(RUNS, runId);
  if (fs.existsSync(outputDir)) throw new Error(`evaluation output already exists: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const schemaText = JSON.stringify(CODEX_DECISION_RESPONSE_SCHEMA);
  const probes = buildProbes();
  const manifest = { schemaVersion: 'open-historia-luna-capability/1', runId, mode, model: CODEX_SUBSCRIPTION_MODEL,
    authMode: 'chatgpt', reasoning: 'low', verbosity: 'low', fastMode: false, ephemeral: true, codeRevision: revision,
    cliVersion, promptContract: CODEX_PROMPT_CONTRACT, externalSupplierPolityIds: EXTERNAL_SUPPLIERS,
    externalSupplierProfileChecksum: sha256(JSON.stringify(EXTERNAL_SUPPLIERS)),
    outputSchemaChecksum: sha256(schemaText), completedCodexTurns: 0, status: 'running', probes: [] };
  atomicJson(path.join(outputDir, 'manifest.json'), manifest);
  for (const [index, probe] of probes.entries()) {
    const prompt = promptFor(probe);
    if (prompt.length >= 40000 || probe.batch.characterCount !== prompt.length) throw new Error(`${probe.id} prompt is ${prompt.length}, batch measured ${probe.batch.characterCount}`);
    const probeDir = path.join(outputDir, `${index + 1}-${probe.id}`); fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(path.join(probeDir, 'prompt.txt'), prompt, 'utf8');
    atomicJson(path.join(probeDir, 'brief-batch.json'), probe.batch); atomicJson(path.join(probeDir, 'state.json'), probe.state);
    const beforeChecksum = stateChecksum(probe.state);
    const invocation = mode === 'mock' ? null : invokeCodexSubscription({ prompt, schema: CODEX_DECISION_RESPONSE_SCHEMA });
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
    const normalized = mode === 'mock' ? mockBatch(probe) : normalizeCodexDecisionWire(invocation.response);
    const strict = strategicDecisionBatchV2Schema.safeParse(normalized);
    const materialized = strict.success ? materializeStrategicBatchV3(probe.state, strict.data, probe.batch)
      : { commands: [], rejected: [{ actionIndex: -1, reason: strict.error.issues[0]?.message ?? 'schema rejection' }], unsupportedResidual: [] };
    const afterChecksum = stateChecksum(probe.state); const refs = assessReferences(invocation?.response ?? normalized, prompt);
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
      || refs.privateDoctrine || refs.authoritativeNumericClaims || result.stateMutated)) {
      manifest.status = 'failed'; atomicJson(path.join(outputDir, 'manifest.json'), manifest); process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`); return;
    }
  }
  const threadIds = [...new Set(manifest.probes.flatMap((entry) => entry.threadIds))];
  manifest.status = mode === 'mock' ? 'mock-pass' : manifest.probes.length === 4 && threadIds.length === 4 ? 'awaiting-primary-review' : 'failed';
  manifest.threadIds = threadIds; atomicJson(path.join(outputDir, 'manifest.json'), manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
};

try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; }
