# 18 — Autonomous Campaign Lab

Status: accepted implementation contract; V4 Gate 0 revision accepted 2026-09-02.

## V4 Gate 0 freeze prerequisites

No new model turn may run until the owner approves both the Europe 1935
geography overlay and the complete starting-state table. The immutable V4 lab
round stores exact prompt/schema, candidate audit, raw response,
normalization/materialization, scoring, thread id, usage and checksums beneath
`runs/campaign-lab/`; only redacted aggregates may enter Git.

The hard live budget is 40 completed turns. Evaluation begins with the fixed
old-vs-new one-shot A/B, then the Czech/Poland two-step and reversed-order
probes, followed by bounded cross-model checks and the two final Gate 0 runs.
One-shot is production default when it meets the same quality threshold as
two-step. Every final prompt uses `StrategicBriefV4+StrategicDecisionV3`, is at
most 8,000 input tokens and has one private country session.

Provider/model failure never falls back automatically: it creates a hold,
keeps triggers pending and asks the player to change configuration manually.
Campaign Lab freezes provider, model, effort and preflight at start. Regular
games may change them only for the next checkpoint and record the change in
provenance.

Codex subscription is a separately selectable provider for both strategic and
utility roles in the desktop app. Web and Android report it as unavailable.
The game stores only model and effort, never a ChatGPT token. The embedded
server inspects the installed system CLI, requires ChatGPT login, obtains the
complete model catalog through `model/list`, marks Luna/Terra/Sol `tested` and
all other discovered models `unverified`. Model discovery starts no thread and
therefore exposes no plugin, app or MCP tool to a model; the subsequent isolated
schema run disables all three explicitly. Availability inspection is not the schema-transport
preflight and performs no model turn; the latter remains mandatory for each
model/contract combination before first use.
The preflight uses the production `StrategicDecisionV3` JSON Schema in a fresh
ephemeral read-only process, validates a frozen sentinel response, and stores a
mode-0600 record containing only CLI/model/effort/contract and schema/response
checksums. Raw preflight responses and ChatGPT credentials are not persisted.

## 2026-09-02 Codex-local renewal

Principles 1–4 remain binding. The failed 2026-09-01 evidence is immutable
diagnostic material: its retry budget does not count against the renewed gate
because it exposed a defective V2 brief boundary and an unsupported Codex
output-schema shape. New runs freeze
`StrategicBriefV3+StrategicDecisionV2`; V2 runs never resume under V3.

The only new matrix namespace is `free10-autonomy-v2-codex-luna`, containing
Germany historical, alternative and free. It freezes the external-supplier
profile separately from the matrix version, plus provider kind, ChatGPT auth,
`gpt-5.6-luna`, low reasoning/verbosity, Codex CLI version, code revision,
prompt/brief contract and preflight checksum. Status and resume reject drift.
Gemini is an explicitly selected, non-resumable legacy diagnostic provider and
is never a fallback.

The isolated capability evaluator writes only beneath `runs/campaign-lab/`,
uses real V3 briefs and dynamic engine states, and cannot mutate campaign
state. Every call is a fresh `codex exec --ephemeral` in a temporary
non-repository cwd, with ChatGPT login forced, read-only sandbox, user rules,
plugins and MCP disabled, and provider credentials removed from the child
environment. It retains JSONL, exact prompts and responses, normalized strict
V2 decisions, validation/materialization results, thread ids, CLI version,
revision and checksums. A transport retry is allowed only if no Codex turn
completed; there is no schema-correction generation or substitute model.

Renewed Gate 0 is four sequential independent Luna sessions: the initial six-
opponent 1935 state, UK iron exhaustion with domestic/ordinary/external supply
choices, a real territorial proposal to Czechoslovakia, and an engine-created
German war for Poland. Passing requires 4/4 structured outputs, exact actor
coverage, relevant material focal choices, at least 90% unsalvaged decision
materialization, no invented/private/authoritative content, exact affordance
matching, prompt sizes below 40,000 characters, no validation mutation, four
distinct thread ids, and at least 4/5 relevance/coherence for every focal
strategy. Only transport formatting or clearly correctable prompt wording may
receive one revision and failed-probe repeats, with at most four additional
completed Luna turns; other failure stops the work.

Production `codex-subscription` remains gated on that pass and is a local Lab
facility, never a shipped-game backend. After integration it receives exactly
two live preflight calls: one real opponent batch and one aggregate of fifteen
real tool-family micro-briefs. Subscription/rate-limit failures atomically
pause at the same revision/checkpoint; invalid individual decisions become
typed holds. The three German campaign lines start only after both calls and
all deterministic gates pass, run sequentially with the existing 60-turn line
and 180-turn matrix limits, and stop before any Poland, France or UK line.

## Legacy 2026-09-01 Gemini diagnostic contract

The remaining sections describe the frozen legacy provider unless the Codex
renewal above explicitly overrides them.

### Preconditions and authority

- Canon 00–17 remains binding. The lab is an opt-in orchestration layer and
  never becomes a second simulation engine.
- The engine owns dates, revisions, validation and every numeric effect. A
  strategic model may return typed commands only.
- Full map geometry is forbidden in prompts. Serialized model context is at
  most 40,000 characters; durable campaign memory is at most 12 facts and
  6,000 characters.
- A live run reads `GEMINI_API_KEY` from its process environment. Keys, raw
  prompts, provider responses and browser traces are never committed.

### CLI and run contract

The root command `campaign-lab` exposes `start`, `status`, `decide`, `resume`
and `report`. A run manifest pins scenario checksum, engine revision, model,
model parameters and strategy before the first resolved month. Mutating those
values after start is a hard error.

The runner advances monthly. Strategic opponents decide quarterly and at an
engine-detected checkpoint. The player controller decides every six months and
at material checkpoints: ultimatum/treaty, war/call, occupation/peace,
default/government transfer. At most six opponent polities share one request;
all opponents are covered by stable, sequential batches.

Live campaigns use `gemini-3.5-flash-lite` with `thinkingLevel=minimal` (Gemini
3 cannot disable thinking), `maxOutputTokens=8192`, at most 60 provider attempts,
two transport retries and one separate schema-correction generation. A passing
primary preflight artifact for the exact model and code revision is mandatory
before a live run can be frozen. There is no hidden strategic fallback.
Deterministic mocked mode is mandatory for tests and costs no provider calls.

All live attempts share a persisted Pacific-time quota ledger. Dispatch is
paced to at most 10 RPM and 200,000 TPM and stops at 490 attempts per Pacific
quota day. The run enters `quota-paused` rather than probing through the limit;
`resume` may continue only after the Pacific date changes. The per-campaign
60-attempt limit is checked before every retry. Only network failures, 429, 503
and other 5xx responses are transport-retryable; parse/schema correction is a
new generation and 4xx contract errors are terminal.

Chronicle inclusion and decision checkpoints are separate. Repeated monthly
resource alerts are diagnostics, not strategic triggers. The chronicle records
alert start, material worsening/change and resolution. Extra decisions are
triggered only by material diplomacy, war/call, occupation/peace, government,
default or crisis transitions, plus the first active food shortfall.

### Chronicle and telemetry

Every material event appends one JSONL record and one Markdown entry containing
month, opening/closing revision, participants, event kind, related decisions,
canonical evidence ids, mechanical deltas, a short causal explanation and an
`observed | inferred` epistemic marker. Run completion writes a final card.

Every provider attempt records provider usage metadata (input, output, cached,
reasoning and total tokens when supplied), latency, retry/generation numbers,
terminal status, parse/schema result and accepted/rejected command counts.

Raw material lives under gitignored `runs/campaign-lab/`. Only a redacted,
aggregate dataset and the cross-run report may be committed.

### Acceptance

- Mocked runs replay byte-identically and produce non-empty chronicles/cards.
- Prompt gates prove the character/memory limits and absence of geometry.
- A nine-polity fixture schedules every one of eight opponents in two batches.
- `status`, `resume` and `report` tolerate process restart and reject manifest
  drift.
- Live smoke is an explicit, separate command and skips honestly without a key.
