#!/usr/bin/env python3
"""Export a frozen register as a small, auditable website view model.

The source register is never modified. Run with --source pointing at its data
directory. Public export fields are explicitly allowlisted; review histories,
agent identities, private paths and tool references are not shipped.
"""
from __future__ import annotations

import argparse
import collections
import csv
from datetime import date
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

SOURCE_NAMES = (
    "events", "structural_changes", "office_chains", "country_frame",
    "follow_up", "analysis", "inclusion_sensitivity",
)

EVENT_FIELDS = (
    "event_id", "structural_record_id", "country_code", "country", "office_key",
    "office", "collective_body", "event_date", "date_precision", "date_start",
    "date_end", "outgoing", "incoming", "mechanism", "governing_group_change",
    "summary", "caveats", "authority_status", "unit_kind", "date_basis", "episode_id",
    "composition_completeness", "related_follow_up_ids", "unresolved_points",
    "governing_group_change_note", "governing_group_note", "mechanism_note",
    "mechanism_secondary", "authority_dimension", "incoming_status",
)
COUNTRY_FIELDS = (
    "country_code", "country", "region", "subregion", "frame_group", "m49_code",
    "coverage_status", "no_transition_verified", "verified_event_count",
    "verified_structural_change_count", "remaining_work", "notes", "checked_through",
    "latest_holder_evidence_date",
)
CHAIN_FIELDS = (
    "office_key", "office", "in_scope", "coverage_status", "authority_kind",
    "authority_status", "unit_kind", "opening_holder", "closing_holder",
    "opening_members", "closing_members", "office_start", "office_end", "tracked_from",
    "tracked_until", "sequence_checked_through", "latest_holder_evidence_date",
    "scope_notes", "scope_status", "continuity_notes", "sequence_notes", "remaining_gaps",
    "gaps", "residual_uncertainties", "endpoint_limitation", "reopening_trigger",
    "related_follow_up_ids", "no_transition_claim",
)
QUESTION_FIELDS = (
    "case_id", "country_code", "country", "office_key", "type", "status", "reason",
    "required_action", "reopening_trigger", "unit_kind", "unresolved_points", "note",
    "possible_event_date_start", "possible_event_date_end", "count_implications",
    "date_claim_limitation", "incoming_members", "departing_members",
    "related_structural_record_ids",
)


def pick(row, fields):
    return {key: row[key] for key in fields if key in row}


def urls(value):
    if isinstance(value, str):
        return [u.strip() for u in value.splitlines() if u.strip()]
    if isinstance(value, list):
        return [u for v in value for u in urls(v)]
    if isinstance(value, dict) and value.get("url"):
        return [value["url"]]
    return []


def sources(row, extra=()):
    """Keep every direct source and verified URL, preserving available metadata."""
    out = {}
    for key in ("sources", "source_metadata", *extra):
        items = row.get(key, [])
        if isinstance(items, dict):
            items = [items]
        if not isinstance(items, list):
            items = []
        for item in items:
            if isinstance(item, str):
                item = {"url": item}
            if not isinstance(item, dict) or not item.get("url"):
                continue
            url = item["url"].strip()
            item = pick(item, ("url", "title", "publisher", "published_date"))
            out.setdefault(url, {"url": url})
            for k, v in item.items():
                if v is not None and not out[url].get(k):
                    out[url][k] = v
    for key in ("verified_source_urls", "source_urls"):
        for url in urls(row.get(key)):
            out.setdefault(url, {"url": url})
    # A descriptive title fallback is a hostname, never an invented source title.
    for source in out.values():
        source.setdefault("title", urlsplit(source["url"]).netloc)
        source.setdefault("publisher", None)
        source.setdefault("published_date", None)
    return list(out.values())


def record(row):
    out = pick(row, EVENT_FIELDS)
    for key in ("event_date", "unit_kind", "authority_status", "caveats"):
        out.setdefault(key, None)
    out["sources"] = sources(row)
    # Replace a provenance path in three public caveats with a readable label.
    # The historical/interpretative content and the canonical files are unchanged.
    if isinstance(out.get("caveats"), str):
        out["caveats"] = out["caveats"].replace(
            "batches/S003C/reviews/africa_west_caribbean.json", "an earlier source review"
        )
    return out


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def csv_value(value):
    # JSON arrays preserve member boundaries; an empty field is unknown, not vacancy.
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, bool):
        return "true" if value else "false"
    return value


def write_csv(path, rows, fields):
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            row = dict(row)
            row["source_urls"] = "\n".join(x["url"] for x in row.get("sources", []))
            writer.writerow({k: csv_value(row.get(k)) for k in fields})


def display_date(value):
    return date.fromisoformat(value).strftime("%d %B %Y").lstrip("0")


def methods_for_release(template, atlas, results):
    """Render public quantitative copy from the same records as the interface."""
    methods = json.loads(json.dumps(template))
    meta, analysis = atlas["meta"], atlas["analysis"]
    start, end, released = map(display_date, (
        meta["windowStart"], meta["windowEnd"], meta["researchDate"],
    ))
    methods["version"] = meta["release"]
    methods["window"] = {
        "start": meta["windowStart"], "end": meta["windowEnd"],
        "frozen": meta["researchDate"], "label": f"{start} – {end}",
    }
    overview = methods["overview"]
    overview["introduction"] = (
        f"Explore documented changes in who held national executive office or governing authority between {start} and {end}. "
        "Select a country or period to see the leadership sequence, how each transfer occurred and the evidence behind it."
    )
    for card, key in zip(overview["cards"], (
        "totalHandovers", "totalCollectiveChanges", "countryCases", "fullWindowCases",
    )):
        card["value"] = meta[key]
    overview["cards"][3]["detail"] = (
        "All relevant leadership sequences in these countries pass full-period checks under the stated definition. "
        f"{meta['partialCases']} cases still have identified gaps."
    )
    overview["release_note"] = (
        f"Research version {meta['release']}, updated on {released}. "
        f"Events are recorded only through {end}."
    )
    sections = {section["id"]: section for section in methods["methods"]}
    sections["collective"]["paragraphs"][1] = (
        f"The atlas contains {meta['totalCollectiveChanges']} collective membership changes and "
        f"{meta['totalHandovers']} office and authority handovers. Each series counts a different kind of change, "
        "so their totals remain separate. A country can have collective changes even when it has no individual handovers."
    )
    event_precision = collections.Counter(row["date_precision"] for row in atlas["events"])
    collective_precision = collections.Counter(row["date_precision"] for row in atlas["collective"])
    sections["dates"]["paragraphs"][1] = (
        f"Of the {meta['totalHandovers']} handovers, {event_precision['day']} have an exact day and "
        f"{event_precision['range']} have a supported date interval. The collective series contains "
        f"{collective_precision['day']} exact dates and {collective_precision['range']} intervals. "
        "An interval gives the earliest and latest supported dates for a single event. "
        "It does not describe a transition that lasted throughout that period."
    )
    cross_year_events = [row for row in atlas["events"] if row["date_start"][:4] != row["date_end"][:4]]
    cross_year_collective = [row for row in atlas["collective"] if row["date_start"][:4] != row["date_end"][:4]]
    sections["dates"]["paragraphs"][2] = (
        "Date intervals appear in a filtered view when they overlap the selected period, and remain labelled as uncertain. "
        "The annual chart shows intervals that cross calendar years separately. Its bars therefore include "
        f"{len(atlas['events']) - len(cross_year_events)} handovers and "
        f"{len(atlas['collective']) - len(cross_year_collective)} collective changes; "
        f"{len(cross_year_events)} handovers and {len(cross_year_collective)} collective change{'s' if len(cross_year_collective) != 1 else ''} have cross-year intervals."
    )
    sections["coverage"]["paragraphs"] = [
        f"All {meta['countryCases']} cases have been researched. In {meta['fullWindowCases']}, every relevant leadership sequence "
        f"has been checked for the full period. The other {meta['partialCases']} have identified gaps in evidence or office scope. "
        "A verified event remains usable when its country's wider sequence is incomplete.",
        "A full-period check covers the opening holder, intervening changes and continuity through "
        f"{end}. It also explains vacancies and overlapping claims. Finding the same holder at both endpoints is insufficient on its own.",
        f"{meta['verifiedNoTransitionCases']} cases have evidence that no qualifying transition occurred during the study period. "
        "A zero in a filtered view does not establish that finding. Coverage is a documented research assessment, not a statistical guarantee of completeness.",
        f"There are {meta['openQuestions']} open research questions and {meta['heldCandidates']} event candidates awaiting sufficient evidence. "
        "Questions can concern scope, dates or membership, so these numbers should not be added as a count of missing events. "
        "Held candidates are excluded from the totals.",
    ]
    assessed = results.get("countries_assessed")
    if isinstance(assessed, int) and 0 <= assessed <= meta["countryCases"]:
        review_scope = (
            f"The {meta['release']} review freshly assessed {assessed} geographic cases. "
            f"The other {meta['countryCases'] - assessed} retain earlier verification. "
        )
        separately_reviewed = results.get("countries_separately_reviewed")
        if isinstance(separately_reviewed, int):
            review_scope += f"{separately_reviewed} cases received source review in a separate AI context. "
    else:
        review_scope = f"The {meta['release']} release records the latest source checks and scope decisions. "
    sections["closing-review"]["paragraphs"] = [
        review_scope + "New evidence can add an event, resolve a gap or show that an earlier completeness assessment needs revision.",
        f"The current release has {meta['fullWindowCases']} fully checked country sequences and {meta['partialCases']} partial cases. "
        "Unresolved questions remain visible in each country view and in the open-questions download. "
        "Completion of a review pass does not establish global completeness or provide a statistical estimate of missing events.",
    ]
    if isinstance(results.get("research_country_count"), int):
        scope = f"The {meta['release']} pass revisited all {results['research_country_count']} previously partial countries"
        if isinstance(results.get("prior_partial_chains_researched"), int):
            scope += f" and all {results['prior_partial_chains_researched']} previously partial office sequences"
        scope += "."
        review = (
            "A second researcher checked the sources for every factual addition, correction and coverage upgrade adopted in this release. "
            "Unchanged findings retain their earlier source reviews. The review did not reconstruct every country afresh."
            if results.get("source_review_complete") else
            "The release summary records the scope of fresh research and the remaining review work."
        )
        sections["closing-review"]["paragraphs"] = [
            results.get("coverage_conclusion", scope + " " + sections["closing-review"]["paragraphs"][1]),
            review,
        ]
    unclear = sum(row.get("governing_group_change") == "unclear" for row in atlas["events"])
    sections["comparison"]["paragraphs"][2] = (
        "A new officeholder does not necessarily bring a new ruling party, coalition or regime. The evidence determines whether the governing "
        f"group is marked changed, continued, mixed, unclear or not applicable. For {unclear} of {meta['totalHandovers']} handovers, "
        "group change remains unclear. Those cases remain unknown."
    )
    methods["sensitivity"]["scenarios"] = []
    for scenario in atlas["sensitivity"]["scenarios"]:
        item = pick(scenario, ("key", "label", "handovers", "collective_changes"))
        if scenario["key"] != "main":
            count_events = len(set(scenario["excluded_event_ids"]))
            count_collective = len(set(scenario["excluded_structural_ids"]))
            descriptions = [atlas["sensitivity"]["categories"][key] for key in scenario["excludes"]]
            item["detail"] = (
                f"Omits {count_events} distinct handover{'s' if count_events != 1 else ''} and "
                f"{count_collective} collective change{'s' if count_collective != 1 else ''}. "
                + "; ".join(description.rstrip(".") for description in descriptions) + ". Overlapping exclusions count each record once."
            )
        methods["sensitivity"]["scenarios"].append(item)
    methods["citation"]["suggested_text"] = (
        f"Lamarque, Hugh. Political Transitions 2016–2026. Research version {meta['release']}, frozen {released}. "
        f"Event window: {start}–{end}."
    )
    return methods


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("dist/data"))
    parser.add_argument("--expect-release", required=True, help="Abort unless analysis.json names this approved release")
    parser.add_argument("--expected-integrity", type=Path, help="Optional independently frozen manifest containing sourceHashes")
    parser.add_argument("--results", type=Path, help="Release review summary; defaults to batches/<release>/RESULTS.json")
    parser.add_argument("--methods-template", type=Path, default=Path(__file__).resolve().parents[1] / "content/methods-template.json")
    args = parser.parse_args()
    data = {}
    source_hashes = {}
    for name in SOURCE_NAMES:
        raw = (args.source / f"{name}.json").read_bytes()
        actual = hashlib.sha256(raw).hexdigest()
        source_hashes[f"{name}.json"] = actual
        data[name] = json.loads(raw)
    if data["analysis"]["release"] != args.expect_release:
        raise SystemExit(f"Expected release {args.expect_release}; found {data['analysis']['release']}")
    if args.expected_integrity:
        expected = json.loads(args.expected_integrity.read_text())["sourceHashes"]
        if source_hashes != expected:
            raise SystemExit("Canonical source hashes do not match the supplied independent freeze")
    results_path = args.results or args.source.parent / "batches" / args.expect_release / "RESULTS.json"
    results = json.loads(results_path.read_text()) if results_path.exists() else {}
    if results and results.get("batch_id", args.expect_release) != args.expect_release:
        raise SystemExit("Review results do not match the expected release")

    events = [record(row) for row in data["events"]]
    collective = [record(row) for row in data["structural_changes"]]
    chain_map = collections.defaultdict(list)
    for row in data["office_chains"]:
        out = pick(row, CHAIN_FIELDS)
        out["sources"] = sources(row, (
            "opening_evidence", "closing_evidence", "sequence_evidence",
            "continuity_evidence", "scope_sources", "follow_up_evidence",
        ))
        if not out["sources"]:
            # A few excluded offices document their constitutional evidence
            # only in the retained review. Make that existing trail available
            # in the country dialog without exposing internal review metadata.
            openings = [s for review in row.get("independent_reviews", [])
                        for s in review.get("sources_opened", [])
                        if "opened" in s.get("access_result", "").lower()]
            out["sources"] = sources({"sources": openings})
        chain_map[row["country_code"]].append(out)
    question_map = collections.defaultdict(list)
    questions = []
    for row in data["follow_up"]:
        if row.get("status") != "open":
            continue
        out = pick(row, QUESTION_FIELDS)
        out["sources"] = sources(row)
        question_map[row["country_code"]].append(out)
        questions.append(out)
    countries = []
    for row in data["country_frame"]:
        out = pick(row, COUNTRY_FIELDS)
        out["sources"] = sources(row)
        out["office_chains"] = chain_map[row["country_code"]]
        out["open_questions"] = question_map[row["country_code"]]
        if not out["sources"]:
            # Kosovo and Taiwan have no UN membership-frame source; use their
            # own documented executive chains instead of inventing one.
            by_url = {s["url"]: s for chain in out["office_chains"] for s in chain["sources"]}
            out["sources"] = list(by_url.values())
        countries.append(out)
    countries.sort(key=lambda c: c["country"].casefold())
    analysis = data["analysis"]
    chain_statuses = collections.Counter(row["coverage_status"] for row in data["office_chains"])
    country_statuses = collections.Counter(row["coverage_status"] for row in countries)
    actual_counts = {
        "total_handovers": len(events), "total_collective_changes": len(collective),
        "country_cases": len(countries), "full_window_cases": country_statuses["full_window_verified"],
        "partial_cases": country_statuses["partial_events_verified"], "open_follow_up_issues": len(questions),
    }
    for key, count in actual_counts.items():
        if analysis[key] != count:
            raise SystemExit(f"Canonical analysis is stale: {key} reports {analysis[key]}, records give {count}")
    flags = []
    for row in data["inclusion_sensitivity"]["flags"]:
        out = pick(row, (
            "record_id", "record_type", "country_code", "office_key", "categories",
            "reason", "main_count", "strict_count", "evidence_basis", "existing_chain_scope",
        ))
        out["sources"] = sources(row)
        flags.append(out)
    atlas = {
        "meta": {
            "release": analysis["release"], "windowStart": analysis["window_start"], "windowEnd": analysis["window_end"],
            "researchDate": analysis["as_of"], "totalHandovers": len(events),
            "totalCollectiveChanges": len(collective), "countryCases": len(countries),
            "fullWindowCases": analysis["full_window_cases"],
            "partialCases": analysis["partial_cases"],
            "verifiedNoTransitionCases": len(analysis["verified_no_transition_cases"]),
            "openQuestions": len(questions), "heldCandidates": analysis["held_event_candidates"],
            "rangedHandovers": analysis["event_date_precision"]["range"],
            "rangedCollectiveChanges": analysis["collective_date_precision"]["range"],
            "officeChains": len(data["office_chains"]),
            "relevantOfficeChains": len(data["office_chains"]) - chain_statuses["excluded_scope"],
            "fullOfficeChains": chain_statuses["full_window_verified"],
            "partialOfficeChains": chain_statuses["partial_events_verified"],
            "excludedOfficeChains": chain_statuses["excluded_scope"],
            "dateFiltering": "A record with an uncertain date appears when its supported interval overlaps the selected period. It may appear in more than one monthly view, but counts once in the whole-period total. The interval does not describe how long the transition lasted.",
            "nullMeaning": "An unidentified outgoing or incoming holder remains unknown. An empty field does not establish a vacancy or an empty collective body.",
        },
        "countries": countries,
        "events": events,
        "collective": collective,
        "analysis": analysis,
        "sensitivity": {
            "categories": data["inclusion_sensitivity"]["categories"],
            "flags": flags,
            "scenarios": analysis["sensitivity"],
            "interpretation": data["inclusion_sensitivity"]["interpretation"],
        },
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "atlas.json").write_bytes(json_bytes(atlas))
    methods = methods_for_release(json.loads(args.methods_template.read_text()), atlas, results)
    (args.output / "methods.json").write_bytes(json_bytes(methods))
    event_csv_fields = (
        "event_id", "country_code", "country", "office_key", "office", "event_date",
        "date_precision", "date_start", "date_end", "outgoing", "incoming", "mechanism",
        "governing_group_change", "summary", "authority_status", "unit_kind", "date_basis",
        "caveats", "source_urls",
    )
    write_csv(args.output / "events.csv", events, event_csv_fields)
    collective_csv_fields = ("structural_record_id",) + event_csv_fields[1:5] + (
        "collective_body",
    ) + event_csv_fields[5:]
    write_csv(args.output / "collective-changes.csv", collective, collective_csv_fields)
    write_csv(args.output / "coverage.csv", countries, COUNTRY_FIELDS + ("source_urls",))
    write_csv(args.output / "open-questions.csv", questions, QUESTION_FIELDS + ("source_urls",))
    integrity = {
        "release": analysis["release"], "sourceHashes": source_hashes,
        "counts": atlas["meta"],
        "files": {},
        "preservation": "Website projections use explicit field allowlists. The canonical source files are unchanged. Exact dates, interval bounds, nullable holders, stable IDs, direct sources, and verified source URLs are preserved. Three caveats replace an internal review-file path with the words 'an earlier source review'; no substantive caveat is removed.",
    }
    if results_path.exists():
        integrity["reviewResults"] = {
            "release": analysis["release"], "sha256": hashlib.sha256(results_path.read_bytes()).hexdigest(),
        }
    for name in ("atlas.json", "methods.json", "events.csv", "collective-changes.csv", "coverage.csv", "open-questions.csv"):
        raw = (args.output / name).read_bytes()
        integrity["files"][name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    (args.output / "integrity.json").write_text(json.dumps(integrity, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"counts": atlas["meta"], "files": integrity["files"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
