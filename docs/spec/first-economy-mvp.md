# First Economy MVP — Ten-Region Playtest Contract

Status: accepted owner-directed playtest scope

This contract defines the smallest version of Open Historia that tests a real
region-driven economy in the running game. It is a synthetic development
scenario, not a historically sourced World 1916 release and not a complete
economic model.

## 1. Player outcome

A player can load a tiny offline map, select either of two countries, inspect
how five owned regions form the national economy, see one raw-input production
chain, invest in one region, advance one month, see deterministic changes,
transfer a region, and verify that both countries' totals change immediately.
Twelve months can be played, saved, reloaded and replayed without an AI
provider. The accepted resource/activity extension is defined in
[Regional Resource Economy](regional-resource-economy.md).

## 2. Fixture boundary

- Two fictional polities and exactly ten regions, five initially controlled by
  each polity.
- Simple checked-in geometry that is inspectable by eye; no production world
  map or runtime region aggregation is required.
- All starting numbers and coefficients are authored by the scenario and
  marked `scenario_choice`. No value is generated at startup.
- English and Russian display names are checked in.
- The fixture is visibly labelled `Development/Test` and cannot be presented as
  a historically complete scenario.

The fixture deliberately uses unequal populations, infrastructure and
specializations so incorrect aggregation is visible without specialist tools.

## 3. Canonical regional state

Each region is the source of truth for:

```ts
interface EconomyMvpRegion {
  regionId: RegionId;
  controllerId: PolityId;
  population: PersonCount;
  annualBirthRateBp: BasisPoints;
  annualDeathRateBp: BasisPoints;
  birthRemainder: bigint;
  deathRemainder: bigint;
  workforceRateBp: BasisPoints;
  infrastructureBp: BasisPoints;
  primaryCommodity: "food" | "energy" | "materials" | "manufactures";
  baseMonthlyCapacity: QuantityMicros;
  outputPerWorker: QuantityMicros;
  damageBp: BasisPoints;
}
```

This four-group field is the baseline kernel implemented by #32. The extension
layer replaces its player-facing abstraction with a catalog resource and one
scenario-authored regional activity. `energy` is not a player-visible resource:
the first fixture displays Food, Wood, Coal, Iron and Goods and resolves
`1 Coal + 1 Iron -> 1 Goods`. This preserves #32 as an implementation step
without making its temporary commodity grouping the long-term domain model.

Population, productive capacity, specialization, infrastructure and damage
stay with the region when control changes. They are not copied into country
state and are never regenerated from the new controller's national averages.

## 4. Polity state and derived totals

Canonical polity-level stocks in this MVP are limited to:

- treasury in fixed-point Gold, the single comparable currency for all
  polities;
- a National Stockpile keyed by the resources active in the scenario;
- the accepted regional-investment command for the effective month.

The following are derived projections and cannot be independently edited:

```text
polity population       = sum(population of controlled regions)
polity workforce        = sum(workforce of controlled regions)
polity production[good] = sum(gross production[good] of controlled regions)
polity output value     = sum(region output × authored accounting value)
polity tax revenue      = sum(region taxable output × authored tax rate)
```

Every committed month reconciles the region rows with these national totals.
Cached projections are allowed for UI performance only when their revision is
identified and equality with a fresh aggregation is validated.

## 5. Monthly resolution

All arithmetic uses integers/fixed point and a fixed order. The fixture also
authors `foodNeedPerPerson`, accounting value and tax rate for each commodity,
and `infrastructureBpPerMoney` for investment. There are no hidden balancing
constants.

1. Validate controller references and the one accepted policy command.
2. Pay the targeted regional investment from treasury; clamp the resulting
   infrastructure improvement at 10,000 basis points.
3. For every region, calculate births and natural deaths from authored annual
   rates, carrying deterministic division remainder between months.
4. Calculate available workforce from the new population and authored
   workforce rate.
5. Calculate potential regional output as a bounded function of workforce,
   base capacity, infrastructure and damage.
6. Resolve raw output, then the accepted Goods process and its material-input
   limit in the order defined by the resource extension.
7. Aggregate production and taxable output by current controller.
8. Consume authored food need from each polity inventory plus current food
   production; record surplus or shortfall without creating negative stock.
9. Add tax revenue, subtract accepted spending and update treasury Gold.
10. Produce typed regional deltas, stock movements, national contribution
    ledgers and alerts, then commit all results as one world revision.

The first implementation uses these inspectable formulas. Every division is
integer floor division and carries the named remainder where one is shown:

```text
birth numerator = population × annualBirthRateBp + birthRemainder
births          = birth numerator / 120000
birthRemainder' = birth numerator % 120000

death numerator = population × annualDeathRateBp + deathRemainder
deaths          = death numerator / 120000
deathRemainder' = death numerator % 120000

workforce       = population' × workforceRateBp / 10000
labour output   = workforce × outputPerWorker
usable capacity = min(baseMonthlyCapacity, labour output)
gross output    = usable capacity × infrastructureBp / 10000
gross output    = gross output × (10000 - damageBp) / 10000

tax revenue     = sum(gross output × accounting value × taxRateBp / 10000)
food need       = polity population × foodNeedPerPerson
infrastructure gain = accepted spend × infrastructureBpPerMoney
```

The resolver must additionally satisfy:

```text
population' = population + births - deaths
inventory'  = inventory + production - consumption
treasury'   = treasury + tax revenue - accepted spending
```

No randomness, migration, combat casualty or AI modifier is part of this
first tick.

## 6. First player policy

The only new economic command is a regional investment:

```ts
interface InvestInRegionCommand {
  kind: "economy.invest-region";
  commandId: CommandId;
  actorPolityId: PolityId;
  targetRegionId: RegionId;
  expectedRevision: WorldRevisionId;
  effectiveMonth: GameDate;
  spend: MoneyMicros;
}
```

The target must be controlled by the actor when the command is accepted. The
preview and resolver call the same pure calculation. Cancellation, insufficient
treasury, stale revision, foreign target or invalid amount changes no state.

The UI shows cost, infrastructure change, estimated next-month regional output
delta and the affected national commodity total before confirmation.

## 7. Territorial change semantics

A validated region-control transfer causes an immediate re-aggregation:

- the losing polity loses the region's population, workforce, productive
  capacity and future production;
- the gaining polity receives those same regional values without cloning or
  rounding drift;
- the region's infrastructure and existing damage remain attached to it;
- national treasury and already accumulated national inventories do not
  teleport with the region;
- a transfer accepted before a monthly tick assigns that tick's output to the
  new controller; a transfer committed after it affects the next tick.

The MVP tests transfer mechanics directly. It does not yet simulate battles,
occupation shares, reparations, looting, refugees or combat damage. Later
combat must express those as typed events before this economy consumes them.

## 8. Required UI

The selected-country dashboard shows:

- total population and monthly delta;
- treasury, revenue, spending and balance;
- production, use, balance and inventory for all five active resources;
- food surplus/shortfall;
- the selected region's activity, capacity, potential/actual output, input
  supply and limiting resource;
- five region rows with population, activity, output, infrastructure and
  last-month delta.

Selecting a total or region opens `Why changed`, built from the deterministic
contribution ledger. Unknown, zero and assumed values are visually distinct.
Opening the dashboard, region details or explanation makes zero model calls.

## 9. Playtest script

1. Load the development scenario offline and select polity A.
2. Manually sum its five starting populations and compare with the dashboard.
3. Manually sum output by resource and compare with national production.
4. Preview and cancel an investment; verify that nothing changes.
5. Invest in a food region, advance one month and inspect its regional and
   national contribution deltas.
6. Reload the starting revision, invest the same amount in a Goods region and
   verify that the preview identifies whether capacity or Coal/Iron supply is
   limiting.
7. Transfer one productive region from A to B and verify both national
   population/output totals immediately, including a fresh manual sum.
8. Advance the transferred world one month and verify only B receives that
   region's production.
9. Play twelve months, save after month six, close, reload and finish.
10. Replay from the same base and commands; compare checksums and event IDs.

## 10. Automated gates

- Region population sums equal polity totals after every operation and month.
- Region production sums equal polity production for every active resource.
- Coal and Iron stock movements exactly reconcile with actual Goods output.
- A Goods region without either required input has capacity but zero output.
- Population, inventory and treasury identities reconcile exactly.
- No negative population, inventory, treasury spend or output is accepted.
- A region belongs to exactly one controller and contributes exactly once.
- Transfer A → B decreases A and increases B by the same regional population
  and production potential.
- Same base revision and commands produce byte-identical next state/events.
- Injected validation/storage failure exposes the previous complete revision.
- Save/reload/replay preserves every region and aggregate.
- The ten-region tick and UI path perform zero network/LLM calls; measured tick
  duration and payload are reported without extrapolating global performance.

## 11. Explicitly deferred

- historical World 1916 balancing and global coverage;
- prices, inflation, debt, credit, trade, Gold settlement and market clearing;
- multi-stage factory input chains and employment sectors;
- migration, age cohorts, culture, religion and political groups;
- combat, occupation fractions, casualties, refugees and war damage;
- transport graphs, routes and military supply;
- resource discovery, depletion and construction projects;
- NPC strategic AI and generated economic events;
- multi-month batching and global coarse simulation.

These are later layers over the same region-first accounting contract, not
permission to replace regional truth with arbitrary national scores.
