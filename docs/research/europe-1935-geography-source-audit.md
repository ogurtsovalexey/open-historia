# Europe 1935 geography source audit

Status: active source audit; not an owner-approved geography checkpoint.

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
| France | 18 | TRF-GIS military regions are exact for 1935, CC BY 4.0 and include Corse; 90 dated departments provide a topology control. |
| Germany | 27 | Aggregation to at most 25 is required; Hannover has an open inner ring and is excluded. |
| Italy | 14 | Emilia, Liguria and Lombardia have open rings; Sicilia is absent from the dated inventory. |
| Poland | 16 | The voivodeship layer is near-complete and directly usable after topology review. |
| United Kingdom | 62 | Coverage is uneven, 13 candidate relations have open rings, and aggregation is required. |

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
