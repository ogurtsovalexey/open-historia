# 07 — AI boundary

Sources: `docs/spec/ai-call-registry.md`, `docs/product/04-ai-orchestration-spec.md`,
`docs/principles.md` §2–3, owner decisions 2026-08-30.

> **Supersession note (2026-09-04):** canon 22 keeps the bounded-context,
> evidence, validation and numeric-authority rules, while expanding AI
> authority to semantic direction, qualitative process pace and staged open
> initiatives. Exact quantities and committed effects remain engine-owned.

## Roles the LLM plays (target)

1. **Order interpreter** — free-text player orders → typed `EconCommand[]`
   valid against `packages/engine/src/commands.ts#econCommandSchema`
   (`exportJsonSchema` from `@open-historia/domain` hands the schema to the
   model as a structured-output/tool contract). Commands MUST carry
   `expectedRevision`. Anything the schema rejects never reaches the engine.
2. **Opponent brain** — receives a bounded, engine-built brief (deficits,
   potentials, limiting inputs, previews — never the full map, never raw
   state) and answers with typed commands, competing to win within the same
   rules as the player. Difficulty = brief richness + command budget, not
   secret bonuses.
3. **Narrator/advisor** — paraphrases the deterministic `report.md` / ledger.
   May explain, may recommend an available typed command; may not create
   resources, recipes, percentages or numeric effects.

## Two model roles (owner decision 2026-08-31)

The app configures **two independent providers/keys**, because the work splits
into two kinds with very different cost and quality needs:

| Role | What it does | Quality bar |
|---|---|---|
| **Strategic** | Plays rival polities, diplomacy, narrative over engine results, interprets free-text orders | The good model; its mistakes change the game |
| **Utility** | Auxiliary, mechanical work: translating generated text, resolving an ambiguous name, reformatting, cheap parsing | The cheapest or a free model; its mistakes are recoverable and visible |

`principles.md` §3 already anticipates the utility role ("a utility model is only
an optional fallback for unresolved names or ambiguous scope"). This makes it a
first-class, separately-keyed connection rather than a fallback of the strategic
one, so a cheap key can carry all the mechanical volume.

Rules for the utility role:

- It may never decide a numeric outcome, own state, or act as an opponent.
- Its output is always either (a) text shown to the player, or (b) an input that
  the engine re-validates against a schema. Never a direct state change.
- Every call is recorded through the call registry like any other (below), so
  the two roles' spend is visible separately.
- If the utility key is absent, the feature that needs it degrades to a plain,
  honest fallback — never to a strategic-model call, and never to silence.

**Current status:** designed, not built. Static localisation deliberately does
**not** use it: a missing pack entry shows English so the gap stays visible
(canon: localisation track). Routing translation through the utility model is a
later option, not a substitute for a complete pack.

## Hard rules

- The engine (`packages/engine`) imports nothing AI-related; dependency
  direction is interpreter → engine schemas, one way.
- The headless slice and all engine tests run with **zero model calls**.
- Every model call in the app goes through the call registry/ledger
  (`src/Game/AI/aiCallRegistry.js`, `aiCallLedger.js` — built, being wired)
  so token spend is observable per task.
- Token hygiene (Track A): UI locales narrowed to EN+RU static packs; prompts
  must not carry the map or unbounded context (`docs/principles.md` §3);
  context size is a QA check.
- A polity authored with engine `decisionMode: inert` remains a legal world
  entity and target but is excluded by every opponent decision scheduler.
  Absence of the optional field preserves legacy active behaviour. This is the
  required boundary for non-player entities such as 1935 Saar and Danzig.

## Deferred

- The interpreter module itself (next slice after the dashboard).
- Opponent-brain brief format — draft in `regional-resource-economy.md` §6
  (advisor projection) is the starting point.
