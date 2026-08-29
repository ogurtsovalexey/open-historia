# Source register

Research cutoff: 2026-08-29.

## Primary product and code sources

- [Open Historia repository](https://github.com/Open-Historia/open-historia)
- [Open Historia developer documentation](https://github.com/Open-Historia/open-historia/tree/main/docs)
- [Open Historia prompt guide](https://github.com/Open-Historia/open-historia/blob/main/docs/ai-prompts.md)
- [Open Historia issue list](https://github.com/Open-Historia/open-historia/issues)
- [Open Historia discussions](https://github.com/Open-Historia/open-historia/discussions)
- [Open Historia community scenarios repository](https://github.com/Open-Historia/Open-historia-scenarios)
- [Pax Historia Creator Docs](https://www.paxhistoria.co/docs)
- [Pax AI slots and tools](https://www.paxhistoria.co/docs/workflows/ai-calls)
- [Pax failures and retries](https://www.paxhistoria.co/docs/workflows/ai-failures-retries)
- [Pax workflow quickstart](https://www.paxhistoria.co/docs/workflows)
- [Pax memory/compression](https://www.paxhistoria.co/docs/workflows/compression)
- [Pax bundle boundary](https://www.paxhistoria.co/docs/bundles)
- [Pax AI service contract](https://www.paxhistoria.co/docs/bundles/ai-chat)

## Architecture and AI design references

- [Meta CICERO overview](https://ai.meta.com/blog/cicero-ai-negotiates-persuades-and-cooperates-with-people/)
- [Meta CICERO research page](https://ai.meta.com/research/cicero/)
- [Gemini context caching](https://ai.google.dev/gemini-api/docs/caching)

## Comparative grand-strategy design references

- [Civilization VI official overview](https://civilization.2k.com/en-GB/civ-vi/) — cities/terrain, technology and civics, leader agendas, religion, loyalty/governors and environment at a product-design level.
- [Hearts of Iron IV official overview](https://www.paradoxinteractive.com/zh-CN/games/hearts-of-iron-iv/about) — industrial buildup, production instructions, research, division design and alternate-history choices at a product-design level.
- [Hearts of Iron IV: No Step Back release](https://www.paradoxinteractive.com/media/press-releases/press-release/major-hearts-of-iron-iv-expansion-released) — official description of supply/logistics and army-management changes.
- [Europa Universalis IV official overview](https://www.paradoxinteractive.com/games/europa-universalis-iv/about) — trade, diplomacy, rulers, historical events and technology over a long historical arc.
- [Europa Universalis IV: The Cossacks](https://www.paradoxinteractive.com/games/europa-universalis-iv/add-ons/europa-universalis-iv-cossacks) — estates, culture/religion policy and communicating strategic goals to AI allies.
- [Europa Universalis IV: Dharma](https://www.paradoxinteractive.com/games/europa-universalis-iv/add-ons/europa-universalis-iv-dharma) — government reform, estates, trade-company investment and culture accommodation examples.
- [Victoria 3 design retrospective](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-57-the-journey-so-far) — population, employment, industry, goods, living conditions, laws and political interests as linked systems.
- [Victoria 3 cultures and religions](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-56-cultures-and-religions) — culture/religion traits, law-mediated acceptance, migration, political strength and secession links.
- [Victoria 3 elections](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-45-elections) and [political parties](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-46-political-parties) — voting rules, parties/interest-group coalitions and government legitimacy.
- [Victoria 3 revolutions](https://www.paradoxinteractive.com/games/victoria-3/news/dev-diary-41-revolutions) — severe domestic conflict as the result of material/ideological pressures with visible buildup rather than an arbitrary random event.

These sources inform relationships between mechanics only. My Open Historia will not reproduce their formulas, UI, text, data or proprietary content.

## Existing-game market check

- [Global Protocol: New World Order — Steam](https://store.steampowered.com/app/4500270/Global_Protocol_New_World_Order/) — current features, Early Access status, review aggregate, macOS/Russian support, modding and developer disclosure about deterministic data/gameplay.
- [Global Protocol Steam reviews](https://steamcommunity.com/app/4500270/reviews/) — anecdotal early reports used to identify tutorial, depth, bug and balance risks; not treated as prevalence proof.
- [Geo-Political Simulator 2026 — Steam](https://store.steampowered.com/app/4021780/GeoPolitical_Simulator_2026_Edition/) — breadth, data claims, price/review aggregate and Apple Silicon requirements.
- [Europa Universalis V release features](https://www.paradoxinteractive.com/media/press-releases/press-release/paradox-interactive-sets-date-for-europa-universalis-v) — official population, economy, government and military feature summary.
- [Supreme Ruler 2030 — Steam](https://store.steampowered.com/app/2093410/Supreme_Ruler_2030/) — modern military/economic/diplomatic scope and platform/review aggregate.
- [Terra Invicta — Steam](https://store.steampowered.com/app/1176470/Terra_Invicta/) — geopolitical-faction/space scope, platform and review aggregate.
- [Global Supremacy — Steam](https://store.steampowered.com/app/4808500/Global_Supremacy/) — unreleased advertised feature set only; no gameplay-quality conclusions drawn.

## Simulation baseline data sources

These are candidate primary inputs for versioned offline data packs. Their presence here does not mean that unlike series can be joined without reconciliation, or that every source permits unrestricted redistribution of raw data.

### Population and labour

- [UN World Population Prospects 2024 dataset](https://www.un.org/development/desa/pd/content/world-population-prospects-2024-dataset) — country/area estimates from 1950 to the present and projections, including demographic structure. Pin a release/vintage and preserve estimate status.
- [UN Population Trends](https://www.un.org/development/desa/pd/content/population-trends-0) — definitions and links for demographic series.
- [World Bank Indicators API documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392) — programmatic access to World Development Indicators and other databases, with long historical coverage and no API key for the Indicators API.
- [World Bank indicator metadata queries](https://datahelpdesk.worldbank.org/knowledgebase/articles/898599-indicator-api-queries) — source notes/organizations and units must be ingested along with values.

### Macroeconomics and public finance

- [IMF World Economic Outlook database](https://data.imf.org/Datasets/WEO) — national accounts, inflation, unemployment, fiscal, external-sector and related macro series. A scenario must pin a particular release rather than silently using the newest revision.
- [IMF WEO October 2024 archive](https://www.imf.org/en/Publications/WEO/weo-database/2024/October) — example of a dated vintage for reproducible historical scenario work.
- [World Bank API basic call structure](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures) — dated/ranged queries, formats and metadata behavior for ETL implementation.

### Trade, food, resources and energy

- [UN Comtrade API](https://uncomtrade.org/docs/un-comtrade-api/) — official bilateral goods/service trade access, preview/free/premium limitations and metadata endpoints. Real bilateral reports contain asymmetries that require a documented reconciliation policy.
- [UN Comtrade content and query dimensions](https://uncomtrade.org/docs/content-of-data/) — product, period, reporter, partner and trade-flow dimensions and availability caveats.
- [FAOSTAT](https://www.fao.org/faostat/en/) — agriculture/food data for more than 245 countries/territories from 1961 onward, including bulk/API access.
- [FAO agriculture data collection](https://www.fao.org/statistics/data-collection/agriculture/en) — collection scope and annual frequency for crops, livestock, utilization and producer prices.
- [U.S. EIA API v2 technical documentation](https://www.eia.gov/opendata/documentation.php) — official energy datasets and programmatic hierarchy; an API key is required, so data is imported during pack construction, not queried by campaigns.

### Military

- [SIPRI Military Expenditure Database](https://www.sipri.org/databases/milex) — expenditure series from 1949 onward, GDP share and per-capita views.
- [SIPRI military-expenditure sources and methods](https://www.sipri.org/databases/milex/sources-and-methods) — critical caveat: spending measures resource input and must not be treated directly as military capability/output.
- [SIPRI Arms Transfers Database](https://www.sipri.org/databases/armstransfers) — major conventional arms transfers from 1950 onward.
- [SIPRI arms-transfer sources and methods](https://www.sipri.org/databases/armstransfers/sources-and-methods) — TIV values are trend indicators, not purchase prices, and coverage is not an exhaustive equipment inventory.

Detailed order-of-battle, personnel and equipment baselines will need per-scenario official defence budgets, white papers, parliamentary documents and carefully licensed specialist sources. Missing data must remain a range/estimate; it must not be filled by uncited LLM output.

### Geometry

- [Natural Earth about and terms](https://www.naturalearthdata.com/about/) — public-domain vector/raster map data and disputed-boundary policy.
- [Natural Earth administrative boundary lines](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-boundary-lines-2/) — describes a de-facto display policy and disputed-line attributes. Use as geometry/reference only, not sufficient legal or historical evidence.
- [OpenStreetMap copyright and license](https://www.openstreetmap.org/copyright) — OSM data is reusable under ODbL with attribution/share-alike obligations for the database; review packaging implications before distributing derived transport data.
- [OpenStreetMap road tagging overview](https://wiki.openstreetmap.org/wiki/Highways) and [railway tagging overview](https://wiki.openstreetmap.org/wiki/Railways) — candidate inputs for current transport geometry and attributes, not authoritative historical capacity.
- [OpenStreetMap full-history data](https://wiki.openstreetmap.org/wiki/History_Planet) — contains historical object versions but is extremely large and reflects mapping history/coverage, not guaranteed real-world completeness at each past date. Use targeted extracts and manual review, never as an automatic 2016 truth source.
- [NASA Earthdata LP DAAC / SRTM](https://www.earthdata.nasa.gov/centers/lp-daac) — near-global elevation products at several resolutions for terrain/slope preprocessing.
- [ESA WorldCover data access](https://esa-worldcover.org/en/data-access) — 2020/2021 global 10 m land-cover products, version/accuracy/license details. Useful for modern terrain calibration, not a historical land-cover source for every scenario date.
- [NOAA Climate Data Online](https://www.ncei.noaa.gov/cdo-web/) — global historical weather/climate archive candidate for scenario weather calibration/reference series.

## Government and leader evidence policy

Leader births/deaths, office terms, election results, appointments, resignations and constitutional succession should prefer dated official gazettes, constitutions/statutes, election-management bodies, parliamentary/presidential records and reputable contemporaneous archives. Store the specific source on the person/office event. A biography summary or an LLM answer is not enough to authorize a death or office transition.

## Historical scenario source-acquisition plan

The modern global datasets above do not cover 1916 or 1797 adequately. Before scenario numbers are authored, create a source matrix and license/redistribution review for each required field.

World 1916 priorities, with the Russian path researched first:

- imperial statistical yearbooks, census publications and regional statistical committees;
- budgets, debt/money series, price/wage series and wartime economic reports;
- railway ministry maps, route tables, rolling-stock/throughput reports and port statistics;
- agriculture, grain procurement/distribution, coal/oil/metals and industrial production records;
- official military returns and archival orders of battle, reconciled with reputable scholarly estimates;
- laws, government/State Duma proceedings, ministerial appointments and political-organization records;
- military fronts, occupation and administrative-boundary historical GIS or georeferenced contemporary maps.

World 1797–1815 priorities, with the European theatre researched first:

- contemporary censuses/tax registers and carefully documented historical-demography reconstructions;
- state budgets, debt, customs, subsidies, coin/price series and wartime finance studies;
- dated treaties, coalition membership, dependencies, occupation and boundary changes;
- road, river, canal, port and sailing-route sources with period capability rather than modern geometry alone;
- army/navy returns, recruitment systems, formation/equipment ranges and campaign logistics;
- constitutions, dynastic rules, offices and government transitions;
- historical GIS or georeferenced map series whose licensing permits derived scenario geometry.

For each candidate source record: coverage, date, units, definitions, known bias, access method, redistribution rights, derived-data obligations and reconciliation role. Secondary scholarship may calibrate or reconcile primary evidence; generated AI text is never evidence.

## Territorial-status reference examples

- [UN General Assembly Resolution 68/262 — territorial integrity of Ukraine](https://digitallibrary.un.org/record/767883/files/A_RES_68_262-EN.pdf)
- [OHCHR, eastern Ukraine, 2016](https://www.ohchr.org/en/press-releases/2016/08/eastern-ukraine-casualties-highest-august-2015-zeid)
- [EU Monitoring Mission in Georgia](https://www.eeas.europa.eu/eumm-georgia/eumm-georgia-european-union-monitoring-mission-georgia-civilian-mission_und_en)
- [UN General Assembly coverage concerning Georgia, 2016](https://press.un.org/en/2016/ga11785.doc.htm)

These sources illustrate the need to store recognized sovereignty, effective control and partial control zones separately. They are not by themselves a complete worldwide 2016 territorial dataset.

## Community evidence

Reddit material is anecdotal and is used only to identify repeated user-experience patterns. The direct links used in the analysis are embedded beside the relevant claims in `01-pax-and-community.md`.

## Local evidence

- Code: `/Users/alexey/Projects/open-historia-memory`
- Upstream baseline: `a6315c6`
- Personal branch baseline: `94b62ac`
- Current save inspected under: `/Users/alexey/Library/Application Support/open-historia/server/data/games/modern-day-session`
- User-provided Grok logs: next-speaker, leader response and UI translation calls from 2026-08-28.

## Evidence policy for future scenario work

Every historical scenario assertion that affects ownership, control, alliances, war state, leadership or starting capabilities should carry:

- a source URL or bibliographic reference;
- the date or interval the assertion applies to;
- whether it is fact, disputed interpretation or scenario-author choice;
- the worldview/recognition policy used for map labels;
- a short note when geometry is an approximation.

Avoid treating GADM/administrative geometry as a source for political control. Geometry says where a polygon is; it does not say who legally owns or effectively controls it at a historical date.
