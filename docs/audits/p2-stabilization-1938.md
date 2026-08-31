# P2 stabilization report — Central European Crisis, 1938

Date: 2026-08-31. Scope: feature freeze; no P3 mechanics.

## Scenario under test

- Existing `scenario-dev-map-4c`, updated in place.
- Start: `1938-01-01`; four independent polities and 47 regions.
- Explicit alternate-history divergence: Slovakia became independent in 1937.
- All economic values remain synthetic development-test balance, not historical statistics.
- No authored war, Anschluss, occupation or automatic territorial transfer.

The regression test pins SHA-256 hashes for the complete region array, economy
coefficients, starting resources/stockpiles and the byte content of
`map-link.json`. This ensures the contextual rewrite cannot silently rebalance
the economy or alter map linkage.

## Deterministic soak result

The ten monthly ticks finish at `1938-11-01`, engine turn 10 and product round
11. The accepted chain is checked in as
`packages/engine/test/golden/p2-stabilization-010.checksums.json`; the per-turn
date, round, tick count, engine revision, command, treasury, population,
stockpiles, infrastructure, production, tax and region count are in
`p2-stabilization-010.report.json` beside it.

The browser soak creates `p2-stabilization-1938` and a second clean replay
game. It verifies 10 commits per game, stale-session and foreign-investment
rejections without a revision change, reload recovery after turns 3/6/10, and
runtime/map/economy agreement. After the manual typed transfer of Upper Austria,
Austria owns 8 regions and Germany 17. The two games finish with the same engine
revision and byte-equivalent engine state; their session revisions differ
because `gameId` is session metadata.

## Defects found during stabilization

1. **Fixable in freeze — browser test isolation.** Economy specs shared the
   product's single active-game runtime pointer and raced when Playwright ran
   files concurrently. The test configuration now uses one worker, matching the
   runtime contract and preventing mixed-game overlay assertions.
2. **Fixable in freeze — implicit model call risk.** A fresh scenario with only
   `startingTimelineText` could trigger automatic AI-authored pregame history
   when a key was configured. The 1937 Slovak divergence is now an authored
   scenario event, so entering this scenario performs no model call and the
   historical premise remains Scenario Law (Principles 1 and 4).

No crash, data loss, mixed revision or incorrect economy result was observed in
the completed deterministic runs.

## Gemini smoke

`tests/e2e/gemini-smoke.spec.js` is opt-in through `GEMINI_API_KEY`, fixes the
model to `gemini-3.5-flash-lite`, disables reasoning and disables trace,
screenshot and video capture. It checks an Austrian advisor answer in Russian,
three diplomatic counterparts, state immutability after textual negotiation,
the absence of a model call during the manual engine transfer, and German
awareness of the transferred region afterward. Normal CI skips this test and
therefore makes no paid or live model calls.

The live smoke was not executed in this run because `GEMINI_API_KEY` was absent.

## Explicitly deferred to P3

- executable diplomatic agreements and AI-issued transfers;
- AI opponent investment and other numeric commands;
- war, occupation and automatic territorial capture.

These are scope exclusions, not P2 defects (canon 00 and canon 04).
