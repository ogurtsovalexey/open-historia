# 07 — AI boundary

Sources: `docs/spec/ai-call-registry.md`, `docs/product/04-ai-orchestration-spec.md`,
`docs/principles.md` §2–3, owner decisions 2026-08-30.

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

## Deferred

- The interpreter module itself (next slice after the dashboard).
- Opponent-brain brief format — draft in `regional-resource-economy.md` §6
  (advisor projection) is the starting point.
