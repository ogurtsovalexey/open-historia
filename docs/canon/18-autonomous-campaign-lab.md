# 18 — Autonomous Campaign Lab

Status: accepted implementation contract, 2026-09-01.

## Preconditions and authority

- Canon 00–17 remains binding. The lab is an opt-in orchestration layer and
  never becomes a second simulation engine.
- The engine owns dates, revisions, validation and every numeric effect. A
  strategic model may return typed commands only.
- Full map geometry is forbidden in prompts. Serialized model context is at
  most 40,000 characters; durable campaign memory is at most 12 facts and
  6,000 characters.
- A live run reads `GEMINI_API_KEY` from its process environment. Keys, raw
  prompts, provider responses and browser traces are never committed.

## CLI and run contract

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

## Chronicle and telemetry

Every material event appends one JSONL record and one Markdown entry containing
month, opening/closing revision, participants, event kind, related decisions,
canonical evidence ids, mechanical deltas, a short causal explanation and an
`observed | inferred` epistemic marker. Run completion writes a final card.

Every provider attempt records provider usage metadata (input, output, cached,
reasoning and total tokens when supplied), latency, retry/generation numbers,
terminal status, parse/schema result and accepted/rejected command counts.

Raw material lives under gitignored `runs/campaign-lab/`. Only a redacted,
aggregate dataset and the cross-run report may be committed.

## Acceptance

- Mocked runs replay byte-identically and produce non-empty chronicles/cards.
- Prompt gates prove the character/memory limits and absence of geometry.
- A nine-polity fixture schedules every one of eight opponents in two batches.
- `status`, `resume` and `report` tolerate process restart and reject manifest
  drift.
- Live smoke is an explicit, separate command and skips honestly without a key.
