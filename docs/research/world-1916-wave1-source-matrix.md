# World 1916 Wave-One Source Matrix

Research cutoff: 2026-08-29. Prepared by the Analyst role for Issue #4.
Scope: Russia, Germany and Britain as the first `Curated` wave of World 1916.

> This matrix is **research evidence, not canonical data**. It contains no
> numeric scenario values. Candidate sources are listed with coverage and
> access notes only. Nothing here may be copied into scenario data without a
> separate, sourced authoring pass and GPT integration review.
> Read-only inputs for this document: `docs/principles.md`,
> `docs/spec/consensus-spec.md`, `docs/product/08-scenario-program.md`,
> `docs/product/research/SOURCES.md`.

---

## 1. Research horizon (project-owner direction, 2026-08-29)

The owner extended the wave-one research window beyond the original
revolutionary/civil-war transition:

- **Main path:** through the NEP period, up to **1928**, for all three polities.
- **Alternative authority paths (Russia):** at least a high-level picture of
  the main non-Bolshevik actors' programs and plans (Kolchak, Denikin, Wrangel,
  the SR/Directory line, Savinkov, Miliukov and the émigré documentation) so
  that NPC behavior can plausibly move in those directions if such actors come
  to power.

This is recorded research scope. It does not change the accepted phase
contract; folding the 1928 window into `consensus-spec.md` and the acceptance
criteria remains a decision for the integration owner (see §9, DN-7).

## 2. How to read the matrix

Each domain lists candidate sources as rows:

| Column | Meaning |
|---|---|
| Source | Name and stable citation/link. Print works get a full bibliographic citation; digitized works get a verified link. |
| Tier | `P` primary (contemporary record), `S` scholarly dataset/monograph, `C` compiled reference, `A` reconstruction/approximation. |
| Coverage | Temporal range the source actually covers. |
| Granularity | National / guberniia-state-region / district-city level. |
| Access & license | Where it is and how it can be used. Copyright is jurisdiction- and work-specific and must be verified per source before any reuse (see §8). "Public-domain scan" below is shorthand for an archive.org digitized copy of a work in the US public domain under the current US rule; UK/European rules differ. |

Validation performed (2026-08-29): every URL in this matrix was checked for
HTTP reachability only — reachability is not bibliographic or content-level
verification. Direct digitized records are pinned to `archive.org` item pages;
generic search and catalogue links (WorldCat, library catalogues) are labelled
"discovery lead" and still need volume/page-level pinning. Access caveats:
`maps.nls.uk` rejects automated clients (browser access only); the GESIS HISTAT
portal (`histat.gesis.org`) was unreachable from the verification host; the
`digizeitschriften.de` service was discontinued on 2025-12-31, so German
yearbook statistics are pinned to direct `archive.org` volume records instead
(see §4.1).

## 3. Data needs of the wave-one slice

From `docs/product/08-scenario-program.md` the starting-state packs require:
administrative regions and effective control; population by region; grain,
coal, oil, metals, industrial capacity and military production; budget,
revenue classes, debt, money/inflation and war expenditure; rail corridors,
gauges, junctions, ports, navigable rivers and strategic roads; formations,
personnel ranges, equipment pools, readiness, replacement and supply;
emperor/government/Duma/Reichstag/Parliament, commanders and movements;
Entente/Central Power commitments, trade access, loans and diplomatic
constraints; calibrated structural pressures at the start date. The extended
horizon adds: NEP-era reconstruction data (to 1928) and high-level alternative
authority paths for Russia.

## 4. Source matrix by domain

### 4.1 Population

| Source | Tier | Coverage | Granularity | Access & license | Relevance |
|---|---|---|---|---|---|
| Первая всеобщая перепись населения Российской империи 1897 г., ЦСК — [archive.org item](https://archive.org/details/perepis_1897) | P | 1897 | Guberniia, uezd | Public-domain scan | Anchor baseline for regional demographics; the only full imperial census. |
| [Демоскоп Weekly census portal](http://www.demoscope.ru/weekly/ssp/census.php?cy=0) (1897), [cy=1](http://www.demoscope.ru/weekly/ssp/census.php?cy=1) (1920), [cy=3](http://www.demoscope.ru/weekly/ssp/census.php?cy=3) (1926) | C | 1897–1926 | Guberniia/republic, uezd/okrug | Unofficial portal; cross-check against scans | Digitized tables for all three censuses in one place, including the 1926 census needed for the NEP window. |
| Статистический ежегодник России (ЦСК annual), e.g. [1911 г.](https://archive.org/details/stat_ezhegodnik_rossii_1911), [1913 г.](https://archive.org/details/1913_20210303) | P | 1904–1916 | National + guberniia | Public-domain scans | Carries ЦСК annual population estimates for 1914–1916, bridging census years. |
| Рашин А.Г., Население России за 100 лет (1811–1913), М., 1956 — [scan](https://archive.org/details/naseleniye_rossii_za_sto_let) | S | 1811–1913 | Guberniia | Scan; Soviet-era methodology noted | Long-run population reconstruction used to sanity-check census figures. |
| Gatrell P., *Russia's First World War: A Social and Economic History*, Pearson, 2005 | S | 1914–1918 | National + regional | Print; library access | Population displacement, refugees and wartime demographic strain; calibrates pressure mechanics. |
| Volkszählung vom 1. Dezember 1910 (Statistik des Deutschen Reichs, Bd. 240) — census volumes via [WorldCat search](https://search.worldcat.org/search?q=Statistik+des+Deutschen+Reichs+Volksz%C3%A4hlung+1910) (discovery lead); summary tables in the 1913 yearbook below | P | 1910 | State (Bundesstaat), Kreis | Print/catalogue; rights per volume | Last full pre-war German census; base for per-region population. Volume-level pinning still needed. |
| Statistisches Jahrbuch für das Deutsche Reich — direct volumes: [1913, Bd. 34](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1913_34), [1916, Bd. 37](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1916_37), [1917, Bd. 38](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1917_38) | P | 1880–1942 (incl. war years) | National + state | Direct archive.org volume records; per-volume reuse terms | Annual official series; wartime volumes hold reduced but authoritative population tables. The former digizeitschriften portal was discontinued 2025-12-31; the archive.org run is the active access path. |
| Census of England and Wales, 1911 — [archive.org item](https://archive.org/details/censusofenglandw03lond); Scotland 1911 via same series | P | 1911 | Registration district | Public-domain scan | Base for per-region British population. |
| [Vision of Britain census reports](https://www.visionofbritain.org.uk/census/) | C | 1801–1961 | District-level tables | Free web access | Navigable index into census reports and boundary units. |
| Statistical Abstract for the United Kingdom, [1913–1928 volume](https://archive.org/details/annual-abstract-of-statistics-gb_1913-1928_73) | P | 1913–1928 | National | Public-domain scan | One volume covers the entire extended window: population, vital statistics, economy. |
| Mitchell B.R., *British Historical Statistics*, Cambridge UP, 1988 | S | 18th c.–1980s | National | Print | Compiled long series with source notes. |

### 4.2 Fiscal and monetary

| Source | Tier | Coverage | Granularity | Access & license | Relevance |
|---|---|---|---|---|---|
| Apostol P.N., Bernatzky M.W., Michelson A.M., *Russian Public Finance During the War*, Yale/Carnegie, 1928 — [scan](https://archive.org/details/russianpublicfin0000mich) | S/P | 1914–1917 | National, revenue/expenditure classes | Public-domain scan | War revenue, expenditure, loans and paper-money issue; canonical Carnegie study. |
| Каценеленбаум З.С., Война и финансово-экономическое положение России, М., 1917 — [scan](https://archive.org/details/katsenelenbaumzsvojnaifinansovoekonom35) | P | 1914–1917 | National | Public-domain scan | Contemporary analysis of war finance and inflation. |
| Katzenellenbaum Z.S., *Russian Currency and Banking, 1914–1924*, P.S. King, 1925 | S | 1914–1924 | National | Print | Monetary aggregates through the civil war into NEP. |
| Отчет Государственного контроля по исполнению государственной росписи (annual) | P | pre-1914–1917 | National, line items | Print/archival (РГИА); not digitized | Executed budgets; see §8 gap note. |
| «Россия 1913 год. Статистико-документальный справочник», ИРИ РАН, СПб., 1995 | C | 1913 | National | Print | Consolidated pre-war fiscal baseline commonly cited in scholarship. |
| Сидоров А.Л., Экономическое положение России в годы первой мировой войны, М., 1973 | S | 1914–1917 | National + sectoral | Print | Standard Soviet-scholarship treatment of war finance and industry. |
| Народное хозяйство Союза С.С.Р. в цифрах, ЦСУ, 1924 — [scan](https://archive.org/details/nartodnoye_khozyaystvo_SSR_v_tsifrakh) | P | 1921–1924 | National + republic | Public-domain scan | NEP-era fiscal and economic totals. |
| «На новых путях. Итоги новой экономической политики 1921–1922 г.г.», М., 1923 — [scan](https://archive.org/details/nanovyhputjahitoginovojekonomicheskojpo90) | P | 1921–1922 | National | Public-domain scan | Early NEP accounting; start of the extended window. |
| Статистический справочник СССР за 1928, М., 1929 — [scan](https://archive.org/details/statisticheskijspravochniksssrza1928m25) | P/C | 1928 | National | Public-domain scan | End-of-NEP snapshot for the 1928 horizon. |
| Lotz W., Die deutsche Staatsfinanzwirtschaft im Kriege, Stuttgart, 1927 — [scan](https://archive.org/details/diedeutschestaat0000unse) | S | 1914–1918 | National | Public-domain scan | Carnegie German series; war finance, debt and money. |
| Statistisches Jahrbuch für das Deutsche Reich — direct volumes [1913](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1913_34) / [1916](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1916_37) | P | 1880–1942 | National | Direct archive.org volume records; per-volume reuse terms | Reich budget, debt and monetary tables through the war and Weimar. |
| Bresciani-Turroni C., *The Economics of Inflation*, London, 1937 — [scan](https://archive.org/details/TheEconomicsOfInflationAStudyOfCurrencyDepreciationInPostWarGermanay) | S | 1914–1923 | National, monthly | Public-domain scan | The standard study of German wartime/post-war inflation. |
| Holtfrerich C.-L., *The German Inflation 1914–1923*, De Gruyter, 1986 | S | 1914–1923 | National | Print | Modern re-examination with extended series. |
| Roesler K., Die Finanzpolitik des Deutschen Reiches im Ersten Weltkrieg, Berlin, 1967 | S | 1914–1918 | National | Print | War-time fiscal policy detail. |
| Hirst F.W., Allen J.E., *British War Budgets*, Oxford, 1926 — [scan](https://archive.org/details/britishwarbudget0000unse) | S/P | 1914–1918 | National | Public-domain scan | Carnegie British series; every war budget analyzed. |
| Kirkaldy A.W., *British Finance During and After the War 1914–21*, London, 1921 — [scan](https://archive.org/details/britishfinancedu00kirk) | S/P | 1914–1921 | National | Public-domain scan | War finance and the early post-war adjustments. |
| Statistical Abstract for the United Kingdom, [1913–1928](https://archive.org/details/annual-abstract-of-statistics-gb_1913-1928_73) | P | 1913–1928 | National | Public-domain scan | Budget, debt, prices, money market tables. |
| [Bank of England, A Millennium of Macroeconomic Data](https://www.bankofengland.co.uk/statistics/research-datasets) ([spreadsheet](https://www.bankofengland.co.uk/-/media/boe/files/statistics/research-datasets/a-millennium-of-macroeconomic-data-for-the-uk.xlsx)) | S/A | annual, long run | National | Official open dataset | Long annual series for prices, money, interest rates crossing the whole horizon. |
| [NBER Macrohistory Database](https://www.nber.org/research/data/nber-macrohistory-database) | S | monthly, long run | National (UK series) | Open access | Monthly UK bank rate, prices and other series up to 1939. |
| Moggridge D.E., *British Monetary Policy 1924–1931*, Cambridge UP, 1972 | S | 1924–1931 | National | Print | Return to gold; anchors the 1928 horizon for Britain. |

### 4.3 Production, agriculture and resources

| Source | Tier | Coverage | Granularity | Access & license | Relevance |
|---|---|---|---|---|---|
| Гриневецкий В.И., Послевоенные перспективы русской промышленности, Харьков/М., 1919/1922 — [scan](https://archive.org/details/grinevetskijviposlevoennyeperspektivyr17) | P | 1914–1918 | Sectoral | Public-domain scan | Contemporary expert survey of Russian industry during the war. |
| Хозяйственная жизнь и экономическое положение населения России за первые 9 месяцев войны, 1916 — [scan](https://archive.org/details/hozjajstvennajazhizniekonomicheskoepolo96) | P | 1914–1915 | National + sectoral | Public-domain scan | Official wartime summary of the economic situation. |
| Данилов Н.А., Влияние великой мировой войны на экономическое положение России, 1922 — [scan](https://archive.org/details/vlijanievelikojmirovojvojnynaekonomiches73) | S | 1914–1917 | National | Public-domain scan | Early Carnegie-linked analysis of war impact. |
| Клаус Р., Война и народное хозяйство России (1914–1917 гг.), М., 1926 — [scan](https://archive.org/details/klausrvojnainarodnoehozjajstvorossii1973) | S | 1914–1917 | National + sectoral | Public-domain scan | Systematic war-economy account. |
| Antsiferov A.N. et al., *Russian Agriculture During the War*, Yale/Carnegie, 1930 — [scan](https://archive.org/details/russianagricultu0000alex) | S/P | 1914–1917 | National + crop | Public-domain scan | Grain area, harvests, procurement during the war. |
| Всероссийская сельскохозяйственная перепись 1916 и 1917 гг. | P | 1916–1917 | Guberniia, uezd | Print/archival; partially published | The only near-war agricultural census; see §8 gap note. |
| Сидоров А.Л., Экономическое положение России в годы первой мировой войны, М., 1973 | S | 1914–1917 | Sectoral | Print | Coal, metal, fuel and factory production series. |
| Skalweit A., Die deutsche Kriegsernährungswirtschaft, Stuttgart, 1927 — [scan](https://archive.org/details/diedeuschekriegs0000prof) | S | 1914–1918 | National | Public-domain scan | Carnegie German series; food supply and rationing. |
| Statistisches Jahrbuch für das Deutsche Reich — direct volumes [1913](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1913_34) / [1916](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1916_37) | P | 1880–1942 | National | Direct archive.org volume records; per-volume reuse terms | Coal, iron, steel and industrial production tables. |
| Hoffmann W.G. et al., *Das Wachstum der deutschen Wirtschaft seit der Mitte des 19. Jahrhunderts*, Springer, 1965 | S | mid-19th c.–1959 | National + sectoral | Print | Standard long-run German production series. |
| *History of the Ministry of Munitions*, 12 vols, HMSO, 1922 — [archive.org item](https://archive.org/details/historyofministr0102grea) | P | 1915–1918 | National | Public-domain scans | British war production organization and output. |
| Beveridge W., *British Food Control*, Yale/Carnegie, 1928 | S/P | 1914–1920 | National | Print (Carnegie series) | Food supply and control for the home front. |
| Statistical Abstract for the United Kingdom, [1913–1928](https://archive.org/details/annual-abstract-of-statistics-gb_1913-1928_73) | P | 1913–1928 | National | Public-domain scan | Production and price tables across the horizon. |
| Dewey P., *British Agriculture in the First World War*, Routledge, 1989 | S | 1914–1918 | National | Print | Modern account of wartime agriculture. |

### 4.4 Transport and logistics

| Source | Tier | Coverage | Granularity | Access & license | Relevance |
|---|---|---|---|---|---|
| Статистический сборник Министерства путей сообщения (annual) — [1920 issue scan](https://archive.org/details/rossijaministerstvoputejsoobschenijast95) | P | 1900s–1917 | Network, line groups | Public-domain scan | Line lengths, rolling stock, freight and passenger traffic. |
| Головин Н.Н., Военные усилия России в мировой войне, Париж, 1939 — [т.1 scan](https://archive.org/details/golovinnnvoennyeusilijarossiivmirovojv28) | S | 1914–1917 | Fronts, army groups | Public-domain scan | Mobilization transport, replacements, supply of the army. |
| Westwood J.N., *A History of Russian Railways*, London, 1964 — [scan](https://archive.org/details/historyofrussian0000jnwe) | S | 19th c.–1960s | Network | Scan; lending-library terms | System capacity and wartime bottlenecks. |
| Statistisches Jahrbuch für das Deutsche Reich — direct volumes [1913](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1913_34) / [1916](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1916_37) | P | 1880–1942 | National | Direct archive.org volume records; per-volume reuse terms | Railways, inland navigation and port statistics. |
| Reichsarchiv, *Der Weltkrieg 1914 bis 1918*, 14 vols, Berlin, 1925–1944 | P/S | 1914–1918 | Front/army level | Print; [WorldCat search](https://search.worldcat.org/search?q=Der+Weltkrieg+1914+bis+1918+Reichsarchiv) (discovery lead) | Official history; rail mobilization and operational logistics. |
| Pratt E.A., *British Railways and the Great War*, London, 1921 — [scan](https://archive.org/details/britishrailwaysg0001edwi) | S/P | 1914–1918 | National | Public-domain scan | Railway control, effort and difficulties. |
| Statistical Abstract for the United Kingdom, [1913–1928](https://archive.org/details/annual-abstract-of-statistics-gb_1913-1928_73) | P | 1913–1928 | National | Public-domain scan | Railway returns and shipping tables. |
| Railway Returns, Board of Trade (annual) | P | pre-1914–1920s | Company-level | Print; not digitized in full | Detail beyond the Statistical Abstract; see §8 gap note. |

### 4.5 Military, mobilization and casualties

| Source | Tier | Coverage | Granularity | Access & license | Relevance |
|---|---|---|---|---|---|
| Россия в мировой войне 1914–1918 гг. (в цифрах), ЦСУ, М., 1925 — [scan](https://archive.org/details/rossia_v_mirovoi_voine) | P | 1914–1918 | National | Public-domain scan | Canonical Russian statistical compilation: mobilized, losses, equipment, supply. |
| Головин Н.Н., Военные усилия России в мировой войне — [т.1](https://archive.org/details/golovinnnvoennyeusilijarossiivmirovojv28), [т.2](https://archive.org/details/golovinnnvoennyeusilijarossiivmirovojv0) | S | 1914–1917 | Fronts | Public-domain scans | Military effort reconstruction; loss methodology debated. |
| Golovine N.N., *The Russian Army in the World War*, Yale, 1931 — [scan](https://archive.org/details/russianarmyinwor0000nich) | S | 1914–1917 | Fronts | Public-domain scan | English version of the above. |
| Кривошеев Г.Ф. (ред.), Россия и СССР в войнах XX века: Потери вооруженных сил, М., 2001 | S | 20th c. | National | Print | Modern loss accounting; methodology contested — pair with the above. |
| Урланис Б.Ц., Войны и народонаселение Европы, М., 1960 | S | 17th–20th c. | National | Print | Comparative demographic loss methodology. |
| Knox A., *With the Russian Army 1914–1917*, London, 1921 — [scan](https://archive.org/details/withrussianarmy101knoxuoft) | P | 1914–1917 | Army/front | Public-domain scan | British liaison memoir; qualitative command/supply evidence. |
| Военная энциклопедия, СПб., 1911–1915, 18 т. — [scan example](https://archive.org/details/voennajaentsiklopedijaspb19111915t41) | P/C | 1910s | Topic entries | Public-domain scans | Period reference for formations, weapons, organization. |
| Reichsarchiv, *Der Weltkrieg 1914 bis 1918*, 14 vols, Berlin, 1925–1944 | P/S | 1914–1918 | Army/front | Print; [WorldCat search](https://search.worldcat.org/search?q=Der+Weltkrieg+1914+bis+1918+Reichsarchiv) (discovery lead) | German official operations history; force levels and deployments. |
| Sanitätsbericht über das Deutsche Heer, Berlin, 1934–1938 | P | 1914–1918 | Army level | Print; [WorldCat search](https://search.worldcat.org/search?q=Sanit%C3%A4tsbericht%20%C3%BCber%20das%20deutsche%20Heer) (discovery lead) | Official German casualty statistics; the standard loss source. |
| Ludendorff E., Meine Kriegserinnerungen, Berlin, 1919 — [scan](https://archive.org/details/erich-ludendorff-meine-kriegserinnerungen-1919-664-s.-scan-fraktur) | P | 1914–1918 | High command | Public-domain scan | Memoir; strong self-serving bias, use for plans/intent only. |
| *Statistics of the Military Effort of the British Empire During the Great War*, War Office, 1922 — [scan](https://archive.org/details/statisticsofmili00grea) | P | 1914–1920 | National + theatre | Public-domain scan | Canonical British compilation: personnel, formations, casualties, production. |
| *History of the Great War Based on Official Documents* (Military Operations and Statistics volumes), HMSO — [example](https://archive.org/details/mil-op-fb-1918-v5) | P | 1914–1919 | Theatre | Public-domain scans | British official history; operations and logistics detail. |
| Naval Staff Monographs (Historical), Admiralty, 1920s — [archive.org items](https://archive.org/details/navalstaffmono1914) | P | 1914–1919 | Naval stations | Public-domain scans | Naval operations analysis, incl. Baltic and North Sea. |
| Jane's Fighting Ships (annual, 1914–1919 editions), Sampson Low | P/C | 1914–1919 | Ship level | Print | Contemporary naval strengths for all three polities. |
| Conway's All the World's Fighting Ships 1906–1921, Conway, 1985 | C | 1906–1921 | Ship level | Print | Modern compiled reference reconciling fleet data. |

### 4.6 Political, administrative and diplomatic

| Source | Tier | Coverage | Granularity | Access & license | Relevance |
|---|---|---|---|---|---|
| Падение царского режима, 7 т., Л., 1924–1927 — [т.6 scan](https://archive.org/details/padenietsarskogorezhimat6doprosyipoka73) | P | 1916–1917 | Person-level testimony | Public-domain scans | Interrogations of ministers and officials; regime mechanics. |
| Государственная Дума, Стенографические отчеты, 1906–1917 | P | 1906–1917 | Sitting-level | Print; digitized at [ГПИБ](https://www.shpl.ru/) and [Президентская библиотека](https://www.prlib.ru/) | Duma proceedings for 1916–1917; the parliamentary record. |
| Набоков В.Д., Временное правительство, 1924 — [scan](https://archive.org/details/nabokovvdvremennoepravitelstvovospo97) | P | 1917 | National | Public-domain scan | Insider account of the Provisional Government. |
| Февральская революция: мемуары, 1926 — [scan](https://archive.org/details/fevralskajarevoljutsijamemuaryrodzja79) | P | 1917 | Person-level | Public-domain scan | Memoirs of Rodzianko, Miliukov, Kerensky, Shulgin, Denikin. |
| Милюков П.Н., Россия на переломе, Париж, 1927 — [т.2 scan](https://archive.org/details/rossijanaperelomet2antibolshevistsko97) | P | 1917–1920 | National | Public-domain scan | Bolshevik and anti-Bolshevik paths; key for alternative-path work. |
| Florinsky M.T., *The End of the Russian Empire*, Yale, 1931 — [scan](https://archive.org/details/bendofrussianemp0000mich) | S | 1914–1917 | National | Public-domain scan | Carnegie political study of the imperial collapse. |
| Международные отношения в эпоху империализма, серия III, 1914–1917 — [scan](https://archive.org/details/mezhdunarodnyeotnoshenijavepohuimperiali57) | P | 1914–1917 | Document-level | Public-domain scans | Russian diplomatic correspondence of the war years. |
| Carr E.H., *A History of Soviet Russia*, 14 vols, 1950–1978 — [example](https://archive.org/details/bolshevikrevolut0003edwa) | S | 1917–1929 | National | Print/scans | Standard political history through the NEP period. |
| Ленин В.И., Полное собрание сочинений, 5-е изд., тт. 41–45 | P | 1921–1923 | Speech/text level | Print | NEP-era policy texts for the extended window. |
| [Istmat](https://istmat.org/) — digitized Soviet documents | C/P | 1917–1928 | Document-level | Free web access | Party congress transcripts, Госплан control figures, NEP documents. |
| [Reichstagsprotokolle](https://www.reichstagsprotokolle.de/) | P | 1867–1942 | Sitting-level | Open access | Complete digitized Reichstag debates incl. 1914–1918 sessions. |
| [Protokolle des Preußischen Staatsministeriums (Acta Borussica NF)](https://preussenprotokolle.bbaw.de/) | P | 1817–1934 | Cabinet meetings | Open access | Prussian cabinet during the war; war-aims and administration evidence. |
| [Akten der Reichskanzlei: Weimarer Republik](https://aktenreichskanzlei.bundesarchiv.de/) | P | 1918–1933 | Cabinet meetings | Open access | Cabinet protocols for the extended 1918–1928 window. |
| *Official German Documents Relating to the World War*, Carnegie, 1923 — [scan](https://archive.org/details/officialgermando00unse) | P | 1914–1919 | Document-level | Public-domain scan | Translated Reichstag inquiry materials and white books. |
| Die Große Politik der Europäischen Kabinette 1871–1914 — [scan](https://archive.org/details/diegrossepolitik0039unse) | P | 1871–1914 | Document-level | Public-domain scans | German diplomatic documents to war outbreak. |
| Fischer F., *Germany's Aims in the First World War*, 1961/1967 | S | 1914–1918 | National | Print | Controversial but foundational scholarship on German war aims. |
| [Hansard](https://hansard.parliament.uk/) | P | 1803–present | Sitting-level | Open access | Commons/Lords debates for 1914–1928. |
| Gooch G.P., Temperley H., *British Documents on the Origins of the War 1898–1914*, 11 vols — [scan](https://archive.org/details/britishdocuments11grea) | P | 1898–1914 | Document-level | Public-domain scans | British diplomatic record to war outbreak. |
| Lloyd George D., *War Memoirs*, 6 vols, 1933–1936 — [т.4 scan](https://archive.org/details/warmemoirsofdavi0004davi) | P | 1914–1918 | National | Public-domain scans | Prime-ministerial memoir; bias noted, use for intent. |
| [The National Archives, Discovery catalogue](https://discovery.nationalarchives.gov.uk/) | P | incl. 1914–1928 | Document-level | Free catalogue access | Cabinet (CAB 23/24/37), War Office, Foreign Office series. |
| [Parliamentary Archives](https://archives.parliament.uk/) (collections now serviced via The National Archives) | P | incl. 1914–1928 | Document-level | Free catalogue access | Lloyd George papers and related political collections. |

### 4.7 Trade and naval power

| Source | Tier | Coverage | Granularity | Access & license | Relevance |
|---|---|---|---|---|---|
| Обзор внешней торговли России по европейской и азиатской границам (annual) — [scan](https://archive.org/details/obzor_vneshnei_torgovli_rossii) | P | 1890s–1917 | Commodity level | Public-domain scan | Russian customs returns; import/export structure. |
| Боевая летопись русского флота, М., 1948 — [scan](https://archive.org/details/boevajaletopisrusskogoflota72) | P/S | 1914–1918 | Ship/action level | Scan | Soviet-era chronicle of Russian fleet operations. |
| Nolde B.E., *Russia in the Economic War*, Yale/Carnegie, 1928 | S/P | 1914–1917 | National | Print | Blockade, economic warfare and trade disruption. |
| Statistisches Jahrbuch für das Deutsche Reich — direct volumes [1913](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1913_34) / [1916](https://archive.org/details/per_statistisches-jahrbuch-fur-das-deutsche-reich_statistisches-jahrbuch-fr-das-deutsc_1916_37) | P | 1880–1942 | National | Direct archive.org volume records; per-volume reuse terms | German trade, shipping and naval budget tables. |
| Marine-Archiv, *Der Krieg zur See 1914–1918*, Berlin, 1920–1937 | P/S | 1914–1918 | Naval theatre | Print; [WorldCat search](https://search.worldcat.org/search?q=Der+Krieg+zur+See+1914+1918) (discovery lead) | German official naval history; Baltic/U-boat volumes matter most here. |
| Statistical Abstract for the United Kingdom, [1913–1928](https://archive.org/details/annual-abstract-of-statistics-gb_1913-1928_73) | P | 1913–1928 | National | Public-domain scan | Trade and shipping tables across the horizon. |
| Fayle C.E., *The War and the Shipping Industry*, Yale/Carnegie, 1927 — [scan](https://archive.org/details/warshippingindus0000unse) | S/P | 1914–1918 | National | Public-domain scan | Merchant shipping, losses and freight during the war. |
| Salter A., *Allied Shipping Control*, Oxford, 1921 — [scan](https://archive.org/details/alliedshippingco0000salt) | S/P | 1916–1919 | National | Public-domain scan | Inter-allied tonnage allocation; import policy. |
| Dearle N.B., *An Economic Chronicle of the Great War for Great Britain & Ireland 1914–1919*, Oxford, 1929 — [scan](https://archive.org/details/economicchronicl0000nbde) | S/P | 1914–1919 | National | Public-domain scan | Month-by-month economic and trade record. |
| [Lloyd's Register Foundation ship archive](https://hec.lrfoundation.org.uk/archive-library/ships) | P | 1764–present | Ship level | Free web access | Merchant fleet composition for all flags. |

### 4.8 Territory, boundaries, fronts and occupation

| Source | Tier | Coverage | Granularity | Access & license | Relevance |
|---|---|---|---|---|---|
| [David Rumsey Map Collection](https://www.davidrumsey.com/) | P/C | incl. 1914–1918 | Georeferenced sheets | Free web access | WWI-era general and theatre maps for front/occupation geometry. |
| National Library of Scotland, WWI trench maps — [maps.nls.uk](https://maps.nls.uk/ww1/) | P | 1914–1918 | Trench-level sheets | Browser access only (rejects automated clients) | Western Front trench maps; license terms must be checked before derived reuse. |
| [Avalon Project, 20th Century documents](https://avalon.law.yale.edu/20th_century/) | P | 1909–1928 | Treaty-level | Open access | Treaty texts for the slice: [Brest-Litovsk](https://avalon.law.yale.edu/20th_century/brest.asp), [Sykes-Picot](https://avalon.law.yale.edu/20th_century/sykes.asp), [Balfour Declaration](https://avalon.law.yale.edu/20th_century/balfour.asp), [Rapallo](https://avalon.law.yale.edu/20th_century/rapallo_001.asp), [Locarno](https://avalon.law.yale.edu/20th_century/locarno_001.asp). |
| Natural Earth and OSM geometry — see `docs/product/research/SOURCES.md` | C | present-day | Vector geometry | PD/ODbL respectively | Modern geometry only; historical boundaries must be authored on top. |

### 4.9 Cross-country compiled datasets

| Source | Tier | Coverage | Granularity | Access & license | Relevance |
|---|---|---|---|---|---|
| [Maddison Project Database 2023](https://www.rug.nl/ggdc/historicaldevelopment/maddison/releases/maddison-project-database-2023) | A | long run, incl. 1913/1916 | National | Open access | GDP/population estimates; approximation tier — for comparison only. |
| Mitchell B.R., *International Historical Statistics: Europe 1750–2005*, Palgrave, 6th ed., 2007 | S | 1750–2005 | National | Print | Compiled long series for all three polities; the usual reconciliation backbone. |
| [Correlates of War datasets](https://correlatesofwar.org/data-sets/) | S/A | 1816–present | National | Open access | National Material Capabilities (iron/steel, energy, personnel), trade, alliances; approximate by construction. |
| [CLIO-INFRA](https://clio-infra.eu/) | A | long run | National | Open access | Global historical indicators; reconstructed, use for calibration only. |
| Harrison M. (ed.), *The Economics of World War I*, Cambridge UP, 2005 | S | 1914–1918 | National | Print | Gatrell (Russia), Ritschl (Germany), Broadberry & Howlett (UK); the standard comparative baseline. |
| [NBER Macrohistory Database](https://www.nber.org/research/data/nber-macrohistory-database) | S | monthly, long run | National (UK/US/DE/FR) | Open access | Monthly series spanning 1914–1928 for money and prices. |
| [Bank of England Millennium dataset](https://www.bankofengland.co.uk/statistics/research-datasets) | S/A | annual, long run | National | Official open dataset | Long UK series incl. the 1918–1928 window. |

## 5. Alternative authority paths (Russia, high level)

Owner direction: research the main non-Bolshevik actors' programs well enough to
model their behavior if they come to power. Tier labels as above; these are
sources about plans and programs, not scenario facts.

| Source | Tier | Coverage | Granularity | Access & license | Relevance |
|---|---|---|---|---|---|
| Деникин А.И., Очерки русской смуты, 5 т., Париж/Берлин, 1921–1926 — [scan](https://archive.org/details/denikinaiocherkirusskojsmutyv5tit24); English: *The Russian Turmoil* — [scan](https://archive.org/details/russianturmoilme00deniuoft) | P | 1917–1920 | Army/policy level | Public-domain scans | White movement's own account; programs, dilemmas, decisions. |
| Врангель П.Н., Записки — English: *The Memoirs of General Wrangel* — [scan](https://archive.org/details/the-memoirs-of-general-wrangel) | P | 1916–1920 | Army/policy level | Public-domain scan | Crimean stage of the White movement; state-building practice. |
| Допрос Колчака, Л., 1925 | P | 1918–1920 | Person-level | Print; [WorldCat search](https://search.worldcat.org/search?q=%D0%94%D0%BE%D0%BF%D1%80%D0%BE%D1%81%20%D0%9A%D0%BE%D0%BB%D1%87%D0%B0%D0%BA%D0%B0) (discovery lead) | Interrogation transcripts of the White Supreme Ruler. |
| Гинс Г.К., Сибирь, союзники и Колчак, Пекин, 1921 — [т.2 scan](https://archive.org/details/sibirsojuznikiikolchakt2ch2i3verh82) | P | 1918–1920 | Government level | Public-domain scan | Inside account of the Omsk government machinery. |
| Савинков Б.В., Борьба с большевиками, Варшава, 1920 — [scan](https://archive.org/details/savinkovbvborbasbolshevikamivarsha71) | P | 1918–1920 | Movement level | Public-domain scan | SR-military line; third-force plans. |
| Лукомский А.С., Воспоминания, 1922 — [scan](https://archive.org/details/lukomskijasvospominanijageneralaaslu36) | P | 1914–1920 | High command | Public-domain scan | Volunteer Army staff perspective. |
| Архив русской революции, 22 т., под ред. И.В. Гессена, Берлин, 1921–1937 — [т.8 scan](https://archive.org/details/B-001-027-100-IMAGES) | P | 1917–1922 | Document-level | Public-domain scans | Émigré document collection; White government acts and plans. |
| Белое дело. Генерал Корнилов — [scan](https://archive.org/details/B-001-026-095-ALL) | P/C | 1917–1918 | Document-level | Scan | Documentary collection on the Kornilov line. |
| [Hoover Institution Library & Archives](https://www.hoover.org/library-archives) | P | 1917–1922 | Fond-level | On-site/digitized portions | White émigré personal papers (Denikin, Wrangel and others); the main unpublished body. |
| Kenez P., *Civil War in South Russia 1918*, California UP, 1971; *1919–1920*, 1977 — [vol.2 scan](https://archive.org/details/civilwarinsouthr0000kene) | S | 1918–1920 | Regional | Print/scan | Standard scholarly treatment of the southern Whites. |
| Pereira N.G.O., *White Siberia: The Politics of Civil War*, 1996 — [scan](https://archive.org/details/whitesiberiapoli0000pere) | S | 1918–1920 | Regional | Scan | Scholarly treatment of Kolchak-era Siberia. |
| Smele J.D., *The 'Russian' Civil Wars 1916–1926*, Hurst, 2015 | S | 1916–1926 | National | Print | Synthetic overview covering all fronts and actors. |
| Mawdsley E., *The Russian Civil War*, 1987/2007 | S | 1917–1921 | National | Print | Standard narrative; useful for behavior baselines. |

## 6. Definition and boundary conflicts (flagged, not resolved)

These incompatibilities must be reconciled at authoring time; this document
only flags them.

1. **Russian territorial basis.** By 1916 the western guberniias were partly
   under enemy occupation; ЦСУ yearbook totals for 1914–1916 mix pre-war and
   wartime territory. A Russian "population in 1916" therefore depends on the
   chosen territorial definition. Same issue for fiscal and production data.
2. **Calendar.** Russian official records use the Julian calendar until
   February 1918 (13-day offset). Mixing Russian and Western sources without a
   conversion rule produces date errors on every boundary event.
3. **Fiscal years.** UK and German fiscal years run April–March; Russian fiscal
   years follow the calendar year. Series cannot be joined on "year" alone.
4. **Units.** Russian sources use puds, vershoks, chetverts; UK coal figures use
   long tons; German series use metric. Each import needs an explicit unit
   conversion with provenance.
5. **Casualty and manpower definitions.** Russian military losses differ
   sharply between ЦСУ (1925), Golovine (1931/1939), Urlanis (1960) and
   Krivosheev (2001) because battle-death, captured and demographic-loss
   definitions differ. The scenario's manpower/casualty ledger must pick one
   standard per series.
6. **British Empire vs United Kingdom.** British manpower, trade and naval
   statistics are frequently published as "British Empire"; the scenario needs
   a decision on metropole-only ledgers versus an empire aggregate.
7. **German wartime totals include occupied territories.** Some wartime German
   production figures cover occupied Belgium/Luxembourg/Poland; home-Reich
   splits require separate reconciliation.
8. **Soviet-period reconstructions.** Russian pre-1917 series reconstructed in
   Soviet scholarship (Лященко, Сидоров, and later handbooks) carry
   methodology assumptions; pair them with contemporary sources.
9. **German statistics access.** GESIS HISTAT (`histat.gesis.org`) was
   unreachable at verification time, and the `digizeitschriften.de` portal was
   discontinued on 2025-12-31. German yearbook series are pinned to direct
   `archive.org` volume records (§4); other German long series require print
   volumes until an active digital alternative is confirmed.

## 7. Known gaps

- **Russian guberniia-level wartime data** (budget execution, procurement,
  regional prices) is largely in archives (РГИА, РГВИА) and not digitized;
  extraction requires archival work or reliance on scholarly reconstructions.
- **Всероссийская сельскохозяйственная перепись 1916/1917** exists in print
  and archives but is not comprehensively digitized; it is the only near-war
  agricultural census.
- **1916–1917 Russian monthly price/wage series** are fragmentary outside
  Каценеленбаум and the Carnegie series.
- **German regional (Bundesstaat) wartime data** is sparse; the Statistisches
  Jahrbuch is national-level after 1914.
- **British regional food/industry data** for 1916 is partial; Ministry of
  Munitions and Food histories are national.
- **Front/occupation geometry for 1916-01-01** has no single open dataset;
  NLS trench maps cover the Western Front, Eastern-front mapping is scattered
  (Rumsey and archival collections).
- **White-government program documents** are scattered across Архив русской
  революции and the Hoover collections; no consolidated machine-readable
  dataset exists.
- **Jane's Fighting Ships** is not freely digitized in full; use print
  libraries or Conway's compiled reference.
- **Railway Returns (UK)** and **Статистический сборник МПС** full runs are
  only partially digitized.

## 8. License and redistribution rules

- Copyright is jurisdiction- and work-specific. In the US the current rule
  covers works published before 1931 ([Copyright Office Circular 15a](https://www.copyright.gov/circs/circ15a.pdf)); UK literary
  works generally use life+70 with special rules for Crown, archival and
  unpublished material ([gov.uk guide](https://www.gov.uk/copyright/how-long-copyright-lasts)). Factual-data
  reuse, scan/text reuse and edition-specific rights are separate questions:
  verify each source before any redistribution, and note that archive hosts
  impose their own service terms on bulk reuse of their scans.
- Do not copy raw values from any source into canonical scenario data without
  provenance records (units, effective date, source, confidence) per AC-5.
- Derived transport geometry from OpenStreetMap carries ODbL share-alike
  obligations (see `docs/product/research/SOURCES.md`).
- NLS trench-map reuse requires checking their stated license before derived
  geometry is published.
- Reconstructed datasets (Maddison, CLIO-INFRA, COW) may be cited for
  calibration but must be recorded as approximations with their release
  vintage.

## 9. DECISION NEEDED register

For GPT integration review; each item lists evidence and options. Nothing
below was settled by this document.

- **DN-1 — Territorial basis for Russian 1916 statistics.**
  Evidence: occupation of western guberniias makes ЦСУ totals ambiguous
  (§6.1). Options: (a) pre-war 1913 territory baselines with explicit
  occupation deltas; (b) 1916 effective-control territory snapshots; (c) both,
  as separate ledgers.
- **DN-2 — Calendar convention.**
  Evidence: Julian/Gregorian offset in Russian sources (§6.2). Options:
  (a) canonical Gregorian dates with source-date provenance; (b) dual-date
  storage; (c) Julian canonical with offset at display.
- **DN-3 — Unit normalization.**
  Evidence: pud/ton/fiscal-year incompatibilities (§6.3, §6.4). Options:
  (a) canonical SI with conversion provenance; (b) original units plus a unit
  field; (c) mixed by domain.
- **DN-4 — Russian population baseline.**
  Evidence: 1897 census + ЦСК estimates vs wartime adjustments (§6.1, §7).
  Options: (a) authored regional figures with ranges; (b) census plus
  deterministic derating rules; (c) scholarly reconstruction (Рашин/Gatrell)
  as baseline.
- **DN-5 — Casualty/manpower accounting standard.**
  Evidence: conflicting series (§6.5). Options: (a) one canonical series per
  ledger with provenance; (b) stored range plus chosen estimate; (c) multiple
  observations with a resolution rule.
- **DN-6 — Empire vs metropole aggregation (Britain).**
  Evidence: §6.6. Options: (a) UK home-islands core with a separate colonial
  aggregate; (b) one empire ledger; (c) per-ledger choice.
- **DN-7 — Scope of the 1928 window.**
  Evidence: owner direction 2026-08-29 extends research to NEP 1928; the phase
  contract still ends at the civil-war transition. Options: (a) Russia full
  fidelity to 1928, Germany/Britain baseline only; (b) all three full; (c)
  matrix only, no contract change yet.
- **DN-8 — Alternative-path actor set.**
  Evidence: owner direction asks for high-level behavior for non-Bolshevik
  winners. Options: (a) minimal set (Kolchak, Denikin, Wrangel); (b) program
  families (military dictatorship / SR-constituent / restoration); (c) full
  roster incl. Savinkov, Miliukov, regional movements.
- **DN-9 — German wartime production territory.**
  Evidence: §6.7. Options: (a) home-Reich split authored explicitly; (b) one
  series with a territory flag; (c) defer to wave 2.
- **DN-10 — Divergence baseline for 1918–1928 in `aiHistoryMode: conditional`.**
  Evidence: after a divergent revolution, the "historical path" used by the
  conditional mode is undefined. Options: (a) no reference path once the
  historical government falls; (b) Soviet path remains the reference until a
  validated regime change; (c) author-defined reference anchors.

## 10. Validation performed

- All URLs in §4–§5 checked for HTTP reachability on 2026-08-29; access
  caveats recorded in §2 and §6. Reachability is not content verification:
  generic search/catalogue links are labelled "discovery lead" and still need
  volume/page-level pinning.
- High-priority sources still requiring volume/page-level pinning: Statistik
  des Deutschen Reichs census volumes (1910), Отчет Государственного контроля
  (Russian executed budgets), Всероссийская сельскохозяйственная перепись
  1916/1917, Railway Returns (UK), Jane's Fighting Ships 1914–1919 editions,
  GESIS HISTAT series.
- No numeric historical values are included in this matrix.
- `git diff --check` run at handoff.
