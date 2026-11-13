# Political Transitions Atlas

An interactive, source-linked atlas of **office and governing-authority handovers** and **separately counted collective membership changes**, covering the fixed geographic frame from **11 November 2016 through 11 November 2026**. Research release **S012**, frozen 13 November 2026. Release totals, country coverage and definition alternatives are read from the canonical export rather than duplicated in the interface.

The map opens with **Mechanism** as its default view. Countries with multiple represented mechanisms use equal-width stripes: each stripe indicates a mechanism's presence, without frequency weighting. Explicit shared links can select another view; Reset restores the mechanism view.

Affected country details open with a concise, country-specific coverage note. **Coverage & sources** retains the full office sequences and evidence gaps. Sidebar scrolling and compact controls adapt to short desktop and mobile screens, keeping the Fit records / Save view footer within the panel.

The visual design follows Hugh Lamarque's [Border Closure Atlas](https://lamarque-mapping.github.io/Border-Closure-Atlas/): local Atlas font, green palette, full-screen Leaflet map, Map / Overview / Analysis / Dataset navigation, continent controls and a compact mobile timeline.

## Implementation

The deployable site is in `dist/`. It is buildless HTML, CSS and JavaScript, with all map geometry, fonts, libraries and website data served locally. No API keys, external tile servers or runtime package installation are required.

- `core.js`: pure record selection, date handling and CSV export.
- `map.js`: local Natural Earth geometry, map interaction and current-view PNG export.
- `analysis.js` / `analysis.css`: responsive charts and accessible tables, including annual mechanism lines with visibility controls and exact values.
- `coverage-notes.js`: concise country-specific explanations of the remaining coverage gaps.
- `app.js`: navigation, filters, chronology and source evidence dialogs.
- `data/atlas.json`: allowlisted website export of the frozen register, preserving stable IDs, supported date intervals, country coverage, sources, office sequences and open questions.
- `data/methods.json`: public methodology copy, with release-specific figures and review findings generated from the same source.
- `downloads/`: the completed research workbook, methodology report and the written S012 execution prompt.

## Data rules

The S012 register contains **686 office and authority handovers** and **105 collective membership changes**, kept as separate counting units. The published mechanism classifications remain those of S012. A range represents uncertainty about an event date, not a transition continuing throughout that interval. Monthly selections use inclusive interval overlap, so the same ranged record may appear in multiple months while counting once in the full register.

Annual bars and mechanism lines include only records whose supported dates lie in a single calendar year. The mechanism comparison uses raw annual counts, the map's fixed colours and the same filtered records as the other Analysis views. All represented mechanisms are shown initially; visibility controls and an exact-values table support comparison. Records whose intervals span calendar years are shown separately, with totals reconciled against the full register. 2016 and 2026 are marked as partial observation years. Unknown holders or members are never treated as an empty office or body.

Country coverage distinguishes fully checked sequences from cases with specified evidence or scope gaps. Supported no-transition findings are separate from filtered zero counts. Open questions and held candidates are different registers, and held candidates are excluded from the admitted series. The S012 pass revisited all 21 previously partial countries and 26 partial office sequences. It adds one office or authority transfer and two collective membership changes, with separate source review of 35 adopted proposals. Coverage is complete for 176 countries; 21 retain explicit evidence gaps.

The six definition choices exclude explicit stable-ID sets. They are scope choices rather than completeness bounds. All filters, charts and matching CSV exports apply the same record-selection functions. Country history dialogs intentionally show the full adopted country sequence and explain that scope.

The country frame's Americas subregion is broad. For the display-continent controls only, the twelve South American country codes are explicitly mapped in `core.js`; the source region and subregion fields remain unchanged.

## Verification

```sh
node --check dist/app.js
node --check dist/core.js
node --check dist/map.js
node --check dist/analysis.js
node --check dist/coverage-notes.js
python3 scripts/check-data.py
node scripts/check-site-data.js
```

`check-data.py` verifies export integrity, records, date precision, coverage, annual accounting, sensitivity scenarios and CSV source preservation. `check-site-data.js` independently checks actual website selection semantics, all 121 months, regional partitions, searches, CSV round trips and partial source dates. These CI checks use Python and Node standard libraries; optional local graphics checks are not deployment dependencies.

The export generator preserves the canonical dataset and can regenerate the allowlisted website data from a supplied source directory:

```sh
python3 scripts/export-data.py --source /path/to/political_transitions/data --expect-release S012
python3 scripts/check-data.py --source /path/to/political_transitions/data
```

The required expected-release argument prevents accidentally exporting another research release. An optional `--expected-integrity` manifest checks an independently recorded set of canonical source hashes. Every export records its actual input hashes and output hashes in `dist/data/integrity.json`; release methods are included in that integrity check. The source-aware validator checks canonical IDs, factual fields and all direct source URLs in addition to the exported totals. Export only after the research owner has frozen canonical integration.

## Hosting

Target repository: [Lamarque-Mapping/Political-Transitions](https://github.com/Lamarque-Mapping/Political-Transitions). Intended Pages URL: [https://lamarque-mapping.github.io/Political-Transitions/](https://lamarque-mapping.github.io/Political-Transitions/).

The deployment workflow is configured. GitHub Actions records the result for each published commit. Set **Settings → Pages → Build and deployment → Source: GitHub Actions**. The pinned official actions in `.github/workflows/pages.yml` validate the JavaScript and static data, upload `dist/`, and deploy on a push to `main` or a manual run. Relative internal paths support the repository's Pages subpath. The original Border Closure Atlas repository is independent.

Native Sites metadata in `.openai/` is optional and present only in the Sites checkout. It is excluded from the GitHub repository and is not required for Pages hosting.

For a conventional local development environment, serve `dist/` with a static HTTP server. In the managed Sites environment use the supported `sites-preview` command.

## Attribution

Mapping and dataset: Hugh Lamarque. Research and source review used separate GPT-6 Astra Pro contexts, as disclosed in the website methods. This is not independent human verification or a statistical estimate of global recall.

Base geography: Natural Earth 1:50m, retrieved from the Border Closure Atlas reference. Country shapes and reference points are for browsing; they do not imply positions on sovereignty or locate the exact place where a handover occurred. Map library: Leaflet 1.9.4. Font and Leaflet notices are retained in `dist/vendor/`.

No institutional endorsement or new data licence is inferred from the original atlas.
