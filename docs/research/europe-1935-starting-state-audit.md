# Europe 1935 starting-state audit

Status: diagnostic gate implemented; replacement data is not yet owner-approved.

The production historical compiler and monthly engine now generate the same
starting-state checkpoint used by tests and by the local owner table. The
checked-in `first-month-baseline.json` records national opening/closing
population, production by resource, tax, food consumption, treasury and
closing stockpiles for the no-action January 1935 turn. Its checksum is
`sha256:209d64e8a4e25fac211aa5343f276f4da1f3fa7fb4c19e5f1fad6cff9b09d9a1`.
Future regional replacements must reproduce this aggregate rather than compare
their post-action state with the old pre-tick state.

Run:

```sh
npm run starting-state:europe-1935
```

The command writes ignored local artifacts to
`runs/campaign-lab/europe-1935-starting-state-checkpoint/`. The JSON audit and
Markdown table are deterministic and carry an audit checksum. They are
diagnostic inputs, not an approval by themselves.

## Current gate result

- Seven Supported and two Baseline polities are classified correctly.
- All nine existing national population, workforce, capacity, treasury and
  stockpile controls match their engine aggregates exactly.
- The existing first aggregate month matches the pinned baseline exactly.
- The gate reports 61 blocking rows. These include one region instead of
  10–25 for every Supported polity, missing Saar and Danzig, zero formations
  and commanders, one rather than 2–4 goals, and absent governments, factions,
  finance, projects, intelligence, capabilities and identity inputs.
- The Czechoslovak–French and Polish–French security relationships already
  present in authored causal anchors have no executable starting agreements.
  Their simultaneous active `secure-alliance` goals are therefore explicitly
  reported as cross-module contradictions.
- Content version `0.1.0` remains blocked until the incompatible replacement
  package is complete. Raising it early would falsely advertise readiness.

The commitment rows are expectations derived only from named scenario anchors;
they do not invent runtime facts. Exact agreement terms and all new political,
military and statecraft values still require sourced authoring and owner review
under Principle 1.
