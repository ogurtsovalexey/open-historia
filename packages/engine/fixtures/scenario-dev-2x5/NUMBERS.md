# Hand-checked month 1 numbers (no commands)

Authored fixture sums a reviewer can verify with a pocket calculator.
Unit tests in `test/tick.test.ts` assert these exact values.

## Starting populations

| Polity | Regions | Sum |
|---|---|---|
| Ostreya | 900000 + 600000 + 300000 + 250000 + 400000 | **2450000** |
| Vindar | 350000 + 280000 + 260000 + 150000 + 320000 | **1360000** |

## Month 1 without commands (remainders start at 0)

Formulas (first-economy-mvp §5): births = pop×birthBp/120000 (floor, carry
remainder); workforce = pop'×wfBp/10000; usable = min(capacity, workforce×opw);
gross = usable×infraBp/10000×(10000−damageBp)/10000.

### Ostreya

| Region | births | deaths | pop' | workforce | gross output |
|---|---:|---:|---:|---:|---|
| A1 food | 2400 | 1575 | 900825 | 405371 | 120000 food |
| A2 food | 1500 | 1100 | 600400 | 240160 | 50000 food |
| A3 wood | 775 | 575 | 300200 | 150100 | 10000 wood |
| A4 coal | 604 r20000 | 500 | 250104 | 120049 | 4800 coal (damage 2000bp) |
| A5 goods | 933 r40000 | 666 r80000 | 400267 | 200133 | potential 5600 goods |

- A5 inputs: coal 50+4800=4850, iron 40+0=**40** → actual goods **40**, limiting: iron.
- Stock closing: coal 4810, iron 0, goods 50, wood 10100.
- Population total 2451796; food need = ×50/1000 = **122589**; available 200+170000=170200 → surplus 47611.
- Tax: 9600 (A1) + 4000 (A2) + 2000 (A3) + 1728 (A4) + 60 (A5) = **17388**; treasury 5000+17388=**22388**.

### Vindar

| Region | births | deaths | pop' | workforce | gross output |
|---|---:|---:|---:|---:|---|
| B1 food | 758 r40000 | 612 r60000 | 350146 | 161067 | 55000 food |
| B2 coal | 630 | 513 r40000 | 280117 | 145660 | 11700 coal |
| B3 iron | 541 r80000 | 465 r100000 | 260076 | 130038 | 8640 iron (damage 1000bp) |
| B4 iron | 331 r30000 | 281 r30000 | 150050 | 60020 | 4500 iron |
| B5 goods | 680 | 546 r80000 | 320134 | 176073 | potential 7200 goods |

- B5 inputs: coal 80+11700=11780, iron 60+13140=13200 → actual **7200** (capacity-limited).
- Stock closing: coal 4580, iron 6000, goods 7230.
- Population total 1360523; food need **68026**; available 100+55000=55100 → consumed 55100, **shortfall 12926**, food stock 0.
- Tax: 4400 (B1) + 4212 (B2) + 4147 (B3) + 2160 (B4) + 10800 (B5) = **25719**; treasury 8000+25719=**33719**.
