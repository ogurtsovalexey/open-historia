# Runtime Translation Audit — Static Strings That Still Pay for AI

Status: Draft — evidence-based audit, not an implementation plan.
Scope: how the live (runtime) UI translator consumes AI calls, which of those
strings are static enough to stop consuming them, and how removal
opportunities rank by impact and risk.

Base SHA: `365bbe59376ce6ccf61548c636822fdc909a2c33` (`private/main`).
Writable: this file only. Read-only paths followed: `src/runtime/**`,
`src/Game/**`, `server/**`, `scripts/i18n/**`,
`scripts/generate-lang-packs.mjs`.

**Functional role: AI Engineer** (per issue role assignment). This audit is
written from the prompt / schema / validation / model-selection perspective:
the translation prompt contract, batch alignment discipline, and the
prompt-vs-pack drift between the offline pack generator and the runtime
translator. The owned-path and decision boundaries are unchanged.

---

## 1. The translation pipeline, traced end to end

Every stage of live translation behavior, with evidence.

### 1.1 Boot and language resolution

`startTranslator()` runs immediately after React mounts
(`src/main.jsx:24`). Boot order inside it (`src/runtime/translator.js:597-650`):

1. `syncLanguageFromServer()` fetches `GET /api/ui-settings`
   (`src/runtime/i18n.js:116-137`); if the server's language differs from
   localStorage, the page reloads so the translator restarts cleanly
   (`translator.js:605-609`).
2. If the stored language is English, everything stops — no translator work
   at all (`translator.js:611-614`; English is the authored language,
   `i18n.js:6-8`).
3. `document.documentElement.lang` is set and RTL languages get
   `body.style.direction = "rtl"` — text direction only, layout is not
   flipped (`translator.js:616-621`, RTL set `i18n.js:71`).
4. `loadCache()` reads localStorage `i18n_cache_<lang>`
   (`translator.js:94-103`, key `:26`, cap 8000 `:27`).
5. `loadServerPack()` fetches `GET /api/lang/<code>` and merges the pack
   into the cache (`translator.js:566-581`). The server merges shipped +
   saved packs, saved wins (`server/server.js:202-208`); the web build
   mirrors this with a static pack fetch + IndexedDB overlay
   (`src/runtime/web/settingsStore.js:24-51`).
6. The translator waits for the startup screen to leave the DOM (or a
   180 s cap) before touching anything
   (`translator.js:583-595`, `src/runtime/StartupScreen.jsx:398`).
7. A `MutationObserver` on `document.body` is installed
   (`translator.js:632-637`), then a full-DOM `scan()` (`:244-262`), then
   the one-time pre-translation pass (below).

### 1.2 Pre-translation pass (one-time per language)

`collectCatalogStrings()` (`translator.js:419-484`) gathers "everything the
game could show" and queues any string not already in the pack/cache:

| Source | Evidence | Static or dynamic |
|---|---|---|
| Scenario cards via `GET /api/scenarios` | `translator.js:434-442` | shipped presets static; community/imported cards dynamic |
| Game cards via `GET /api/games` | `translator.js:434-442` | player saves — dynamic |
| Country names via `loadCountryNames()` (countries.pmtiles z0 layer) | `translator.js:447`, `src/runtime/assets.js:966-985` | static (map data) |
| World `polityOverrides` names + aliases | `translator.js:448-452` | scenario-authored — static per scenario |
| Event titles/descriptions from `JSON_URLS.events` | `translator.js:453-456`, `assets.js:267` | current game's events — AI-generated, dynamic |
| Difficulty labels + blurbs | `translator.js:463-469` | static |
| Community-hub post titles/descriptions | `translator.js:472-478` | user-authored — dynamic |
| Region catalog | **explicitly excluded** `translator.js:480-484` | static, thousands of names |

Queuing is cache-gated: `add()` skips anything `cache.has()` covers
(`translator.js:420-426`), so pack-covered strings cost nothing at runtime —
the pack is the *only* static/dynamic boundary the runtime knows. The runtime
**never reads `catalog-en.json`**; its notion of "already translated" is the
merged pack from `/api/lang/<code>`.

### 1.3 Lazy DOM translation (MutationObserver)

`handleMutations` (`translator.js:276-291`) visits new text nodes and
sub-trees; cached translations are applied **synchronously** so panels open
translated (no English flash), and only unknown strings are queued for AI via
the debounced scan (350 ms, `:33`, `:264-271`). Attribute values
(`placeholder`, `title`, `aria-label`) are covered too
(`:35`, `:192-208`). Opt-outs: `SKIP_SELECTOR`
(`script, style, noscript, input, textarea, [contenteditable], [data-no-translate]`,
`:41`) plus explicit `data-no-translate` markers (`settings.jsx:124`,
`chat.jsx:209`, `advisor.jsx:425`, `stats.jsx:118`, `time.jsx:1016`).

Text drawn outside the DOM (map country labels) goes through
`translateLabel` (`translator.js:493-507`, callers `countryLabels.js:499`,
`Nations.jsx:553`) — synchronous cache hit or queued for later, with an
`i18n:updated` event so labels rebuild (`translator.js:87-92`,
`Nations.jsx:507`). Proactive callers: `enqueueStrings`
(`communityHub.jsx:511`) and `enqueueContentStrings` for written game
content (`translator.js:531-560`, called from `gameState.js:1140,1164`,
`library.js:205,215,355,365`).

### 1.4 The AI call itself

`translateBatch` (`translator.js:311-341`):

- Late-imports `callAI` (`src/Game/AI/main.jsx`) — the same gateway as
  gameplay calls (`translator.js:314`).
- Prompt: "translate each English string in the user's JSON array", ordered
  array out, preserve numbers/dates/emoji/placeholders, keep names in their
  standard target-language forms (`translator.js:317-325`).
- `maxTokens: 4096`, `languageMode: "none"`, `reasoningMode: "fast"`
  (`translator.js:330-332`). Note: `"fast"` is only honored by the
  OpenAI-style caller — Gemini and Anthropic ignore `reasoningMode` (see
  issue #1 audit, §F2: `main.jsx:536-544`, `:916-924`), so translation
  batches pay full thinking budget on those providers.
- Response parsing: `extractJsonArray` (`translator.js:295-309`); batches of
  up to 60 strings (`BATCH_SIZE`, `:28`), **strictly serial**
  (`MAX_CONCURRENT_BATCHES = 1`, `:32`) so background translation cannot
  occupy provider request slots ahead of gameplay.
- Validation discipline: array length is not enforced; results are filled
  **by index** and a missing/blank slot falls back to the source English
  string silently (`translator.js:371-379`). No per-item language check is
  applied to results (the `looksLikeTargetLanguage` script heuristic is used
  only to *skip* queueing, `translationFilter.js:28-43`).

The offline pack generator (`scripts/generate-lang-packs.mjs`) is stricter:
wrong-length batches are rejected outright and retried
(`generate-lang-packs.mjs:110-114`), batch size 25, temperature 0
(`:36,:61`), 3 retries (`:37,:104-123`). Its system prompt differs
materially from the runtime one: it emphasizes endonyms, short button-sized
translations, placeholder preservation, and — critically — that country and
polity names **must be localized** (`:82-99`), a lesson encoded after the
first German pack came back 56% English. The runtime prompt's name rule
("standard forms when they exist; otherwise keep unchanged") is weaker but
covers the same ground. This is a known prompt pair, not drift: the two
prompts are maintained side by side in their own files and both are in
scope for this audit's owner.

### 1.5 Caching and server synchronization

- Local: `i18n_cache_<lang>` in localStorage, last 8000 entries survive
  (`translator.js:26-27`, `:105-115`); persisted 1.5 s after each batch.
- Server: new translations are pushed debounced (2 s) as
  `PUT /api/lang/<code>` `{ entries }` (`translator.js:68-84`); server caps
  source ≤ 3000 / translation ≤ 6000 chars and merges into
  `server/data/lang/<code>.json`, which survives updates
  (`server/server.js:175-236`, caps `:223-224`).
- Web build: the same GET/PUT via IndexedDB overlay
  (`settingsStore.js:44-78`); the shipped pack is fetched from
  `<BASE_URL>lang/<code>.json` with `cache: "force-cache"`
  (`settingsStore.js:24-39`).
- Net effect: on desktop, **one device per server** pays for a given
  language's missing strings and every later device reuses them; on the web
  build each browser has its own IndexedDB overlay, so **every browser** pays
  (localStorage `i18n_cache_` helps repeat sessions on the same browser).

---

## 2. Static vs dynamic content separation

The runtime makes **no** static/dynamic distinction: every unknown string
that passes `shouldTranslateUiText` (`translationFilter.js:37-43`: 2–2999
chars, at least two Latin letters, not already a known translation, not
majority target-language script) costs one batch slot. The separation that
does exist lives entirely in **pack coverage** — a string is free at runtime
iff the merged pack contains it. So the question "what static content still
consumes runtime AI?" reduces to: *what is static, rendered, and missing
from the shipped packs?*

### 2.1 The shipped pack pipeline (offline, static)

`scripts/i18n/build-catalog.mjs` collects English seed strings into
`public/lang/catalog-en.json` (583 strings):

- `UI_STRINGS` — a hand-maintained list of fixed interface strings
  (`build-catalog.mjs:15-75`, ~159 entries);
- preset scenario card fields from `scripts/presets/*.spec.mjs`
  (`build-catalog.mjs:77-89`);
- difficulty labels/blurbs (`build-catalog.mjs:91-94`);
- country names from the countries.pmtiles z0 layer
  (`build-catalog.mjs:96-102`, `loadCountryCatalog` in
  `scripts/presets/lib/regionCatalog.mjs:77-83`).

`scripts/generate-lang-packs.mjs` translates that catalog into
`public/lang/<code>.json` offline. It currently has 22 target languages
(`:41-47`), while the game offers **50** (`i18n.js:18-69`): 27 non-English
languages ship **no pack at all**.

### 2.2 Genuinely dynamic content — must keep consuming runtime AI

1. **AI-generated game text**: event titles/descriptions, polity names,
   action suggestions, GM output — all arrive in English from the simulation
   and are queued via the observer and `enqueueContentStrings`
   (`gameState.js:1140,1164`, `translator.js:531-560`).
2. **User-authored content**: community-hub posts
   (`communityHub.jsx:511`), imported scenario/game cards, edited
   descriptions (`library.js:205,215,355,365`).
3. **Map labels for renamed/new polities** (`translateLabel`,
   `countryLabels.js:499`, `Nations.jsx:553`).
4. **Chat replies** — *mostly* excluded already: replies arrive natively in
   the chat language via `languageDirective`/`chatLanguageDirective`
   (`i18n.js:171-201`), player messages and `asWritten` replies are marked
   `data-no-translate` (`chat.jsx:209`, `advisor.jsx:425`), and the skip
   logic is deliberate (`advisor.jsx:220-223`). Residual lazy translation of
   chat text is rare by design (`translator.js:14-15`).

### 2.3 Static content that currently leaks into runtime AI

**L1 — Static UI strings missing from `UI_STRINGS`.** The list is a frozen
hand-maintained snapshot with no verification against the components. Spot
checks found rendered, static strings absent from `catalog-en.json`
(verified programmatically):

- Settings: "Gemini API Key" / "OpenAI API Key" / "Anthropic API Key" /
  "API Key (optional)" (`settings.jsx:444,472,504,544,579`), "Search
  provider, protocol or gateway..." (`:306`), "Nothing matched the search."
  (`:361`), "Active" (`:347`), "Model" (`:452`), "Custom parameters (JSON)"
  (`:459`), "Leave blank to use the built-in Gemini default." (`:456`).
- Chat: "Start New Diplomatic Chat" (`chat.jsx:375`), "Cancel response"
  (`:669`), "Speak" (`:682`), "Start New Chat" (`:1019`).
- Cheats: "Roll back" (`cheats.jsx:472`), "Annex into" (`:556`), "Owner"
  (`:725`), "No events yet." (`:965`).
- Time control: "Fallback" (`time.jsx:673`).

Every one of these costs a runtime AI call for the first device per server
(desktop) or per browser (web) in every language, forever, unless a device
translates it into the saved pack. "Stored only in this browser." is in the
catalog; a dozen of its neighbours in the same dialog are not — evidence the
list simply went stale.

**L2 — 27 languages with no shipped pack.** Every catalog string (583) plus
all L1 gaps pay full runtime cost in those languages. Worst case for a cold
first boot in e.g. Hindi: roughly the catalog + L1 + scan finds ≈ 600+
strings → ~10 serial batches (60/batch, `translator.js:28`) plus whatever
the game generates. The offline generator supports arbitrary
OpenAI-compatible endpoints (`generate-lang-packs.mjs:29-31`), so extending
it to all 49 non-English languages is a pure offline cost.

**L3 — Shipped-preset world content not in the catalog.** The pre-pass reads
scenario `polityOverrides` names/aliases and event titles/descriptions
(`translator.js:448-456`), and scenario-specific country-name overrides flow
through `resolveCountryNameOverride` (`scenarios.js:32-63`). The catalog
builder collects only card fields (`build-catalog.mjs:77-89`) — preset
world strings are static per scenario but are translated at runtime, once
per server/browser per scenario.

**L4 — Catalog/pack verification gap.** Nothing at build or test time
asserts that every static string a component renders is in
`UI_STRINGS`, nor that shipped packs are complete against the catalog.
String drift (L1) therefore recurs silently; there is no regression signal.

Note the non-leaks, for completeness: country names on the map resolve to
the same pmtiles source the catalog uses, so pack keys match unless a
scenario overrides them (`assets.js:966-985` vs `regionCatalog.mjs:77-83`);
difficulty labels share one source (`difficulty.js` imported by both
`build-catalog.mjs:91-94` and `translator.js:463-469`); regions were
deliberately excluded from the pre-pass and rely on packs/lazy translation
(`translator.js:480-484`).

---

## 3. Ranking — removal opportunities by impact and risk

Ranked by expected reduction in runtime AI calls per unit of work. None
changes translation behavior or architecture (decision boundary, §5).

### R1 — Ship packs for the remaining 27 languages (highest impact, lowest risk)

Offline-only: extend the `LANGUAGES` table in `generate-lang-packs.mjs:41-47`
to the full 49-code list from `i18n.js:18-69` and run it. Eliminates the
entire first-boot runtime cost for those languages (L2): hundreds of calls
per language, per server/browser. Risk: none at runtime (packs are static
files; missing packs already fall back gracefully,
`settingsStore.js:34-36`, `server.js:196-200`). Cost: one offline generation
pass per language — the same model calls, paid once at build time instead of
once per server/browser forever.

### R2 — Refresh `UI_STRINGS` to actual rendered strings (high impact, low risk)

Bring `build-catalog.mjs:15-75` back in sync with the components (the L1
list above is the concrete delta), regenerate the shipped packs. Kills the
per-server/per-browser runtime calls for every static settings/chat/cheats
string in all 22 packed languages today. Risk: low (catalog-only change;
packs regenerate incrementally, `generate-lang-packs.mjs:129-130`). The
hand-maintained list remains fragile without R4.

### R3 — Fold shipped-preset world strings into the catalog (medium impact, low–medium risk)

Collect scenario `polityOverrides` names/aliases, country-name overrides and
preset event titles/descriptions into `catalog-en.json` the way card fields
are collected today (`build-catalog.mjs:77-89`), keyed by exact string.
Safe because matching is exact-string, so community/AI content simply never
matches. Impact is per-scenario: one-time cost per server/browser per
shipped preset instead of every one. Risk: preset world files are JSON
adjacent to the spec files, so collection is straightforward; the main risk
is catalog bloat (cosmetic).

### R4 — Catalog completeness check at test time (medium impact over time, low risk)

A `node --test` check (same runner as `translationFilter.test.js`,
`package.json` "test") that extracts statically rendered strings from
`src/Game/GameUI/**` and fails when one is absent from `catalog-en.json`.
This is the regression signal that would have caught L1. Impact: prevents
every future static string from silently becoming a per-server/per-browser
AI cost. Risk: false positives on computed text need an allowlist
(`data-no-translate` markers are a natural exemption, `translator.js:41`).
This is a *test*, not a runtime change, so it is within this audit's
recommendation space.

### R5 — Batch-size parity between the two pipelines (low impact, low risk)

Runtime batches 60 strings per call with no length check on the output
(`translator.js:28,:371-379`); the offline generator chose 25 explicitly
because large batches drift out of alignment (`generate-lang-packs.mjs:33-35`)
and rejects misaligned batches. The runtime's silent index-fill fallback
(`translator.js:371-379`) means a drifted batch costs an extra call later
(the wrong pairings land in cache and get re-translated), but the 60-size is
a deliberate serial-throughput trade-off (`translator.js:29-32`). Recorded
as an observation; changing either constant is an implementation decision
for the pipeline owner, not this audit.

Not recommended: any runtime change that would gate the observer or
pre-pass on catalog membership ("skip strings in catalog-en.json"). That
would require the runtime to ship and consult the catalog, i.e. a new
architecture for the static/dynamic split — out of scope (§5).

---

## 4. Tests and failure modes

### 4.1 Existing test coverage

- `src/runtime/translationFilter.test.js` (run via `node --test`,
  `package.json` "test"): 4 tests — Cyrillic text with an English brand is
  already Russian (`:6-10`); English source still translates (`:12-14`);
  known translated values are never re-queued (`:16-18`); numbers/glyphs/
  dates are skipped (`:20-23`). That is the **entire** i18n test surface.
- Untested: the translator lifecycle (boot, pack merge, persistence),
  `extractJsonArray`, batch failure/cooldown, server pack merge
  (`server/server.js:202-236`), the web overlay
  (`settingsStore.js:44-78`), and any catalog-completeness property (L4).

### 4.2 Failure modes (how each degrades)

| Failure | Behavior | Evidence |
|---|---|---|
| Batch reply not a JSON array | Batch errors; strings stay pending; 3 consecutive batch failures → 60 s cooldown, English remains | `translator.js:336-338`, `:382-397` |
| Misaligned batch length | Silent index-fill; blank slot falls back to **source English** string | `translator.js:371-379` |
| Provider unavailable at boot | Server pack fetch fails → localStorage cache only | `translator.js:566-581` |
| Server unreachable on save | Translations stay device-local | `translator.js:80-82` |
| localStorage full/blocked | Translations work for the session only | `translator.js:111-113` |
| String ≥ 3000 chars | Never queued — long descriptions stay English forever | `translationFilter.js:39` |
| Oversized entries | Server silently ignores source > 3000 / translation > 6000 | `server.js:223-224`, `settingsStore.js:63-66` |
| Startup screen never disappears | 180 s cap, then translation proceeds | `translator.js:588` |
| Language switch mid-flight | `stopTranslator` + reload restarts cleanly | `translator.js:652-658`, `settings.jsx:158-163` |
| RTL language | Text direction flips; layout deliberately does not (fixed-position map UI) | `translator.js:616-621` |

Non-failures worth recording: cache writes are debounced so translation can
never block the turn (`translator.js:29-32`), and English is a full no-op
path (`translator.js:611-614`).

---

## 5. Decision boundaries

Not decided here (escalate as `DECISION NEEDED` if acted upon):

1. **Whether packs for all 49 languages should be shipped** — R1 is a
   build-cost/product trade-off (offline generation expense vs every-player
   runtime expense), not an architecture change.
2. **Whether the static/dynamic split should move into the runtime**
   (e.g. shipping `catalog-en.json` to the client and gating translation on
   it) — that is a replacement architecture for the pack mechanism, out of
   scope per the issue.
3. **Whether `UI_STRINGS` should stay hand-maintained or be extracted from
   components at build time** — extraction changes the build pipeline;
   R4 (test-time check) is the non-invasive alternative.
4. **Prompt alignment between the runtime translator and the offline
   generator** — both are live and both are in this audit's read-only
   scope; unifying them is a prompt-owner decision.

---

## 6. Verification

- `git diff --check` clean; only `docs/audits/runtime-translation-audit.md`
  changed.
- String-membership claims were checked with a script against
  `public/lang/catalog-en.json` (583 entries): the L1 strings above are all
  absent, "Stored only in this browser." is present.
- Language counts verified from source: 50 in `i18n.js:18-69`, 22 targets
  in `generate-lang-packs.mjs:41-47`, 22 pack files in `public/lang/`, all
  22 packs complete at 583 entries.
- Traces re-verified against the cited files at the base SHA.
