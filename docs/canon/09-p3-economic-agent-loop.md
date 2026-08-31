# 09 — P3a economic agent loop

Status: accepted by the owner 2026-08-31. This is the first vertical slice of
P3, not the completion of diplomacy.

## Preconditions

- P2 Central Europe is green and remains the four-polity, 47-region product
  scenario.
- The architecture must support 50–100 actively simulated polities without
  adding them to the current map.

## Deliverables

- Existing Actions prose is interpreted into validated
  `economy.invest-region` commands. The Actions composer and list keep their
  existing presentation; confirmation lives in the time-jump overlay.
- The same composer remains the game's unified free-text surface. Read-only
  economy report/advice requests are routed to a narrator over a bounded
  engine projection and published in the turn trace; they never mutate state.
  Actions for unavailable modules remain visibly unsupported rather than
  silently disappearing or fabricating effects.
- Confirmation is required only when at least one typed command can mutate
  state. Report-only requests execute at the current date without incrementing
  the round; unavailable-only requests cannot be confirmed and do not commit a
  revision. Player-visible generated text follows the selected UI locale.
- Every polity receives every deterministic monthly tick. At most 24
  non-player polities receive a new strategic decision per month, packed into
  at most two interactive model calls of 12 polities each.
- Selection is deterministic: material triggers first, then the polities whose
  accepted strategy is oldest, with polity id as the final tie-breaker.
- A failed opponent batch uses a deterministic investment-preview fallback.
  A failed player interpreter never mutates state.
- Multi-month jumps plan and resolve one month at a time but publish one atomic
  game session revision and increment the player-facing round once.

## Contracts

- AI receives an engine-built bounded brief, not the map, geometry, raw state
  or unbounded history. A polity brief is at most 1,600 characters and a batch
  at most 24,000 characters.
- AI output is a strict typed proposal. It cannot emit transfers, starting
  facts, authoritative totals or numeric outcomes. Every interactive command
  carries the exact engine revision and effective month from its brief.
- The scheduler state and complete accepted turn trace are atomic projections
  in engine-session v2. V1 sessions remain readable and upgrade on first P3
  commit.
- Existing economy APIs remain compatible. Agent turns use prepare, step and
  commit endpoints, all guarded by session compare-and-swap.

## Difficulty

Difficulty changes information and command budget, never engine coefficients:

| Level | candidates | history | non-null command budget |
|---|---:|---|---:|
| very-easy | 4 | current month | ceil(batch / 3) |
| easy | 6 | current month | ceil(2 × batch / 3) |
| medium | 8 | current + previous | every decision |
| hard | 10 | three-month trend | every decision |
| very-hard / impossible | 12 | trend + expanded previews | every decision |

## Acceptance criteria

- A synthetic 100-polity/300-region test runs twelve months; every polity
  ticks, no month creates more than two model tasks, and every opponent is
  selected within five months without triggers.
- Invalid/missing model output, stale writers, cancellation and reload never
  expose a partial world. Recorded decisions replay byte-identically with zero
  model calls.
- P2 goldens remain byte-identical. P3a adds a separate recorded decision
  chain and mocked Playwright flow. Live Gemini smoke is opt-in only.

## Not doing

- No new map countries or regions.
- No AI region transfers, wars, annexations or automatic captures.
- No executable diplomacy, relations or agreements; those complete P3 in P3b.

## Open questions

None for this slice.
