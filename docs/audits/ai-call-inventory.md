# AI Call Inventory & Cost-Risk Audit

Status: Draft — evidence-based inventory, not an implementation plan.
Scope: every runtime and build-time AI (LLM) call in the repository, plus the
transport hops they share. Non-LLM network activity (map-asset downloads,
community-hub/node sync, scenario fetchers) is listed only to prove it was
checked and excluded.

Base SHA: `365bbe59376ce6ccf61548c636822fdc909a2c33` (`private/main`).
Read-only paths followed: `src/**`, `server/**`, `scripts/**`, accepted specs.

**Functional role: AI Engineer** (per issue role assignment). This audit is
written from the prompt / JSON-schema / validation / model-selection
perspective: prompt provenance and drift, tool & schema fidelity per task,
strict-vs-salvage discipline, provider behavior and per-call budgets. The
owned-path and decision boundaries are unchanged.

---

## 1. Entry-point accounting

Every network path that can reach an LLM, traced to a concrete `fetch`:

| # | Entry point | File:line | Reaches LLM | Notes |
|---|-------------|-----------|-------------|-------|
| 1 | `callAI` — single dispatch over `getStoredProvider()` | `src/Game/AI/main.jsx:1130` | yes | The only runtime LLM gateway. 5 provider branches. |
| 2 | Gemini `generateContent` (buffered) | `main.jsx:590` (`getGeminiUrl` `:245`) | yes | Direct `fetch`, key in query string. |
| 3 | Gemini `streamGenerateContent` (chat stream) | `main.jsx:566` | yes | Only when `onChunk && !tool` (advisor). |
| 4 | OpenAI `chat/completions` | `main.jsx:692` (via `callOpenAI` `:840`, endpoint const `:36`) | yes | `providerFetch` → direct or relay. |
| 5 | OpenAI-compatible `chat/completions` | `main.jsx:692` (via `callOpenAICompatible` `:874`) | yes | User endpoint (default `http://localhost:11434/v1`, `providerConfig.js:74`). |
| 6 | Anthropic `messages` | `main.jsx:971` (via `callAnthropic` `:916`, endpoint const `:37`) | yes | Direct `fetch` only, browser-access opt-in header. |
| 7 | Anthropic-compatible `messages` | `main.jsx:1081` (via `callAnthropicCompatible` `:1026`) | yes | `providerFetch` → direct or relay. |
| 8 | Model discovery `GET /models` | `main.jsx:512` (`resolveModel`) | no | Metadata call to OpenAI / OpenAI-compatible endpoints only. |
| 9 | Same-origin relay `POST /api/ai/relay` | client `main.jsx:308`, server `server/server.js:605` | transport | Forwards any http(s) URL; used only by `providerFetch` callers (rows 4, 5, 7, 8). |
| 10 | Lang-pack generator `POST {OH_LLM_BASE_URL}/chat/completions` | `scripts/generate-lang-packs.mjs:57` | yes | Offline/build tooling; env `OH_LLM_BASE_URL/KEY/MODEL/BATCH`. |

Checked and excluded (non-LLM network): `scripts/fetch-fmg.mjs:39`,
`scripts/fetch-map-assets.mjs:74`, `scripts/node-updater.mjs:56`,
`src/runtime/web/sync.js` (community node), `electron/main.cjs` (spawns
`fetch-map-assets.mjs`), `tools/import-counter/worker.js` (Cloudflare worker).

All seven `callAI` call sites in the tree:

| Call site | File:line |
|-----------|-----------|
| `runJsonTask` (all structured tasks) | `src/Game/AI/gameplay.js:522` |
| Intelligence briefing (free-form) | `gameplay.js:1838` |
| Diplomacy planner pre-classification | `main.jsx:1314` |
| Advisor chat | `main.jsx:1352` |
| Diplomatic chat | `main.jsx:1428` |
| UI translation batch | `src/runtime/translator.js:327` |

`providerConfig.js` contains no network code; it only reads/writes
`localStorage` (`providerConfig.js:109-155`). `diplomacyRouting.js` and
`promptContext.js`/`gameplayPrompts.js` are deterministic (no model calls).

---

## 2. Runtime call inventory

### 2.0 Prompt, tool, schema and validation matrix (AI Engineer view)

Prompt provenance: every structured task renders `prompts.tasks[taskKey]`
from the **per-game frozen prompt pack** (`loadPromptCatalog`,
`gameplay.js:313-314` → `readJson(JSON_URLS.prompts)` → `normalizePromptPack`,
`gameplayPrompts.js:232`), falling back to built-in defaults
(`GAMEPLAY_PROMPT_DEFAULTS`, `gameplayPrompts.js:11`). Because each save
carries its own copy, fixes ship as **call-time directives** appended in
`runJsonTask` (`gameplay.js:435-504`) — an accepted pattern that only works
while every directive is re-appended there. Chat prompts are
`promptPack.advisor` (`main.jsx:1231`) and `promptPack.leader`
(`main.jsx:1285`). Schemas/tools live in `gameplaySchemas.js`
(`GAMEPLAY_SCHEMAS` `:761`, `GAMEPLAY_TOOLS` `:857`, `getGameplayTool`
`:873`, hand-rolled validator `validateGameplayPayload` `:992`).

| taskKey | Tool (`gameplaySchemas.js`) | Schema | Prompt (frozen pack) | Semantic validator | Strict (att. 1) → Salvage (att. 2) |
|---|---|---|---|---|---|
| `jumpForward` | `submit_jump_result` `:786` | `JUMP_FORWARD_SCHEMA` `:534` | `tasks.jumpForward` (`defaultPrompts.json:58`) | `validateTimelineDates` `gameplay.js:128` + `validateGeneratedWorldChanges` `:1236` (strict transfers; clamp dates on salvage `:190`) | yes |
| `autoJumpForward` | `submit_jump_result` `:792` | `AUTO_JUMP_FORWARD_SCHEMA = JUMP_FORWARD_SCHEMA` `:564` | same as jump | same | yes |
| `actions` | `submit_actions` `:780` | `ACTIONS_SCHEMA` `:504` | `tasks.actions` | none beyond schema | — |
| `descriptionToAction` | `submit_description_to_action` `:798` | `DESCRIPTION_TO_ACTION_SCHEMA` `:618` | `tasks.descriptionToAction` (`defaultPrompts.json:55`) | none beyond schema | — |
| `nextSpeaker` | `submit_next_speaker` `:804` | `NEXT_SPEAKER_SCHEMA` `:632` | `tasks.nextSpeaker` (`defaultPrompts.json:59`) | name matched to chat participants `gameplay.js:1949` | — |
| `eventConsolidator` | `submit_event_consolidation` `:810` | `EVENT_CONSOLIDATOR_SCHEMA` `:642` | `tasks.eventConsolidator` (`defaultPrompts.json:56`) | memoryOps evidence-id checks (prompt-enforced, `gameplay.js:462`) | — |
| `catalystCreation` | `submit_catalyst_creation` `:816` | `CATALYST_CREATION_SCHEMA` `:657` | `tasks.catalystCreation` | none beyond schema | — |
| `catalystExecutor` | `submit_catalyst_execution` `:822` | `CATALYST_EXECUTOR_SCHEMA` `:659` | `tasks.catalystExecutor` | none beyond schema | — |
| `catalystSummary` | `submit_catalyst_summary` `:828` | `CATALYST_SUMMARY_SCHEMA` `:679` | `tasks.catalystSummary` | none beyond schema | — |
| `gameMaster` | `submit_game_master` `:834` | `GAME_MASTER_SCHEMA` `:691` | `tasks.gameMaster` (`defaultPrompts.json:57`) | `validateGeneratedWorldChanges` `:1236` | yes (strict transfers) |
| `countryStatSheet` | `submit_country_stat_sheet` `:840` | `COUNTRY_STAT_SHEET_SCHEMA` `:709` | `tasks.countryStatSheet` | none beyond schema | — |
| `idleDiplomacy` | `submit_idle_diplomacy` `:846` | `IDLE_DIPLOMACY_SCHEMA` `:603` | `tasks.idleDiplomacy` (`defaultPrompts.json:61`) | `validateChatOpener` `gameplay.js:1213` strict att. 1 only | partial |
| `pregameHistory` | `submit_pregame_history` `:852` | `PREGAME_HISTORY_SCHEMA` `:583` | `tasks.pregameHistory` (`defaultPrompts.json:60`) | `validatePregameEvents` `gameplay.js:2307` | yes |

Schema-fidelity risk: several frozen task prompts embed an inline JSON
"OUTPUT FORMAT" block (e.g. `descriptionToAction`, `eventConsolidator`,
`gameMaster`) that can drift from the live tool schema — the tool is what is
enforced at runtime, but the inline block is what shapes generation for
prose-mode local models. Reconciliation belongs to the prompt-pack owner.

### 2.1 Structured gameplay tasks (`runJsonTask`, `gameplay.js:391`)

Shared behavior for all rows: `callAI` with a forced single tool
(`getGameplayTool(taskKey)`), 2 output attempts (`gameplay.js:521`), schema
validation then caller `validatePayload` with `strict` on attempt 1 /
salvage on attempt 2 (`gameplay.js:562-577`), retry instruction fed back as a
history message (`gameplay.js:585-601`), deterministic `fallback()` on total
failure (`gameplay.js:620-628`), abort re-thrown without fallback
(`gameplay.js:614`). No maxTokens unless the caller passes `callOptions`
(`gameplay.js:392,522-532` — no cap → provider model maximum). Timeout
`timeoutMs`: 0 (no deadline) unless the "Limit AI generation" map setting is
on (`gameplay.js:395`).

| Task (taskKey) | Caller / exported fn | User-visible feature (UI caller) | Context inputs | Output handling | Budget / timeout | Fallback |
|---|---|---|---|---|---|---|
| `jumpForward` / `autoJumpForward` | `simulateTimelineJump` `gameplay.js:2173` | Time-skip control (`time.jsx:1453`) | World/game/events/actions/chats bundle + call-time directives (agency, map truth, region capture, polity names, units, reputation, actions reference `gameplay.js:435-504`) + campaign memory `:416` + difficulty `:422` | `applySimulationResult` `:1539`; region ids canonicalized in place; `generation{source}` rides into `simulationHistory` | No cap; timeout 0 or 300 s (`:2182`) | `fallbackJumpSimulation` (canned events) |
| `actions` | `generateActionSuggestions` `gameplay.js:1699` | "Suggest actions" (`actions.jsx:393`) | Full bundle variables | Topics list normalized, invalid entries dropped `:1705` | No cap; default timeout | `fallbackActionSuggestions` |
| `descriptionToAction` | `refinePlayerAction` `gameplay.js:1879` | Freeform action box (`actions.jsx:345`) | Bundle + `actionInput` | Normalized into `{kind,title,text,invitees,chatStarter}`; persisted to actions | No cap; default timeout | `fallbackDescriptionToAction` |
| `nextSpeaker` | `chooseNextDiplomaticSpeaker` `gameplay.js:1934` | Group-chat speaker pick (`chat.jsx:550`) | Bundle + chat; deterministic pre-filter `pickMentionedSpeaker` runs first `:1924` | Name matched against chat countries, else first eligible | `maxTokens: 256`, `reasoningMode: "fast"` (`:1935`) | `fallbackNextSpeaker` |
| `eventConsolidator` | `consolidateHistoryBatch` `gameplay.js:659` ← `compactHistoryIfNeeded` `:679` (auto inside jumps); exported `consolidateRecentHistory` `:1956` (no UI caller found) | Silent campaign-memory compression | Event/chat/action history texts with ids; memoryOps contract | Summary + `memoryOps` written to `consolidatedHistory` / campaign memory | No cap; 60 s when limit setting on (`:668`) | Deterministic join of event/chat/action texts |
| `catalystCreation` | `createCatalyst` `gameplay.js:1967` | Catalyst scenes — **no UI caller found in current tree** (exported only) | Bundle variables | `world.activeCatalyst = catalyst` `:1989` | No cap; default timeout | Canned choices from last event |
| `catalystExecutor` | `advanceActiveCatalyst` `gameplay.js:2017` | Catalyst choice resolution — **no UI caller found** | Bundle + `catalystChoice`, history, opening/premise | Applies `impacts` via world write | No cap; default timeout | Canned continuation |
| `catalystSummary` | inside `advanceActiveCatalyst` `gameplay.js:2069` | Final event of a resolved catalyst — **no UI caller found** | Same + summaries | Event + summary | No cap; default timeout | Canned summary |
| `gameMaster` | `applyGameMasterCommand` `gameplay.js:2249` | GM console (`cheats.jsx:394`) | Bundle + `gameMasterRequest` | Single GM event + impacts via `validateGeneratedWorldChanges` | No cap; default timeout | Empty-impacts no-op |
| `countryStatSheet` | `generateCountryStatSheet` `gameplay.js:1852` | Stats tab sheet (`stats.jsx:234`) | Bundle + target dossier (`buildTargetDossier` `:1764`) | Persisted into `world.countryStats[code]` `:1868` | No cap; default timeout | none — throws on total failure |
| `idleDiplomacy` | `maybeSendIdleDiplomacy` `gameplay.js:2435` | Background drip (`GameUI/main.jsx:167` — 60 s tick, chance 1/8, visible tab only, `:2424`) | Full bundle variables | Chat built or `null`; dropped if busy `:2456` | No cap; 60 s when limit setting on (`:2436`) | none — silent `null` |
| `pregameHistory` | `maybeGeneratePregameHistory` `gameplay.js:2357` | First open of a fresh game (`time.jsx:1414`); once-only gates `:2347-2350` | Scenario briefing + rules/map | Backstory events dated before start; `simulationHistory` entry doubles as done-marker `:2385` | No cap; 300 s when limit setting on (`:2358`) | none — silent `null` |

### 2.2 Free-form chat calls (no tool)

| Call | Caller / file:line | User-visible feature (UI caller) | Context inputs | Output handling | Budget | Fallback |
|---|---|---|---|---|---|---|
| Advisor reply | `sendMessage` `main.jsx:1352` | Advisor panel (`advisor.jsx:292`) | `buildAdvisorSystemPrompt` (`main.jsx:1209`: world/events/actions/chats/advisor + campaign memory) + `advisorHistory` compacted at 24/18 messages (`main.jsx:1326`) | Streamed via `onChunk`; history popped on error `:1356` | `maxTokens: 8192` | none — error surfaces to UI |
| Diplomatic reply | `sendDiplomaticMessage` `main.jsx:1428` | Leader chat (`chat.jsx:485`) | `buildDiplomaticSystemPrompt` (`main.jsx:1236`) with route-aware map context (`buildFocusedDiplomaticMapContext`, `diplomacyRouting.js:96`) + `diplomaticHistory` | `REACTION:<emoji>` tail parsed (`main.jsx:1392`); history popped on error | `route.maxTokens` 1024/4096/12000 by regex (`diplomacyRouting.js:41`) | none |
| Diplomacy planner | `planDiplomaticContext` `main.jsx:1314` | Same turn, before the reply — only when `needsPlanner` (high-complexity route, no mentioned entities, `diplomacyRouting.js:46-53`) | Chat participants + last 1200 chars of recent context + message | JSON `{complexity, entities}` merged into route; router failure never blocks diplomacy (`main.jsx:1410`) | `maxTokens: 256`, `reasoningMode: "fast"` | none (catch → deterministic route) |
| Intelligence briefing | `generateCountryStats` `gameplay.js:1838` | Country panel briefing (`CountryPanel.jsx:151`) | Target dossier (`:1764`) + world summary + recent events + era rules | Free text rendered in panel | No cap | none — error surfaces |

### 2.3 Background translation (runtime)

| Call | Caller / file:line | Trigger | Context | Output handling | Budget | Fallback / retry |
|---|---|---|---|---|---|---|
| UI translation batch | `translateBatch` `src/runtime/translator.js:327` | Non-English language set: boot pre-pass (`collectCatalogStrings` `:419`), MutationObserver on new DOM (`:276`), `translateLabel` / `enqueueStrings` / `enqueueContentStrings` (`:493,:511,:536`) | JSON array of up to 60 English UI strings | `extractJsonArray` (`:295`); wrong-length arrays are filled by index and blank entries fall back to the source string (`:371-379`); cache in `localStorage` (`i18n_cache_<lang>`, limit 8000, `:26`) + debounced push to server pack `/api/lang/<code>` (`:68`) | `maxTokens: 4096`, `languageMode: "none"`, `reasoningMode: "fast"` (strips reasoning params, `main.jsx:678-684`) | Strictly serial (`MAX_CONCURRENT_BATCHES = 1`); 3 consecutive batch failures → 60 s cooldown (`:382-397`); server pack re-cache on boot (`loadServerPack` `:566`) |

### 2.4 Model discovery (metadata)

`resolveModel` (`main.jsx:489`): configured model → caller fallback (Gemini
`gemini-3.5-flash-lite` `:34`, Anthropic `claude-haiku-4-5` `:35`) → else
`GET /models` for `openai`/`openai-compatible` only (`providerConfig.js:141`),
best id picked by regex hints (`main.jsx:133`) and **persisted into settings**
(`main.jsx:527`). Not a generation call, but it is a per-provider network call
and its failure is converted into a "go to settings" error (`main.jsx:532`).

---

## 3. Shared transport behavior (all runtime calls)

| Aspect | Behavior | Evidence |
|---|---|---|
| Provider dispatch | One `callAI` switch; unknown provider → Gemini default branch | `main.jsx:1141-1153`, `providerConfig.js:127-130` |
| Retries | 3 attempts, fixed 15 s delay, only on 429/503; deadline-guarded; Gemini treats 429 as fatal "quota exhausted" | `main.jsx:589-651`, `:789-799`, `:978-987`, `:1083-1092`, `:616-620` |
| Structured-mode ladder | OpenAI-compatible only: `tool` → 400/422 → `json_schema` → `json_object` → `text_json` (schema in prompt); native OpenAI stays in tool mode | `main.jsx:761-787`, `allowJsonSchemaFallback` `:868/:902` |
| Reasoning conflicts | 400/422 on tools+reasoning → retry once with reasoning stripped, then `reasoning_effort:"none"` in tool mode | `main.jsx:761-769`, `:733` |
| Anthropic ceiling learning | 400 `max_tokens: X > Y` → cache Y per model, retry at Y | `main.jsx:994-1000`, `:1098-1104` |
| Cancellation | AbortSignal → controller → fetch; abort never falls back; local endpoints stream so cancel is physical | `gameplay.js:506-515,611-618`, `main.jsx:697-700` |
| Relay fallback | Only when `PAGE_IS_LOCAL` and a CORS `TypeError`; origin remembered | `main.jsx:263-277,327-356` |
| Streaming | Cloud buffered; streaming only for advisor `onChunk` or local endpoints; content-type branched | `main.jsx:691-700,809-821` |
| Token caps | Sent only when caller passes maxTokens; floored at 8192 in `callGemini` default param but Gemini buffered path sends no cap; OpenAI uses `max_completion_tokens` / compatible `max_tokens`; Anthropic required | `main.jsx:536-543,723-725,951-954` |
| Reasoning default | Global toggle **on by default**; Gemini `thinkingBudget: 8192`, OpenAI `reasoning_effort:"medium"`, Anthropic `budget_tokens: 4096` | `providerConfig.js:174-176`, `main.jsx:574,712,961` |
| Telemetry | **None.** No token/usage/cost/latency record anywhere in `src/**`, `server/**`, `scripts/**` (grep for `usage|prompt_tokens|total_tokens|cost|telemetry|performance.measure` → no matches outside unrelated Editor UI props) | — |
| Caching of responses | **None** for chat/tasks. Only caches: translator string cache (2.3), `relayOnlyOrigins`, `anthropicModelMax`, discovered model persisted to settings | `main.jsx:277,914,527` |

### 3.1 Model selection matrix

No task-level model routing exists: every call uses the single stored
provider and its single configured model. The only per-call knobs are
`maxTokens`, `reasoningMode` and `languageMode`.

| Provider | Default model | Model discovery | Per-call model override |
|---|---|---|---|
| `gemini` | `gemini-3.5-flash-lite` (`main.jsx:34`) | no | no |
| `openai` | none — discovery required if unset | `GET /models` → regex pick → persisted (`main.jsx:489-534`) | no |
| `anthropic` | `claude-haiku-4-5` (`main.jsx:35`) | no | no |
| `openai-compatible` | none — discovery or manual | same as openai, at user endpoint | no |
| `anthropic-compatible` | `claude-haiku-4-5` | no | no |

Reasoning-mode by call: gameplay/chat calls inherit the global reasoning
toggle (default ON); only `nextSpeaker` (`gameplay.js:1935`), the diplomacy
planner (`main.jsx:1318`) and translation batches (`translator.js:331`,
`main.jsx:678-684`) request `"fast"` (which also strips gateway reasoning
params for translation). `maxTokens` per call: advisor 8192 (`main.jsx:1352`),
diplomacy 1024/4096/12000 by regex route (`diplomacyRouting.js:41-71`),
planner 256, `nextSpeaker` 256, translation 4096; every structured task
uncapped (see §2.1). The `anthropicModelMax` map (`main.jsx:914`) is the only
model-behavior learning cache.

---

## 4. Offline / build-time AI usage

| Tool | File | Model | Retry | Output | Trigger |
|---|---|---|---|---|---|
| Language-pack generator | `scripts/generate-lang-packs.mjs:57-68` | `OH_LLM_MODEL` against any OpenAI-compatible `OH_LLM_BASE_URL` | 3 per batch, batch dropped on failure (`:104-123`) | `public/lang/<code>.json` (incremental, sorted) | Manual: `node scripts/generate-lang-packs.mjs --lang …` |

Batch size 25 (`:36`), `temperature: 0`, `max_tokens: 4096` (`:61`). API key
read from env only, never logged or written (`:18-19`). This is the only
offline LLM consumer; all other `scripts/**` fetches are map/assets/update
downloads, not AI.

Server-side LLM calls: **none**. The relay (`server/server.js:605`) is a
generic pass-through proxy, not a model caller.

---

## 5. 80/20 ranking — five highest-value fixes

Ranked by expected cost/latency/reliability impact per unit of work. All are
structural observations; none changes architecture (out of scope for this
issue, see §6).

### F1 — Zero observability: no token/usage/cost/latency record on any call

No code reads `usage` from provider responses, no ledger exists, nothing is
logged (only `console.warn` on retries/failures). Every cost question in this
document is therefore answered from code reading, not measurement. This is the
single largest gap versus AC-1 (observable AI call: task, context manifest,
budget, latency, usage/cost record). Evidence: `src/Game/AI/main.jsx`
buffered paths discard the response envelope after extraction (`:637-650`,
`:819-836`, `:1010-1022`); no usage fields anywhere (grep, §3).

### F2 — Reasoning defaults ON for every call, including background work

`getReasoningEnabled()` is true unless the user explicitly set `"0"`
(`providerConfig.js:174`), and `runJsonTask` callers do not override it —
so every jump, action-suggestion, stat-sheet and idle-diplomacy call pays
thinking tokens (Gemini `thinkingBudget: 8192` `main.jsx:574/598`, OpenAI
`reasoning_effort:"medium"` `main.jsx:712`, Anthropic `budget_tokens: 4096`
`main.jsx:961`). Only translation (`reasoningMode:"fast"`, `main.jsx:678-684`)
and the small routing calls (`nextSpeaker`, planner, both `reasoningMode:
"fast"`) are protected. The expensive bulk calls are not.

### F3 — Timeline jump sends the largest context with no output cap and retries the whole payload

Jump prompts include the full bundle plus five large call-time directives
(`gameplay.js:435-504`); `simulateTimelineJump` passes no `callOptions`, so
providers use the model's own maximum output (`gameplay.js:522-532`,
`main.jsx:723-725,951-954`) — plus the retry loop re-sends the identical
body. Worst case per task: 2 output attempts × 3 transport retries = 6
full-body calls (`gameplay.js:521`, `main.jsx:589/676/956`). Latency risk is
also cost risk here; there is no streaming/partial-progress for structured
tasks (buffered only).

### F4 — First-run translation cost spike for non-English players

On first boot in a non-English language (and after each language switch), the
pre-pass enqueues scenario/game catalogs, country names, events, difficulty
labels and hub posts (`translator.js:419-484`), each AI batch is capped at 60
strings and batches run strictly serial (`:28-32`). Every uncached string
costs at least one model call. The server pack (`/api/lang/<code>`) amortizes
across devices but not across fresh installs. High-impact mitigations (static
packs, catalog-only pre-translation) belong to issue #2's audit; this entry
records the cost exposure.

### F5 — Fixed 15 s retry delay without jitter; no deadline on most tasks

`retryDelay = 15000` constant across all providers (`main.jsx:540-541,661-662,
920-921,1031-1032`), and `runJsonTask` defaults to `timeoutMs = 0` — no
deadline unless "Limit AI generation" is on (`gameplay.js:395`). A 429/503
storm from a provider gate (or an overloaded local server) therefore yields
three synchronous 15 s stalls per attempt, blocking the turn; a slow local
model can stall a jump indefinitely by design (documented trade-off,
`gameplay.js:2176-2182`). Exponential backoff + jitter and per-task budgets
would bound both cost and wall-clock.

Secondary findings (recorded, not ranked): idle-diplomacy drip rolls every
minute with a 1/8 chance and carries a full bundle for a one-line note
(`gameplay.js:2424-2437`); high-complexity diplomatic turns make two calls per
message (planner + reply, `main.jsx:1403-1433`); model discovery writes its
pick into settings silently (`main.jsx:527`); frozen per-game prompt packs
mean prompt/schema fixes never reach existing saves — call-time directives
(`gameplay.js:435-504`) are the only channel and accumulate per task; inline
"OUTPUT FORMAT" blocks in frozen task prompts (`defaultPrompts.json` entries
`descriptionToAction`, `eventConsolidator`, `gameMaster`) can drift from the
enforced tool schemas in `gameplaySchemas.js`.

---

## 6. Unknowns and decision boundaries

Explicitly recorded as unknown (not inferred):

1. **Actual token/cost figures** — impossible without F1; no telemetry exists.
2. **Relay authorization** — `/api/ai/relay` (`server/server.js:605`) forwards
   to any http(s) URL; the client only uses it when locally served
   (`main.jsx:274`), but the server route itself has no local-only guard
   visible in this tree. Whether the hosted deployment can expose it is a
   security question for the integration owner: `DECISION NEEDED`.
3. **Provider usage accounting ownership** — the registry/ledger contract is
   issue #3 (`agent:gpt`); this inventory must not choose its architecture.
4. **Whether reasoning-on-by-default should change, and whether jump output
   should be capped** — product/contract decisions, not audit conclusions:
   `DECISION NEEDED` if acted upon.
5. **Doc drift** — `docs/ai-overview.md` states `runJsonTask` always passes
   `maxTokens: 8192`; the code deliberately passes no cap for jumps
   (`gameplay.js:522-532`). This audit trusts the code; the doc should be
   reconciled by its owner.

---

## 7. Verification

- `git diff --check` clean.
- Repeat searches used for accounting: `callAI|runJsonTask|providerFetch|
  relayFetch|directFetch` → all matches in `main.jsx`/`gameplay.js`/
  `translator.js`; `generativelanguage|api.openai.com|api.anthropic.com|
  /api/ai/relay|chat/completions|v1/messages` → only the rows in §1;
  `process.env.*LLM` → only `generate-lang-packs.mjs`; `submit_` tool names →
  only `gameplaySchemas.js:777-871`; all `GAMEPLAY_SCHEMAS` keys have a
  matching tool and a prompt-pack entry.
