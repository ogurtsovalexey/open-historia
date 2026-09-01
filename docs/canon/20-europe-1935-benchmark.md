# 20 — Europe 1935 benchmark

Status: accepted benchmark contract, 2026-09-01.

## Scope

`scenario:europe-1935-benchmark` runs from 1935-01-01 through the soft horizon
1940-07-01. Supported polities are Germany, Austria, Czechoslovakia, Poland,
France, the United Kingdom and Italy. The USSR and USA are explicitly
approximate Baseline external powers represented by strategic macro-regions,
capabilities, trade and constraints. This exception is benchmark-specific and
does not reopen canon 00's default requirement that bounded gameplay worlds
simulate their active polities honestly.

Colonies, full fleets and distant theatres are out of scope. The existing 1938
development fixture is immutable.

## Conditional history

Authored interests, threats, obligations, red lines and causal anchors inform
brief relevance only. Each anchor declares applicability conditions and
invalidators. It never fires an event or writes state. Significant divergence
must invalidate the historical comparison and cause the strategic brief to
change course.

The evaluation-only milestones are Rhineland remilitarization (15), Anschluss
(20), Czechoslovak crisis/dissolution (20), German–Soviet partition of Poland
(25), and French defeat/capitulation by the horizon (20). An invalidated
milestone is reported, not scored as an engine event.

## Matrix and freeze

The lab defines historical, alternative and free strategies for each of the
seven Supported polities: 21 runs total. Alternatives are the strategy lines
listed in the benchmark package. Free goals are chosen from the initial
canonical brief. Run manifests record whether choices are consistent, risky or
mistaken; these labels do not enter the scenario.

Once the first matrix run begins, scenario checksum, code revision, model and
parameters are frozen for the entire matrix. Problems are recorded and fixed
only after the matrix completes.

### Free-tier live profile (`free10`)

The canonical 21-cell mocked/infrastructure matrix remains available. The
quota-bounded live evaluation uses a separately named ten-cell profile:

- Germany, Poland and France: historical, alternative and free;
- United Kingdom: historical only.

Austria, Czechoslovakia and Italy remain fully simulated opponents but are not
player cells in this profile. Run ids and committed aggregate artifacts carry
the `free10` name so they cannot be confused with the earlier 21-cell mock
baseline. The profile uses only `gemini-3.5-flash-lite`,
`thinkingLevel=minimal`, a 490-attempt Pacific-day safety ceiling and the
Campaign Lab preflight/freeze contract in canon 18.

## Acceptance

All 21 runs are complete or explicitly terminal; every run has a chronicle,
final card and revision-linked evidence. The aggregate report compares the
three strategies, territorial/government/diplomatic/economic/military outcomes,
event frequencies, causal chains, AI failures, balance and missing mechanics.
Historical median score targets 70/100, and at least 80% of auditable invalidated
anchors cause a changed strategy. Live targets are benchmark results, not unit
test gates; absence of credentials must be reported rather than fabricated.
