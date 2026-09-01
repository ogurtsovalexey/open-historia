# 17 — P8 justified depth: executable alliance obligations

Status: implemented and verified, 2026-09-01.

## Why this depth is justified

Gate C exposed one direct break in the playable loop: defensive alliances and
guarantees are canonical agreements, but currently have no executable effect
when their beneficiary is attacked. This makes diplomacy strategically hollow.
Closing that gap is smaller and more valuable than adding full markets,
currencies or migration without playtest evidence.

## Contract

- A validated declaration of war deterministically creates at most one pending
  call to arms per obligated polity. Defensive alliances are reciprocal;
  guarantees protect `toPolityId` by calling `fromPolityId`.
- Calls are created only for the defensive side. Offensive wars never invoke a
  defensive obligation. The source agreement IDs are recorded and sorted.
- The called polity explicitly accepts or refuses. Acceptance joins it to the
  defenders of the existing war; it never creates a second war. Refusal is
  legal, closes the call and reduces trust with the defended beneficiary.
- Pending calls expire when the war ends. A polity already fighting on the
  opposite side cannot accept. IDs, sides and participant arrays are validated,
  deduplicated and stably sorted.
- Player responses are material commands and require confirmation. Strategic
  AI sees only calls addressed to its actor plus the already bounded public war
  brief. No model chooses numeric penalties or edits belligerent arrays.
- Old military states may omit `callsToArms`. The field appears on the first
  real military update, preserving readable pre-P8 sessions.

## Acceptance

Engine, AI and browser tests cover reciprocal alliance calls, directional
guarantees, accept/refuse/expiry, trust effects, stale/foreign/conflicting
responses, byte-identical replay and explicit player confirmation. Full
markets, currencies, inflation and migration remain deferred.
