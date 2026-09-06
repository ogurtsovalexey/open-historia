# Europe 1935 — ten-turn UI playtest

Date: 2026-09-06  
Scenario: `scenario:europe-1935-benchmark`  
Player: Poland (`polity:poland`)  
Difficulty: Medium  
Save: `europe-1935-1940-benchmark-session-3`

## Result

Poland was selected through the visible scenario picker and played exclusively
through the living-world UI from `1935-01-01` to `1937-07-01`: ten player
decisions and thirty deterministic monthly boundaries. Each decision used
**Advance three months** and displayed `3 / 3 monthly boundaries resolved`.
No direct gameplay API, filesystem edit, cheat, or strategic-skip path was
used.

The first Orders intention opened consultations with France about Poland's
security guarantees. The provider resolved the affected actors to Poland and
France, without authoring a numeric effect. The independent final audit
contains both a canonical diplomatic-proposal evidence item and its acceptance.
The final visible **Why?** disclosure showed the latest calendar transition and
24 grounded sources.

After the ten-turn loop, the same UI session also tested the required false
retrospective claim: “Poland annexed East Prussia ten turns ago and mobilized
two million soldiers.” The preview separately contradicted the conquered-region
and fielded-personnel assertions, citing 13 grounded sources for each. Its
confirmation created no process, mobilization or diplomatic proposal. The
read-only post-claim audit retained `1937-07-01`, turn `30`, decision index
`10`, and the identical world revision below, proving that untrusted prose
cannot rewrite territory or army figures.

The UI then accepted “Begin a bounded investigation into electricity using
current Polish capacity” only as a new proposed, multi-stage process. The
preview gave an engine-derived 440 treasury commitment and contextual
resistance to acceleration. Its post-confirmation audit records one process
(`process:f9219d39c18e7153a1bddace`) at steady pace with funding 440, and no
instant technology outcome or model-authored numeric effect.

## Independent audit

```text
npm run playtest:audit -- --game europe-1935-1940-benchmark-session-3 \
  --data-dir test-results/live-playtest-data --output /tmp/europe-wp15-audit.json
```

| Field | Value |
| --- | --- |
| Date / engine turn | `1937-07-01` / `30` |
| Player decision index | `10` |
| World revision | `sha256:96fcda4962cb71a942aea6ba10ca002c75521180edde5475db490a4b4fac36d6` |
| Replay checksum | `sha256:1c3f7c1abebe63c72a94746effbc9323bad990cd8074f3b6d724eb8b0094d6b4` |
| Audit checksum | `sha256:f2a4c5bd2fd307ccd6a17d3f235507e71c2d33f979049dabec73bac4546006c6` |

The export contains only sanitized `codex-subscription / gpt-5.6-luna / low`
Utility and Strategic provenance, never raw provider prompts or responses.
