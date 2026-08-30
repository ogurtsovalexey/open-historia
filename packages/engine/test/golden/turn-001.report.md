# Turn 1 — 1900-01-01

Base revision: `sha256:dc530c38af6f1d1e13cdadfaac2a97163ae1fdf0a76e131ba3643090929e255d`
New revision:  `sha256:c8a3dd9b80df68da33f7253eb386fe77fb96831676575d2160de4946af3af9f9`

## Rejected commands

- `6a1f5c1e-0d2b-4d3a-9a51-000000000002` (economy.invest-region by polity:vindar): **foreign-target** — region:dev-2x5:A1 is controlled by polity:ostreya. State unchanged.

## Ostreya (polity:ostreya)

### Population: 2451796 (+1796)
- region:dev-2x5:A1: 900825 (births +2400, deaths -1575)
- region:dev-2x5:A2: 600400 (births +1500, deaths -1100)
- region:dev-2x5:A3: 300200 (births +775, deaths -575)
- region:dev-2x5:A4: 250104 (births +604, deaths -500)
- region:dev-2x5:A5: 400267 (births +933, deaths -666)

### Investment: 1000 gold into region:dev-2x5:A4 → infrastructure +1000 bp (now 5000 bp)

### Treasury: 21820 gold (+16820)
- opening 5000, tax revenue +17820, spending -1000
  - tax from region:dev-2x5:A4 (coal): +2160
  - tax from region:dev-2x5:A1 (food): +9600
  - tax from region:dev-2x5:A2 (food): +4000
  - tax from region:dev-2x5:A5 (goods): +60
  - tax from region:dev-2x5:A3 (wood): +2000

### Resources

| Resource | Opening | Produced | Used | Closing |
|---|---:|---:|---:|---:|
| coal | 50 | +6000 | -40 | 6010 |
| food | 200 | +170000 | -122589 | 47611 |
| goods | 10 | +40 | 0 | 50 |
| iron | 40 | 0 | -40 | 0 |
| wood | 100 | +10000 | 0 | 10100 |

- coal production +6000: region:dev-2x5:A4 +6000
- food production +170000: region:dev-2x5:A1 +120000, region:dev-2x5:A2 +50000
- goods production +40: region:dev-2x5:A5 +40
- wood production +10000: region:dev-2x5:A3 +10000

### Goods (region:dev-2x5:A5): 40 of 5600 potential — limited by iron
- inputs used: coal 40, iron 40; input supply 71 bp

### Food: surplus 47611 (need 122589, consumed 122589)

## Vindar (polity:vindar)

### Population: 1360523 (+523)
- region:dev-2x5:B1: 350146 (births +758, deaths -612)
- region:dev-2x5:B2: 280117 (births +630, deaths -513)
- region:dev-2x5:B3: 260076 (births +541, deaths -465)
- region:dev-2x5:B4: 150050 (births +331, deaths -281)
- region:dev-2x5:B5: 320134 (births +680, deaths -546)

### Treasury: 33719 gold (+25719)
- opening 8000, tax revenue +25719, spending -0
  - tax from region:dev-2x5:B2 (coal): +4212
  - tax from region:dev-2x5:B1 (food): +4400
  - tax from region:dev-2x5:B5 (goods): +10800
  - tax from region:dev-2x5:B3 (iron): +4147
  - tax from region:dev-2x5:B4 (iron): +2160

### Resources

| Resource | Opening | Produced | Used | Closing |
|---|---:|---:|---:|---:|
| coal | 80 | +11700 | -7200 | 4580 |
| food | 100 | +55000 | -55100 | 0 |
| goods | 30 | +7200 | 0 | 7230 |
| iron | 60 | +13140 | -7200 | 6000 |
| wood | 40 | 0 | 0 | 40 |

- coal production +11700: region:dev-2x5:B2 +11700
- food production +55000: region:dev-2x5:B1 +55000
- goods production +7200: region:dev-2x5:B5 +7200
- iron production +13140: region:dev-2x5:B3 +8640, region:dev-2x5:B4 +4500

### Goods (region:dev-2x5:B5): 7200 of 7200 potential — limited by capacity/labour/infrastructure
- inputs used: coal 7200, iron 7200; input supply 10000 bp

### Food: SHORTFALL 12926 (need 68026, available 55100, consumed 55100)

## Alerts

- [polity:ostreya] inputs-limited: region:dev-2x5:A5: goods output 40 of 5600 potential; limited by iron
- [polity:vindar] food-shortfall: need 68026, available 55100, shortfall 12926

