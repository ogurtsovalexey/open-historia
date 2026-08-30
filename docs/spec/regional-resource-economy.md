# Regional Resource Economy — MVP Extension

Status: accepted owner-directed extension to the ten-region playtest

This contract adds one inspectable production chain to the
[first economy MVP](first-economy-mvp.md). It preserves the simple rule that a
region has one leading economic activity while distinguishing natural output,
industrial capacity and the inputs required to use that capacity.

## 1. Terms and authority

- A **resource** is a typed quantity that can be produced, stored, consumed or
  transferred through an accepted rule.
- A **regional activity** is the one leading extraction, agricultural or
  processing activity represented by a region in this MVP.
- **Capacity** is how much that activity could produce before labour,
  infrastructure, damage and material-input constraints.
- **Input supply** is a derived explanation, never an authored score or an
  AI-controlled modifier.

The application owns resource IDs, recipes, calculation order, allocation and
reconciliation. A scenario chooses an era-appropriate subset, assigns one
activity to every economy region and authors its starting capacity and stocks.
AI may explain shortages or recommend an available typed command; it cannot
create resources, recipes, supply percentages or numeric effects.

## 2. Game resource catalog

The initial game catalog deliberately uses short, B1-level English display
names. Russian labels are checked in beside them. `Forest` is terrain or natural
potential; the stored resource produced from it is `wood`.

| Stable ID | English | Russian | Kind |
|---|---|---|---|
| `food` | Food | Еда | raw |
| `wood` | Wood | Дерево | raw |
| `stone` | Stone | Камень | raw |
| `iron` | Iron | Железо | raw |
| `coal` | Coal | Уголь | raw |
| `oil` | Oil | Нефть | raw |
| `fibers` | Fibers | Волокна | raw |
| `gold` | Gold | Золото | reserved |
| `building_materials` | Building Materials | Стройматериалы | processed |
| `steel` | Steel | Сталь | processed |
| `fuel` | Fuel | Топливо | processed |
| `chemicals` | Chemicals | Химикаты | processed |
| `cloth` | Cloth | Ткань | processed |
| `goods` | Goods | Товары | processed |
| `machines` | Machines | Машины | processed |
| `weapons` | Weapons | Оружие | processed |
| `ammo` | Ammo | Боеприпасы | processed |
| `medicine` | Medicine | Медикаменты | processed |
| `electricity` | Electricity | Электричество | flow |

`iron` and `steel` are intentionally distinct: the former is a mined input and
the latter is processed material. `oil` and `fuel` have the same distinction.
`fibers` is the broad raw category; a scenario may display a more specific
authored source such as Cotton, Wool or Flax without changing the engine ID.
Electricity is a same-tick flow rather than a normal inventory.

The catalog is larger than any one scenario. Unknown resource IDs fail
validation. A scenario may disable unused catalog entries but may not silently
invent a new runtime ID. Catalog extension is a versioned engine/content change.

Gold is also the single comparable treasury currency for all polities. The
relationship between the reserved physical `gold` resource, mining, trade and
treasury credit is deliberately not defined here and `gold` is not active in
the first fixture. It requires a separate accepted monetary contract.

## 3. Activities and recipes

An extraction activity has no material input and produces one raw resource. A
processing activity has one fixed recipe, consumes inventory and produces one
processed resource. An area's activity is scenario-authored and cannot be
randomly assigned when a campaign starts.

The first implemented processing activity is:

```text
activity: basic_goods
inputs:   1 Coal + 1 Iron
output:   1 Goods
```

The numeric quantities use the same fixed-point unit selected by the scenario.
Food, Wood, Coal and Iron activities are input-free in this fixture. Other
catalog resources and plausible chains are reserved extension points, not
permission for a worker to invent or implement extra recipes.

A missing activity is a blocking scenario error. An editor may later create a
seeded, reproducible Draft suggestion, but it must show its assumptions and be
accepted into the scenario before play. Runtime random fallback is forbidden.

## 4. National stockpile

Every polity has one abstract `National Stockpile`, keyed by its scenario-active
inventory resources. It is not physically located in the capital and therefore
does not imply transport, blockade, warehouse capture or capital-transfer
rules. Those arrive with logistics and regional storage.

Territorial transfer moves the region and its activity/capacity. It does not
move any accumulated national inventory or treasury Gold.

For every inventory resource:

```text
closing stock
  = opening stock
  + regional production
  + accepted external receipts
  - processing inputs actually used
  - population/military consumption actually used
  - accepted external deliveries
```

The first fixture has no external receipts/deliveries or military consumption.
It consumes Food for population and Coal/Iron for Goods production.

## 5. Monthly calculation

For every activity, first calculate output before material inputs using the
existing economy-kernel formula:

```text
labour output   = workforce × outputPerWorker
usable capacity = min(baseMonthlyCapacity, labour output)
potential output
  = usable capacity × infrastructureBp / 10000
  × (10000 - damageBp) / 10000
```

The extended fixture resolves in this fixed order:

1. Validate resource IDs, enabled activities, controllers and commands.
2. Apply the accepted regional investment.
3. Resolve population and workforce.
4. Resolve Food, Wood, Coal and Iron extraction for all regions.
5. Add current-month extraction to each controller's National Stockpile.
6. Resolve `basic_goods` for the one Goods region owned by each polity.
7. Deduct only Coal and Iron actually consumed; add actual Goods output.
8. Resolve Food consumption, tax and treasury Gold.
9. Emit regional deltas, stock movements, limiting inputs and national ledgers.
10. Atomically commit one world revision.

For `basic_goods`:

```text
actual Goods
  = min(potential Goods, available Coal, available Iron)

Coal used = actual Goods
Iron used = actual Goods

input supply Bp
  = potential Goods == 0
    ? 10000
    : actual Goods × 10000 / potential Goods
```

The projection records coverage for every required input and all inputs tied
for the minimum as limiting resources. Current-month extraction is available
to processing in the same month.

The 2x5 fixture deliberately has exactly one processing region per polity, so
there is no competition between multiple factories for the same input. A
future production-planning contract must define allocation and priorities
before a scenario enables such competition.

## 6. UI and advisor projection

The first right-drawer tab is `Economy`, followed by `Advisor` and `Stats`, and
opens active by default. A map click selects a region. The top section shows
that region; the section directly below shows its current controller.

The region section exposes population, activity, capacity, potential output,
actual output, labour use, infrastructure, damage, per-input coverage and
limiting inputs. The controller section exposes treasury Gold and, for every
active resource, production, use, balance and closing National Stockpile.

The most recently selected region survives only for the mounted UI session. If
none was selected, use the player's first controlled economy region by stable
`regionId`. After a control transfer, keep the selected region and immediately
show the new controller below it.

An eventual AI advisor receives a bounded engine-built brief containing active
resources, deficits/surpluses, potential versus actual output, limiting inputs,
top contributing region IDs and engine-calculated previews. It never receives
the full map or authority to set a result.

## 7. Required proof

- A Goods region with no Coal or no Iron retains capacity but produces zero.
- Partial input availability caps output and deducts only the inputs used.
- Full inputs expose labour, capacity, infrastructure or damage as the next
  limiting factor.
- Same-month extraction can feed Goods production.
- Every regional production/consumption row reconciles with national stocks.
- Capturing a raw-resource region changes the following production opportunity;
  capturing a Goods region does not teleport either country's stockpile.
- Investment preview and committed output use the same calculation and may show
  zero immediate gain when material inputs remain limiting.
- Same base revision and commands produce byte-identical state and ledgers.
- Economy UI and its explanations make zero model calls.

## 8. Deferred

- prices, trade, imports/exports and market clearing;
- Gold mining, trade settlement, currency issuance and inflation;
- competing factories and allocation priorities;
- multiple activities per region and construction queues;
- transport access, regional warehouses, blockade and capital capture;
- the other processed-resource recipes and electricity network;
- AI-selected economic commands.
