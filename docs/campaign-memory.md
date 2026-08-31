# Durable Campaign Memory

Open Historia keeps narrative history in recent event excerpts and consolidated
summaries. `campaignMemory` adds a second, structured layer for facts that must
remain causally binding after their source events leave the recent window.

## Stored shape

`world.json` contains:

```json
{
  "campaignMemory": {
    "version": 2,
    "facts": [{
      "id": "treaty-1810",
      "category": "treaty",
      "statement": "France and Russia guarantee the 1810 settlement.",
      "parties": ["France", "Russia"],
      "status": "active",
      "sinceDate": "1810-04-12",
      "endedDate": "",
      "evidenceIds": ["event-1810-settlement"],
      "entityRefs": ["FRA", "RUS"],
      "domains": ["diplomacy"],
      "salience": "major",
      "causedBy": [],
      "createdRound": 8,
      "updatedRound": 8
    }]
  }
}
```

Categories cover alliances, treaties, wars, promises, debts, grievances,
occupations, regime/leader changes, territorial facts, policies, trade,
relationships, crises and explicit divergences from real history. Status is one
of `active`, `broken`, `resolved`, or `superseded`.

`entityRefs` holds validated stable polity/person/faction ids. `domains` is a
non-empty subset of `economy`, `diplomacy`, `dynasty`, `politics`, `war`, and
`other`; `salience` is `minor`, `material`, `major`, or `critical`. `causedBy`
may reference an existing fact or an evidence item from the current extraction
batch. These fields are relevance metadata, not authoritative state or numeric
effects.

## Evidence and update rules

The event consolidator returns `memoryOps` alongside its narrative `summary`.
It never replaces the complete fact list. `upsert` creates or refreshes one
fact; `resolve` closes an existing fact by its stable id.

Every new or changed operation must cite an event, closed chat, or resolved action id from the
exact batch being consolidated. `applyCampaignMemoryOps` filters citations
against that batch. A new fact with no valid evidence is discarded; resolving
an unknown id, using an unknown entity/cause reference, or changing a fact
without current evidence is also discarded. Prior evidence
and completed facts remain stored, so a later weak model response cannot erase
them by omission.

The consolidation renderers expose ids only on the extraction call. Normal
player-facing history remains unchanged.

## Prompt injection

`buildPromptContext` selects and renders a bounded ledger as `campaignMemory`.
Selection is deterministic and capped at 12 complete facts / 6000 characters.
Required fact ids lead the output (and an unknown required id rejects the
request); remaining facts are ranked by target (+80), actor (+50), matching
domain (+30), active status (+20), salience (+0/10/20/30), and recency (up to
+20), with `updatedRound` then id as tie-breakers. Old closed facts are omitted
unless explicitly required. The task, actor, targets and domains are stated in
the AI context. It is appended at call time, outside editable/frozen scenario
prompts, to:

- timeline and automatic jumps;
- action suggestions and game-master tasks;
- catalysts, country sheets and idle diplomacy;
- advisor and leader conversations;
- the consolidator itself, so it can reuse existing ids.

Active facts are declared binding. Closed facts remain historical context but
are explicitly marked as no longer in force.

## Retention policy

The long recent-event window is 60 events and resolved-action excerpts retain
48 entries. Automatic consolidation retains the newest 60 unconsolidated
events, starts on a 96-event size threshold (or the five-round cadence once the
retained window is exceeded), and processes up to 80 older events per batch.
The live consolidator directive asks for roughly 800–1200 words when the
material warrants it; this call-time rule reaches existing frozen prompts.

## Compatibility and UI

V1 saves are read without file migration; missing relevance fields receive
safe defaults (`[]`, `other`, `minor`, `[]`). The in-memory record retains
version 1 until a real memory operation writes version 2. A save with no memory
starts as `{version: 2, facts: []}`. The field rides inside the existing
`world.json`, so desktop/web storage, export/import, rollback snapshots and
normal world writes need no new store or server route.

The Events panel exposes the current ledger in a collapsed **Campaign memory**
section. This is an audit surface: players can see which facts are active and
which have been broken or resolved.
