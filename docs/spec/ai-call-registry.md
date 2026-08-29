# Phase 1 AI Call Registry Contract

Status: Accepted Phase 1 design contract. Runtime implementation is tracked
separately.

This contract refines [AC-1](acceptance-criteria.md#ac-1--observable-ai) and
implements the first foundation in the
[Phase 1 implementation sequence](consensus-spec.md#10-implementation-sequence).
It is based on the evidence in the
[AI call inventory](../audits/ai-call-inventory.md).

## 1. Purpose and scope

Every production model call must be attributable before it is sent and
observable after it finishes. The registry answers five questions without
storing sensitive prompt content:

1. Which stable task asked for generation?
2. Which provider profile and model were selected?
3. What categories and quantities of context were sent?
4. What time, token and retry budget was consumed?
5. What validated state effect, fallback or failure followed?

The contract covers runtime generation through `callAI`, including structured
tasks and free-form chat. Model discovery is a metadata request and is recorded
as transport diagnostics, not as a model call. Offline language-pack generation
uses the same usage shape when instrumented, but is not part of the Phase 1
runtime acceptance gate.

Static localization must not make a runtime model call. Selecting a speaker
when only two parties are eligible must be deterministic. A temporary legacy
record for either path makes the remaining violation visible; it does not make
that behavior AC-1 compliant. During migration those records use
`legacy.runtime-translation` and `legacy.two-party-speaker`; both IDs must be
absent from the accepted Phase 1 runtime registry.

## 2. Three accounting levels

Provider retries and structured-output correction attempts are different and
must not be collapsed:

| Level | Meaning | Cardinality |
|---|---|---|
| `AiInvocationRecord` | One user or engine intent, such as one timeline jump. | Exactly one per invocation. |
| `AiGenerationAttempt` | One requested model answer. A structured task may request a corrected answer after parse or validation failure. | One or more per invocation. |
| `AiTransportAttempt` | One billable HTTP generation request. Provider 429/503 retries and compatibility-mode retries each create another entry. | One or more per generation attempt. |

Every request that may incur provider usage creates its transport-attempt entry
before dispatch. Therefore a timeout, abort or unparseable response cannot
disappear from cost accounting. Relay hops are transport metadata on the same
attempt, not additional model calls.

## 3. Stable task registry

The registry is code-owned static data. A call site may use only a registered
`taskId`; arbitrary feature names are rejected in development and recorded as
`registry.unknown` only by the production safety path.

```ts
type AiTaskDefinition = {
  taskId: string;
  version: number;
  kind: "structured" | "conversation";
  authority: "proposal" | "explanation" | "classification" | "compression";
  contextPolicyId: string;
  budgetPolicyId: string;
  outputContractId: string | null;
  allowedVariants: string[];
  fallbackPolicy: "deterministic" | "surface-error" | "silent-none";
  mayMutateState: boolean;
};
```

Rules:

- `taskId` is a stable dotted identifier describing intent, not provider or UI.
- Changing only prompt wording does not rename the task. An incompatible output,
  authority or context-policy change increments `version`.
- Provider, model, endpoint and pricing never appear in a task definition.
- Structured tasks reference their schema/tool contract; conversational tasks
  use `outputContractId: null` and cannot directly mutate canonical state.
- `mayMutateState` means that validated output may lead the engine to an effect;
  it never grants the model authority to write state directly.

### Phase 1 IDs

| Current intent | `taskId` |
|---|---|
| Timeline jump / automatic jump | `timeline.advance` |
| Action suggestions | `actions.suggest` |
| Free-text action refinement | `actions.refine` |
| Campaign-memory consolidation | `memory.consolidate` |
| Catalyst creation / execution / summary | `catalyst.create`, `catalyst.advance`, `catalyst.summarize` |
| Game-master command | `game-master.resolve` |
| Country stat sheet | `country.stat-sheet` |
| Pregame history | `history.pregame` |
| Intelligence briefing | `country.briefing` |
| Advisor response | `chat.advisor.reply` |
| Diplomatic route planning / response | `chat.diplomacy.plan`, `chat.diplomacy.reply` |
| Three-or-more-party speaker selection | `chat.diplomacy.next-speaker` |

`jumpForward` and `autoJumpForward` share an intent and therefore one task ID;
their registered variants are `manual` and `automatic`. Existing schema/tool
keys remain implementation adapters and need not be renamed in Phase 1.

## 4. Selected profile snapshot

Each invocation records the resolved, non-secret profile used for that call:

```ts
type AiProfileSnapshot = {
  providerKind:
    | "gemini"
    | "openai"
    | "anthropic"
    | "openai-compatible"
    | "anthropic-compatible";
  model: string;
  endpointClass: "provider-default" | "loopback" | "lan" | "remote-custom";
  reasoningMode: "off" | "fast" | "standard";
};
```

This is the effective snapshot, not a pointer to mutable settings. API keys,
authorization headers, complete custom endpoints and custom parameter values
are forbidden. A diagnostic may retain a normalized provider host only after
query, user-info and path removal.

## 5. Context manifest

The manifest describes context without duplicating its content:

```ts
type AiContextManifest = {
  manifestVersion: 1;
  worldRevision: string | null;
  promptPackRevision: string | null;
  items: Array<{
    kind:
      | "system-instructions"
      | "scenario-rules"
      | "world-summary"
      | "map-semantics"
      | "events"
      | "actions"
      | "chat"
      | "campaign-memory"
      | "country-dossier"
      | "user-input"
      | "retry-feedback";
    itemCount: number;
    characterCount: number;
    truncated: boolean;
    sourceRevision: string | null;
  }>;
  totalCharacterCount: number;
  fullMapIncluded: false;
};
```

Invariants:

- The ledger stores counts and revisions, never the prompt, history, dossier,
  user text or model response itself.
- `fullMapIncluded` is a literal `false`. Attempting to register a full-map
  context fails before dispatch, enforcing Principle 3.
- Context is measured after truncation and final prompt assembly, so the
  manifest represents what was actually sent.
- Retry feedback is a separate item. This exposes context growth on corrective
  attempts without retaining the validation message.
- A future tokenizer may add `estimatedInputTokens`; character counts remain
  the provider-neutral baseline.

## 6. Budget policy

Budgets belong to registered policies so call sites cannot silently choose an
unbounded provider maximum:

```ts
type AiBudgetSnapshot = {
  policyId: string;
  deadlineMs: number;
  maxOutputTokens: number;
  maxGenerationAttempts: number;
  maxTransportAttemptsPerGeneration: number;
  reasoningMode: "off" | "fast" | "standard";
};
```

- All numeric fields are finite positive integers. `deadlineMs: 0` and an
  omitted output cap are not valid Phase 1 production budgets.
- The transport layer may use fewer retries before a deadline, never more than
  the snapshot permits.
- Structured correction, provider retry, reasoning-compatibility retry and
  structured-mode fallback all consume their respective attempt budgets and
  are visible in the ledger.
- Provider adapters may translate an output budget to different wire fields,
  but must record both the requested value and the effective value sent.
- Small classification and routing tasks use a small/fast policy. Large world
  generation uses an explicit larger policy rather than inheriting the model
  maximum.

Concrete token and timeout numbers are implementation configuration, not part
of the domain task IDs. Phase 1 implementation must set and test them for every
registered task before AC-1 passes.

## 7. Usage and cost

Each transport attempt records:

```ts
type AiUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  totalTokens: number | null;
  source: "provider" | "estimated" | "unavailable";
};

type AiCost = {
  amount: number | null;
  currency: "USD";
  source: "provider" | "price-snapshot" | "unavailable";
  priceSnapshotId: string | null;
};

type AiTransportAttempt = {
  transportAttempt: number;
  startedAt: string;
  latencyMs: number | null;
  transport: "direct" | "relay";
  structuredMode: "none" | "tool" | "json-schema" | "json-object" | "text-json";
  reasoningMode: "off" | "fast" | "standard";
  requestedOutputTokens: number;
  effectiveOutputTokens: number | null;
  // null only while the pre-dispatch stub is open; a persisted/recovered
  // terminal attempt always has one of the statuses below.
  terminalStatus: "success" | "provider-error" | "transport-error" | "timeout" | "cancelled" | null;
  httpStatus: number | null;
  usage: AiUsage;
  cost: AiCost;
};

type AiGenerationAttempt = {
  generationAttempt: number;
  purpose: "initial" | "validation-correction";
  transportAttempts: AiTransportAttempt[];
  // null only between startGenerationAttempt and its terminal completion.
  result: "accepted" | "parse-failed" | "schema-failed" | "semantic-failed" | "request-failed" | null;
};
```

- Provider-reported usage wins. Missing fields remain `null`; zero is never
  used to mean unknown.
- If a provider omits usage, a local estimator may fill token counts with
  `source: "estimated"`. The UI must distinguish estimates from provider data.
- Cost is computed only from provider-returned cost or a versioned local price
  snapshot. No live pricing lookup is required during gameplay.
- Local/self-hosted models normally record cost as unavailable, not zero.
- Invocation totals are sums of transport attempts with known values and also
  expose `hasUnknownUsage` / `hasUnknownCost`; partial totals cannot masquerade
  as complete totals.

## 8. Outcome and accepted effect

An invocation closes exactly once with one outcome:

```ts
type AiInvocationOutcome =
  | { status: "accepted"; effect: AiAcceptedEffect }
  | { status: "no-effect"; reason: "advisory" | "empty" | "superseded" }
  | { status: "fallback"; fallbackId: string }
  | { status: "failed"; failure: AiFailure }
  | { status: "cancelled"; by: "user" | "superseded" };

type AiFailure = {
  code:
    | "provider"
    | "timeout"
    | "transport"
    | "parse"
    | "schema"
    | "semantic-validation"
    | "budget"
    | "registry";
  sanitizedSummary: string;
};

type AiAcceptedEffect = {
  effectKind: "state-change" | "chat-message" | "display-only" | "memory-update";
  fromWorldRevision: string | null;
  toWorldRevision: string | null;
  validatedCommandIds: string[];
  eventIds: string[];
};
```

- `accepted` means schema and world-aware validation passed and the application
  accepted the result. Receiving valid JSON is not acceptance.
- State-changing effects link the pre-commit and committed world revisions.
  The ledger describes the effect but is not authority for replay.
- A deterministic fallback is recorded separately and never attributed to the
  model as an accepted effect. Model usage incurred before fallback remains.
- Chat and display-only output may be accepted with null world revisions.
- Cancellation never becomes a fallback. Timeout follows the task's registered
  fallback policy.

Failures use stable codes (`provider`, `timeout`, `transport`, `parse`,
`schema`, `semantic-validation`, `budget`, `registry`) plus a sanitized summary.
Raw provider bodies and stack traces remain transient debug data.

## 9. Record envelope and lifecycle

```ts
type AiInvocationRecord = {
  schemaVersion: 1;
  invocationId: string;
  parentInvocationId: string | null;
  taskId: string;
  taskVersion: number;
  taskVariant: string | null;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  profile: AiProfileSnapshot;
  context: AiContextManifest;
  budget: AiBudgetSnapshot;
  attempts: AiGenerationAttempt[];
  outcome: AiInvocationOutcome | null;
};
```

Lifecycle invariants:

1. Create the envelope and first transport-attempt stub before network dispatch.
2. Append attempt completion data; never rewrite a failed attempt as successful.
3. Close the invocation after validation, application/fallback or cancellation.
4. Recover an interrupted open record on next startup as `failed/transport`.
5. IDs are random and contain no provider, country, player or prompt content.
6. Records are local diagnostics, not canonical world state and not synced to a
   public service. A state effect links to the canonical revision after commit.
7. `taskVariant` is either null or one of the task definition's registered
   `allowedVariants`; it cannot become an unbounded analytics label.

Phase 1 keeps a bounded per-install ledger through the existing runtime storage
abstraction. The minimum observable window is the latest 200 invocations;
implementations may retain more. Eviction removes oldest closed invocations and
never interrupts the current call.

## 10. Redaction boundary

The following data must never enter a ledger field, console serialization,
export or error summary:

- API keys, authorization/cookie headers and relay request bodies;
- complete endpoint URLs, URL query strings or user-info;
- full system prompts, user messages, histories and retry feedback;
- raw model output, tool arguments or provider error bodies;
- full country dossiers, event text or campaign-memory text;
- custom provider parameters unless represented by an allowlisted enum.

Redaction happens before persistence, not only in the UI. Tests use canary
secrets in headers, URLs, prompts, responses and errors and assert that none
appear in serialized records.

## 11. Provider adapter obligations

The core registry remains provider-neutral. Each adapter reports only:

- effective model and non-secret endpoint class;
- structured/reasoning mode actually sent;
- each HTTP attempt, latency and terminal status;
- requested versus effective output cap;
- normalized usage and cost fields when available;
- direct versus relay transport.

Provider-specific response fields are normalized at the adapter boundary and
are not added to domain task definitions. Unknown provider fields may be counted
for debugging but are not persisted wholesale.

## 12. Incremental migration

1. Add the registry definitions, budget policies, redaction tests and an
   in-memory recorder with no behavioral change.
2. Instrument `callAI` provider adapters so every billable HTTP request produces
   a transport attempt, including retry and compatibility ladders.
3. Route structured tasks through registered IDs and close their records only
   after schema/world validation and accepted state effects are known.
4. Instrument advisor, diplomacy and briefing calls; add context manifests at
   their final prompt-assembly boundaries.
5. Replace two-party speaker calls with deterministic selection and replace
   runtime static localization calls with checked-in/server language packs.
6. Persist the bounded ledger, expose a local diagnostics view/export and turn
   unknown task IDs into a blocking development error.
7. Run the AC-1 matrix across all five provider kinds, relay/direct transport,
   success, retry, correction, timeout, cancellation, fallback and missing usage.

During migration, an instrumented call is never considered complete merely
because lower-level transport telemetry exists. AC-1 passes only when every
production call has a registered task, context and budget and closes with an
outcome.

## 13. Acceptance checks

AC-1 is satisfied when automated tests prove:

1. Every production generation request references a known task and finite
   budget before dispatch.
2. The context manifest is produced after final assembly and always asserts
   `fullMapIncluded: false`.
3. Two correction attempts with three transport tries each produce one
   invocation, two generation attempts and six separately accounted transport
   attempts.
4. Provider usage, estimated usage and unavailable usage remain distinguishable;
   unknown or partial cost is never displayed as zero or complete.
5. Success links to its accepted effect; validation failure, fallback, timeout
   and cancellation close with distinct outcomes.
6. Canary secrets and content do not occur anywhere in serialized records.
7. Native and compatible provider adapters yield the same domain record shape.
8. Two-party speaker selection and static localization perform zero model
   generation requests.
9. The latest 200 closed invocations survive restart and the oldest closed
   records are evicted deterministically.

## 14. Deferred work

- Remote telemetry, shared dashboards and multi-user accounting.
- Automatic online provider-price synchronization.
- Prompt/response capture, even with user opt-in.
- Cross-device ledger synchronization.
- Provider-specific task IDs or provider-specific domain schemas.
- Using cost history to route models automatically.
