# Durable Campaign Memory

Open Historia keeps narrative history in recent event excerpts and consolidated
summaries. `campaignMemory` adds a second, structured layer for facts that must
remain causally binding after their source events leave the recent window.

## Stored shape

`world.json` contains:

```json
{
  "campaignMemory": {
    "version": 1,
    "facts": [{
      "id": "treaty-1810",
      "category": "treaty",
      "statement": "France and Russia guarantee the 1810 settlement.",
      "parties": ["France", "Russia"],
      "status": "active",
      "sinceDate": "1810-04-12",
      "endedDate": "",
      "evidenceIds": ["event-1810-settlement"],
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

## Evidence and update rules

The event consolidator returns `memoryOps` alongside its narrative `summary`.
It never replaces the complete fact list. `upsert` creates or refreshes one
fact; `resolve` closes an existing fact by its stable id.

Every operation must cite an event, closed chat, or resolved action id from the
exact batch being consolidated. `applyCampaignMemoryOps` filters citations
against that batch. A new fact with no valid evidence is discarded; resolving
an unknown id or using an invented citation is also discarded. Prior evidence
and completed facts remain stored, so a later weak model response cannot erase
them by omission.

The consolidation renderers expose ids only on the extraction call. Normal
player-facing history remains unchanged.

## Prompt injection

`buildPromptContext` renders the ledger as `campaignMemory`. It is appended at
call time, outside editable/frozen scenario prompts, to:

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

Old saves normalize to `{version: 1, facts: []}`. The field rides inside the
existing `world.json`, so desktop/web storage, export/import, rollback snapshots
and normal world writes need no new store or server route.

The Events panel exposes the current ledger in a collapsed **Campaign memory**
section. This is an audit surface: players can see which facts are active and
which have been broken or resolved.

