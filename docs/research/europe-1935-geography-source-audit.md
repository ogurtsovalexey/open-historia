# Europe 1935 geography source audit

Status: owner-review candidate generated; not owner-approved and not integrated into runtime.

Date: 2026-09-02. Scenario date: 1935-01-01.

## Reproducible extraction

`npm run geography:europe-1935 -- --boundaries` queries dated administrative
relations from OpenHistoricalMap (OHM), retains the exact raw responses under
the ignored `runs/campaign-lab/europe-1935-geography-checkpoint/` directory,
and records SHA-256 checksums and exact Overpass queries. The extraction is
fail-closed for missing dates, incompatible licenses, absent member geometry,
open rings and orphan holes.

The source-wide inventory found 859 level 2–6 relations effective on the
scenario date: 807 under OHM's default CC0 terms, 13 explicitly public-domain,
39 attribution-licensed and zero with a detected blocked license. This does
not waive the per-object check. OHM's copyright statement and every object's
`license=*` value remain part of the checkpoint provenance.

All seven Supported country boundary relations have explicit effective date
ranges and allowed licenses. The 1935 French relation includes Algeria, so a
recorded metropolitan bounding scope retains mainland France and Corse while
excluding the distant polygon before topology work. Candidate membership is verified by polygon
intersection (at least 98 percent of candidate area inside the country), not
by a centroid. The latter is unsafe for concave and fragmented regions.

## Current source coverage

These are source candidates, not final game regions. Counts can exceed 25 when
lower-level polygons still need deterministic aggregation.

| Polity | Precise dated candidates | Current finding |
| --- | ---: | --- |
| Austria | 8 | Eight Länder are sound; a dated Wien polygon is missing. |
| Czechoslovakia | 99+ | Czech districts are dense, but Slovak coverage is absent and aggregation is required. |
| France | 18 | TRF-GIS military regions are exact for 1935, CC BY 4.0, include Corse and cover the 90-department control union without measured gaps or overlaps. |
| Germany | 27 | Aggregation to at most 25 is required; Hannover has an open inner ring and is excluded. |
| Italy | 14 | Emilia, Liguria and Lombardia have open rings; Sicilia is absent from the dated inventory. |
| Poland | 16 | The voivodeship layer is near-complete and directly usable after topology review. |
| United Kingdom | 62 | Coverage is uneven, 13 candidate relations have open rings, and aggregation is required. |

## Owner-review candidate

Run `npm run geography:europe-1935:owner` for a fresh source extraction or add
`-- --cached` to reproduce the checkpoint from the checksum-pinned ignored
downloads. The command writes `owner-geography-overlay.svg`,
`owner-geography-report.md`, `owner-geography-manifest.json`,
`owner-regions.geojson` and `owner-land-adjacency.json` beneath the ignored
checkpoint directory. It never edits the runtime scenario.

The current candidate has this bounded surface:

| Polity | Regions | Land edges | Source treatment |
| --- | ---: | ---: | --- |
| Austria | 10 | 15 | Dated Länder; Tirol split into Tirol/Osttirol; a visibly low-confidence Wien cut awaits owner review. |
| Czechoslovakia | 10 | 16 | Ninety-six dated okres polygons aggregated inside the dated Czech and Moravian-Silesian lands; Slovensko is the deterministic remainder between dated land polygons. |
| France | 19 | 37 | Eighteen TRF-GIS military regions with Corse promoted from the Marseille multipolygon into an explicit region. |
| Germany | 21 | 45 | Dated states/provinces aggregated to the gameplay limit; incomplete Hannover is reconstructed from the dated country remainder and Braunschweig source. |
| Italy | 18 | 33 | Dated regions plus deterministic country-remainder reconstruction for incomplete northern relations; Sicilia is the dated country island component. |
| Poland | 16 | 30 | The already pinned voivodeship layer and adjacency control, unchanged. |
| United Kingdom | 13 | 18 | All 92 permissively reusable Historic County Borders Project Definition A polygons assigned once to strategic aggregates. |
| Saargebiet / Freie Stadt Danzig | 1 each | 0 | Exact dated OHM relations; inert-polity integration waits for approval. |

Every candidate partition is `topology-clean`, has zero non-manifold segments
and no unexpected isolated region. Corse, Sicilia, Sardegna, Northern Ireland,
Ostpreußen and the two single-region inert polities are explicitly classified;
straits, sea routes and the Danzig connection remain authored rather than
inferred as land edges. The manifest also records three named strategic
macro-regions each for the Baseline USSR and USA; they are intentionally absent
from the Europe-focused geometry overlay.

Coordinates are normalized to five decimal places and the partition is rebuilt
from one linework pass before adjacency is derived. The review SVG alone uses
Douglas–Peucker simplification; independently simplifying authoritative region
polygons was tested and rejected because it broke a shared German boundary.
The generated manifest binds every complete region feature to a SHA-256 value.

The UK candidate deliberately does **not** use the otherwise precise 1931
administrative-counties layer because its CC BY-SA 4.0 terms require a separate
owner decision. The Historic County Borders Project publishes Definition A for
personal, educational and commercial reuse with acknowledgement requested; the
candidate labels it as a stable geographic approximation rather than silently
claiming 1931 administrative fidelity.

## Measured source topology

The extractor now unions each selected source layer and measures it against the
dated country boundary. It reports coverage, outside area and overlap excess;
it never closes a ring or fills a gap. The threshold for a clean source layer
is one part per million on every measure.

- France's 18 military regions are `topology-clean` against the independent
  union of its 90 departments: coverage 1.0, no measured gap, outside area or
  overlap excess. Exact seven-decimal source segments derive 37 reciprocal
  land-adjacency edges, with no isolated region and no segment owned by more
  than two regions. Point contacts do not create edges; Corse remains inside
  its metropolitan military region without acquiring a false mainland link.
- Poland's 16 voivodeships cover 0.999971976 of the OHM country boundary. The
  remaining 0.000028024 and 0.000001260 outside ratio must be reconciled on
  shared linework before approval; the extractor does not round them away.
- Austria's eight Länder cover the country outline, but eight does not meet
  the 10-region gameplay minimum and a 0.000007061 outside discrepancy remains.
- Germany currently covers 0.913253494 because Hannover is excluded; Italy
  covers 0.743877697 without Emilia, Liguria, Lombardia and Sicilia; the
  level-5 UK selection covers 0.307355846.
- The Czechoslovak district union triggers a deterministic polygon-clipping
  geometry error. This is recorded as `source-geometry-error`, not repaired or
  promoted.

The generated `candidate-source-overlay.svg` deliberately says “NOT FOR OWNER
APPROVAL”: it visualizes source coverage and gaps, not a topology-clean game
map. It omits overlapping high-level relations when a lower level is being
audited.

France is supplemented from the [TRF-GIS departments dataset](https://doi.org/10.7910/DVN/ULQYM5)
and its [1935 military-regions series](https://doi.org/10.7910/DVN/SQPEUW).
Both Dataverse records state CC BY 4.0 terms. The exact downloaded files and
SHA-256 pins are enforced by the extractor. The otherwise attractive
[1931 Great Britain county layer](https://geodata.lib.utexas.edu/catalog/stanford-yd604rg3256)
is CC BY-SA 4.0 and therefore remains excluded pending a separate owner
licensing decision.

## Blocking decisions and next work

1. Repair incomplete OHM multipolygons only from dated, attributable source
   evidence; never bridge an open ring by visual guess.
2. Audit compatible historical alternatives for Slovakia, Wien,
   Sicilia and incomplete British counties. ODbL/share-alike data remains
   blocked until the owner makes a separate licensing decision.
3. Freeze 10–25 aggregate definitions per Supported polity, then compute
   topology and land adjacency from one shared simplified linework graph.
4. Add Saar and Danzig as inert non-player polities and author only manual
   straits, sea routes and external macro-power links.
5. Present the topology-clean SVG/GeoJSON and provenance manifest for the
   first owner checkpoint. No model call is permitted before that approval and
   the separate starting-state-table approval.
