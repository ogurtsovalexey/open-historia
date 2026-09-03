import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countTokens } from 'gpt-tokenizer';
import {
  initState, parseScenario, runTurn, stateChecksum,
} from '../packages/engine/dist/index.js';
import {
  assertStrategicRunCompatible,
  buildStrategicBriefV4,
  materializeStrategicDecisionV4,
  pendingTriggerRetryMonth,
  renderStrategicPromptV4,
} from '../packages/agent-runtime/dist/index.js';
import {
  CODEX_STRATEGIC_CONTRACT,
  hasChatGptLogin,
  inspectCodexSubscription,
  invokeCodexStructured,
  runCodexSchemaPreflight,
  strategicDecisionV3JsonSchema,
} from '../server/codexSubscriptionProvider.js';
import { assessCodexDecisionReferences } from './lib/campaign-lab-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = process.env.CAMPAIGN_LAB_RUNS_DIR
  ? path.resolve(process.env.CAMPAIGN_LAB_RUNS_DIR)
  : path.join(ROOT, 'runs/campaign-lab');
const FIXTURE = path.join(ROOT, 'packages/data-packs/fixtures/europe-1935-benchmark');
const MODEL = 'gpt-5.6-luna';
const EFFORT = 'low';
const SYSTEM_TEXT = 'Make a bounded strategic choice for this polity only. Mandatory triggers and sovereignty outrank optional goals. Select only frozen choice IDs and cite only evidence IDs from the brief. Do not invent facts, numeric effects, IDs, or completed outcomes.';

const parseArgs = (values) => {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || values[index + 1] === undefined) throw new Error(`invalid argument ${values[index] ?? ''}`);
    args[values[index].slice(2)] = values[index + 1];
  }
  return args;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const atomicJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
};
const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')}`;
const gitRevision = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const assertClean = () => {
  if (execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim()) {
    throw new Error('live Gate 0 requires a clean git worktree');
  }
};
const safeRunId = (value) => {
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(value ?? '')) throw new Error('run id must be a safe lowercase token');
  return value;
};
const commandBase = (state, actorPolityId, suffix) => ({
  commandId: `94000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
  actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month,
});
const tokenCount = (text) => countTokens(text);

const schemaForBrief = (brief) => {
  const schema = strategicDecisionV3JsonSchema();
  const choiceIds = brief.choices.map((entry) => entry.choiceId);
  const evidenceIds = [...new Set([
    ...brief.choices.map((entry) => entry.evidenceId),
    ...brief.triggers.flatMap((entry) => [entry.triggerId, ...entry.evidenceIds]),
    ...brief.ownIntelligence.map((entry) => entry.evidenceId),
  ])];
  schema.properties.polityId = { type: 'string', enum: [brief.actor.id] };
  schema.properties.revision = { type: 'string', enum: [brief.revision] };
  schema.properties.selectedChoices.items.properties.choiceId = { type: 'string', enum: choiceIds };
  schema.properties.selectedChoices.items.properties.evidenceIds.items = { type: 'string', enum: evidenceIds };
  schema.properties.rejectedChoices.items.properties.choiceId = { type: 'string', enum: choiceIds };
  if (brief.triggers.length) schema.properties.triggerCoverage.items.properties.triggerId = {
    type: 'string', enum: brief.triggers.map((entry) => entry.triggerId),
  };
  schema.properties.triggerCoverage.items.properties.choiceIds.items = { type: 'string', enum: choiceIds };
  return schema;
};

const loadApprovedState = () => {
  const starting = readJson(path.join(FIXTURE, 'starting-state/starting-state-manifest.json'));
  const geography = readJson(path.join(FIXTURE, 'geography/runtime-geography-manifest.json'));
  if (starting.status !== 'owner-approved-runtime' || geography.gate?.status !== 'owner-approved-runtime') {
    throw new Error('both Europe 1935 owner approvals must be recorded before Gate 0');
  }
  const scenario = parseScenario(readJson(path.join(FIXTURE, 'engine/scenario.json')));
  return { state: initState(scenario), contentVersion: readJson(path.join(FIXTURE, 'manifest.json')).contentVersion };
};

const contextFor = (polityId) => ({
  interests: ['preserve sovereignty and productive capacity'],
  threats: ['resource exhaustion and coercion'],
  obligations: ['honour active canonical obligations'],
  redLines: ['do not rely on invented outcomes'],
  causalAnchors: [{ anchorId: `anchor:${polityId.slice(7)}`, interest: 'preserve strategic capacity',
    applicability: ['current canonical state'], invalidators: ['material state change'] }],
  memory: [],
});

const makeProbe = ({ id, state, polityId, reason, detail, tools, trigger = null, preferred, choiceFilter = null,
  expect = (actions) => actions.length > 0 }) => {
  const brief = buildStrategicBriefV4(state, polityId, {
    invocation: { reason, detail },
    triggers: trigger ? [trigger] : [],
    relevantFamilies: tools,
    strategicContext: contextFor(polityId),
    externalSupplierPolityIds: ['polity:soviet-union', 'polity:united-states'],
    changesSinceLastDecision: [detail],
    systemText: SYSTEM_TEXT,
    countTokens: tokenCount,
  });
  const matching = brief.choices.filter((choice) => preferred.includes(choice.family)
    && (!choiceFilter || choiceFilter(choice.action)));
  if (!matching.length) throw new Error(`${id} has no preferred executable choice (${preferred.join(', ')})`);
  return { id, state, brief, selectedChoiceId: matching[0].choiceId, expect };
};

const buildProbes = () => {
  const { state: base, contentVersion } = loadApprovedState();
  const probes = [];
  const transportActors = ['polity:austria', 'polity:czechoslovakia', 'polity:france', 'polity:italy', 'polity:poland', 'polity:united-kingdom'];
  for (const polityId of transportActors) probes.push(makeProbe({
    id: `transport-${polityId.slice(7)}`, state: base, polityId, reason: 'transport-coverage',
    detail: 'Final Gate 0 transport and legal-choice coverage.', tools: ['invest', 'conserve'], preferred: ['invest'],
  }));
  probes.push(makeProbe({ id: 'austria-scheduled', state: base, polityId: 'polity:austria', reason: 'scheduled-quarter',
    detail: 'Opening quarterly strategic review.', tools: ['invest', 'change-policy', 'conserve'], preferred: ['invest', 'change-policy'] }));

  let ukState = base;
  for (let month = 0; month < 24; month += 1) {
    const check = buildStrategicBriefV4(ukState, 'polity:united-kingdom', {
      invocation: { reason: 'resource-emergency', detail: 'Iron runway check.' },
      relevantFamilies: ['reallocate-production', 'negotiate-trade', 'external-import', 'conserve'],
      strategicContext: contextFor('polity:united-kingdom'), externalSupplierPolityIds: ['polity:soviet-union', 'polity:united-states'],
      systemText: SYSTEM_TEXT, countTokens: tokenCount,
    });
    const iron = check.publicData.economy.resources.find((entry) => entry.resource === 'iron');
    if (iron?.runwayMonths !== null && iron.runwayMonths <= 3) break;
    ukState = runTurn(ukState, { commands: [] }).result.state;
  }
  probes.push(makeProbe({ id: 'uk-iron-exhaustion', state: ukState, polityId: 'polity:united-kingdom', reason: 'resource-emergency',
    detail: 'Iron runway is exhausted or critically short.', tools: ['reallocate-production', 'negotiate-trade', 'external-import', 'conserve'],
    trigger: { triggerId: 'trigger:uk-iron', kind: 'resource-emergency', summary: 'Resolve the critical iron shortage.', mandatory: true,
      compatibleTools: ['reallocate-production', 'negotiate-trade', 'external-import'], evidenceIds: [] },
    preferred: ['negotiate-trade', 'external-import', 'reallocate-production'],
    expect: (actions) => actions.some((entry) => ['negotiate-trade', 'external-import', 'reallocate-production'].includes(entry.tool)) }));

  const germanRegion = base.regions.find((entry) => entry.controllerId === 'polity:germany');
  const proposal = runTurn(base, { commands: [{ kind: 'diplomacy.propose', ...commandBase(base, 'polity:germany', 1),
    proposalId: 'proposal:gate0-czech-territory', recipientPolityId: 'polity:czechoslovakia',
    terms: { kind: 'territorial-settlement', fromPolityId: 'polity:germany', toPolityId: 'polity:czechoslovakia', regionIds: [germanRegion.regionId] } }] }).result;
  if (proposal.rejections.length) throw new Error(`Czech proposal setup rejected: ${proposal.rejections[0].detail}`);
  const proposalTrigger = { triggerId: 'trigger:czech-proposal', kind: 'proposal', summary: 'Answer the pending German territorial proposal.',
    mandatory: true, compatibleTools: ['respond-proposal'], evidenceIds: [] };
  probes.push(makeProbe({ id: 'czech-accept', state: proposal.state, polityId: 'polity:czechoslovakia', reason: 'proposal',
    detail: 'Evaluate the legal accept path.', tools: ['respond-proposal', 'conserve'], trigger: proposalTrigger,
    preferred: ['respond-proposal'], choiceFilter: (action) => action.response === 'accept',
    expect: (actions) => actions.some((entry) => entry.tool === 'respond-proposal' && entry.response === 'accept') }));
  probes.push(makeProbe({ id: 'czech-reject', state: proposal.state, polityId: 'polity:czechoslovakia', reason: 'proposal',
    detail: 'Evaluate the legal reject path.', tools: ['respond-proposal', 'conserve'], trigger: proposalTrigger,
    preferred: ['respond-proposal'], choiceFilter: (action) => action.response === 'reject',
    expect: (actions) => actions.some((entry) => entry.tool === 'respond-proposal' && entry.response === 'reject') }));

  const war = runTurn(base, { commands: [{ kind: 'war.declare', ...commandBase(base, 'polity:germany', 2),
    warId: 'war:gate0-germany-poland', defenderPolityId: 'polity:poland', reason: 'rivalry' }] }).result;
  if (war.rejections.length) throw new Error(`Poland war setup rejected: ${war.rejections[0].detail}`);
  const warTrigger = { triggerId: 'trigger:poland-war', kind: 'war', summary: 'Germany has opened an active war against Poland.', mandatory: true,
    compatibleTools: ['mobilize', 'issue-order', 'negotiate-peace'], evidenceIds: [] };
  probes.push(makeProbe({ id: 'poland-real-threat', state: war.state, polityId: 'polity:poland', reason: 'war',
    detail: 'Respond to the real adjacent supplied German threat.', tools: ['mobilize', 'issue-order', 'negotiate-peace', 'conserve'],
    trigger: warTrigger, preferred: ['issue-order', 'mobilize', 'negotiate-peace'],
    expect: (actions) => actions.some((entry) => ['mobilize', 'issue-order', 'negotiate-peace'].includes(entry.tool)) }));
  probes.push(makeProbe({ id: 'poland-mobilization', state: war.state, polityId: 'polity:poland', reason: 'war',
    detail: 'Mobilization micro-probe: select a legal mobilization response.', tools: ['mobilize', 'conserve'],
    trigger: { ...warTrigger, triggerId: 'trigger:poland-mobilize', compatibleTools: ['mobilize'] }, preferred: ['mobilize'],
    expect: (actions) => actions.length === 1 && actions[0].tool === 'mobilize' }));
  return { probes, contentVersion, packageChecksum: stateChecksum(base) };
};

const decisionFor = (probe) => {
  const choice = probe.brief.choices.find((entry) => entry.choiceId === probe.selectedChoiceId);
  const rejected = probe.brief.choices.filter((entry) => entry.choiceId !== choice.choiceId).slice(0, 2);
  return {
    polityId: probe.brief.actor.id,
    revision: probe.brief.revision,
    objective: { domain: choice.family === 'invest' ? 'economy' : choice.family === 'respond-proposal' ? 'diplomacy' : 'military',
      summary: `Execute the published ${choice.family} response.`, horizon: 'short' },
    selectedChoices: [{ choiceId: choice.choiceId, purpose: `Address ${probe.brief.invocation.reason}.`,
      evidenceIds: [choice.evidenceId], expectedConsequence: 'Apply only the qualitative consequence shown by the engine preview.' }],
    triggerCoverage: probe.brief.triggers.filter((entry) => entry.mandatory)
      .map((entry) => ({ triggerId: entry.triggerId, choiceIds: [choice.choiceId] })),
    rejectedChoices: rejected.map((entry) => ({ choiceId: entry.choiceId, reason: 'Lower priority at this checkpoint.' })),
    durablePlan: { objective: 'Protect sovereignty and strategic capacity.', futureSteps: ['Reassess after the engine revision.'], commitments: [] },
    contingency: 'Hold and retry no earlier than the next monthly checkpoint if the package becomes stale.',
    hold: null,
  };
};

const parseTransport = (stdout) => {
  const events = stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  return {
    threadIds: [...new Set(events.map((entry) => entry.thread_id).filter(Boolean))],
    usage: events.findLast((entry) => entry.type === 'turn.completed')?.usage ?? null,
  };
};

const validatePreflight = (file, model, effort) => {
  if (!file) throw new Error('live Gate 0 requires --preflight <Codex preflight JSON>');
  const record = readJson(path.resolve(file));
  if (record.provider !== 'codex-subscription' || record.contract !== CODEX_STRATEGIC_CONTRACT
    || record.model !== model || record.effort !== effort || !record.preflightChecksum) {
    throw new Error('preflight does not match the frozen provider/model/effort/contract');
  }
  return record;
};

const runSuite = async (args) => {
  const mode = args.mode ?? 'mock';
  if (!['mock', 'live'].includes(mode)) throw new Error('mode must be mock or live');
  if (mode === 'live') assertClean();
  const runId = safeRunId(args.run ?? `strategic-gate0-${gitRevision().slice(0, 12)}`);
  const output = path.join(RUNS, runId);
  if (fs.existsSync(output)) throw new Error(`immutable Gate 0 run already exists: ${output}`);
  const model = args.model ?? MODEL;
  const effort = args.effort ?? EFFORT;
  const preflight = mode === 'live' ? validatePreflight(args.preflight, model, effort) : null;
  const { probes, contentVersion, packageChecksum } = buildProbes();
  const freeze = { schemaVersion: 'open-historia-strategic-run/3', scenarioId: 'scenario:europe-1935-benchmark',
    scenarioContentVersion: contentVersion, promptContract: CODEX_STRATEGIC_CONTRACT,
    provider: mode === 'live' ? 'codex-subscription' : 'deterministic-mock', model: mode === 'live' ? model : 'deterministic-mock',
    effort: mode === 'live' ? effort : 'off', preflightChecksum: preflight?.preflightChecksum ?? 'sha256:mock' };
  const manifest = { schemaVersion: 'open-historia-strategic-gate0/1', runId, mode, status: 'running', freeze,
    codeRevision: gitRevision(), packageChecksum, maxCompletedModelTurns: 40, completedModelTurns: 0, probes: [] };
  atomicJson(path.join(output, 'manifest.json'), manifest);
  for (const [index, probe] of probes.entries()) {
    const directory = path.join(output, `${String(index + 1).padStart(2, '0')}-${probe.id}`);
    fs.mkdirSync(directory, { recursive: false });
    const prompt = renderStrategicPromptV4(probe.brief, SYSTEM_TEXT);
    const schema = schemaForBrief(probe.brief);
    atomicJson(path.join(directory, 'brief.json'), probe.brief);
    atomicJson(path.join(directory, 'candidate-audit.json'), probe.brief.candidateAudit);
    atomicJson(path.join(directory, 'output-schema.json'), schema);
    fs.writeFileSync(path.join(directory, 'prompt.txt'), prompt, { encoding: 'utf8', mode: 0o600 });
    const before = stateChecksum(probe.state);
    let raw;
    let transport = null;
    try {
      if (mode === 'mock') raw = decisionFor(probe);
      else {
        if (manifest.completedModelTurns >= manifest.maxCompletedModelTurns) throw new Error('Gate 0 completed-turn cap reached');
        const result = await invokeCodexStructured({ prompt, schema, model, effort });
        raw = result.response; transport = parseTransport(result.stdout); manifest.completedModelTurns += 1;
        fs.writeFileSync(path.join(directory, 'events.jsonl'), result.stdout, { encoding: 'utf8', mode: 0o600 });
        atomicJson(path.join(directory, 'raw-response.json'), raw);
        atomicJson(path.join(directory, 'transport.json'), transport);
      }
    } catch (error) {
      const pendingTriggerIds = probe.brief.triggers.filter((entry) => entry.mandatory).map((entry) => entry.triggerId);
      const hold = { status: 'provider-hold', pendingTriggerIds, retryMonth: pendingTriggerRetryMonth(probe.state.month), detail: String(error).slice(0, 500) };
      atomicJson(path.join(directory, 'validation.json'), hold);
      manifest.probes.push({ probeId: probe.id, polityId: probe.brief.actor.id, status: 'provider-hold', pendingTriggerIds });
      manifest.status = 'provider-hold'; atomicJson(path.join(output, 'manifest.json'), manifest); return manifest;
    }
    atomicJson(path.join(directory, 'normalized-decision.json'), raw);
    const resolution = materializeStrategicDecisionV4(probe.state, raw, probe.brief);
    const after = stateChecksum(probe.state);
    const selected = resolution.decision?.selectedChoices.map((entry) => probe.brief.choices
      .find((choice) => choice.choiceId === entry.choiceId)).filter(Boolean) ?? [];
    const selectedFamilies = selected.map((entry) => entry.family);
    const semanticPass = resolution.status === 'accepted' && probe.expect(selected.map((entry) => entry.action));
    const references = assessCodexDecisionReferences(raw, prompt);
    const claimsPass = references.inventedReferences.length === 0 && !references.privateDoctrine
      && references.authoritativeNumericClaims.length === 0;
    const validation = { resolution, selectedFamilies, semanticPass, claimsPass, references,
      stateChecksumBefore: before, stateChecksumAfter: after, stateMutated: before !== after };
    atomicJson(path.join(directory, 'validation.json'), validation);
    atomicJson(path.join(directory, 'scores.json'), { structured: resolution.status === 'accepted' ? 1 : 0,
      actorAndTriggerCoverage: resolution.status === 'accepted' && resolution.pendingTriggerIds.length === 0 ? 1 : 0,
      legalMaterialization: resolution.status === 'accepted' ? 1 : 0, semantic: semanticPass ? 1 : 0,
      grounded: claimsPass ? 1 : 0, evaluatorMutation: before === after ? 0 : 1 });
    manifest.probes.push({ probeId: probe.id, polityId: probe.brief.actor.id, status: resolution.status,
      selectedFamilies, semanticPass, claimsPass, promptChecksum: sha256(prompt), usage: transport?.usage ?? null,
      threadIds: transport?.threadIds ?? [] });
    if (resolution.status !== 'accepted' || !semanticPass || !claimsPass || before !== after) {
      manifest.status = resolution.status === 'hold' ? 'visible-hold' : 'failed';
      atomicJson(path.join(output, 'manifest.json'), manifest); return manifest;
    }
    atomicJson(path.join(output, 'manifest.json'), manifest);
  }
  manifest.status = mode === 'mock' ? 'mock-pass' : 'awaiting-owner-score';
  atomicJson(path.join(output, 'manifest.json'), manifest);
  return manifest;
};

const main = async () => {
  const [command, ...values] = process.argv.slice(2);
  const args = parseArgs(values);
  if (command === 'run') {
    process.stdout.write(`${JSON.stringify(await runSuite(args), null, 2)}\n`);
    return;
  }
  if (command === 'preflight') {
    const model = args.model ?? MODEL;
    const effort = args.effort ?? 'medium';
    const inspection = await inspectCodexSubscription({ desktopRuntime: true });
    if (!inspection.available || !hasChatGptLogin()) throw new Error(`Codex subscription unavailable: ${inspection.reason ?? 'ChatGPT login missing'}`);
    const record = await runCodexSchemaPreflight({ model, effort, cliVersion: inspection.cliVersion,
      directory: path.join(RUNS, 'codex-preflights') });
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(readJson(path.join(RUNS, safeRunId(args.run), 'manifest.json')), null, 2)}\n`);
    return;
  }
  if (command === 'resume') {
    const manifest = readJson(path.join(RUNS, safeRunId(args.run), 'manifest.json'));
    assertStrategicRunCompatible(manifest.freeze, manifest.freeze);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }
  throw new Error('usage: strategic-gate0 preflight|run|status|resume --key value');
};

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
