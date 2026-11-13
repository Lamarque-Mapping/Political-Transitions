#!/usr/bin/env python3
"""Check website data integrity and, optionally, fidelity to the frozen source."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import date
import hashlib
import json
from pathlib import Path


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def source_urls(value):
    if isinstance(value, str):
        return {line.strip() for line in value.splitlines() if line.strip()}
    if isinstance(value, list):
        return {url for item in value for url in source_urls(item)}
    if isinstance(value, dict) and value.get("url"):
        return {value["url"].strip()}
    return set()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("dist/data"))
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    atlas = json.loads((args.data / "atlas.json").read_text())
    integrity = json.loads((args.data / "integrity.json").read_text())
    methods = json.loads((args.data / "methods.json").read_text())
    meta, analysis = atlas["meta"], atlas["analysis"]
    checks = []

    for name, info in integrity["files"].items():
        raw = (args.data / name).read_bytes()
        require(hashlib.sha256(raw).hexdigest() == info["sha256"], f"Modified export: {name}")
        require(len(raw) == info["bytes"], f"Size mismatch: {name}")
    require(meta["release"] == analysis["release"] == integrity["release"] == methods["version"], "Mixed release files")
    require(meta["researchDate"] == analysis["as_of"] == methods["window"]["frozen"], "Release date mismatch")
    require(integrity["counts"] == meta, "Integrity metadata differs from export")
    checks.append("Export hashes and byte lengths")

    events, collective, countries = atlas["events"], atlas["collective"], atlas["countries"]
    require((len(events), len(collective), len(countries)) == (meta["totalHandovers"], meta["totalCollectiveChanges"], meta["countryCases"]), "Release record counts")
    require((len(events), len(collective), len(countries)) == (analysis["total_handovers"], analysis["total_collective_changes"], analysis["country_cases"]), "Analysis record counts")
    country_codes = {r["country_code"] for r in countries}
    require(len(country_codes) == len(countries), "Unique geographic cases")
    event_ids = {r["event_id"] for r in events}
    structural_ids = {r["structural_record_id"] for r in collective}
    require(len(event_ids) == len(events) and len(structural_ids) == len(collective), "Unique stable record IDs")
    require(not event_ids & structural_ids, "Series IDs overlap")
    require(all(r["country_code"] in country_codes for r in events + collective), "Country foreign keys")
    checks.append("Separate units, stable IDs and country references")

    for series, expected, range_key in ((events, analysis["event_date_precision"], "rangedHandovers"), (collective, analysis["collective_date_precision"], "rangedCollectiveChanges")):
        require(Counter(r["date_precision"] for r in series) == expected, "Date precision counts")
        require(sum(r["date_precision"] == "range" for r in series) == meta[range_key], "Ranged metadata count")
        for record in series:
            start, end = record["date_start"], record["date_end"]
            date.fromisoformat(start)
            date.fromisoformat(end)
            require(meta["windowStart"] <= start <= end <= meta["windowEnd"], "Interval/window bounds")
            require(record["date_precision"] in ("day", "range"), "Unknown date precision")
            if record["date_precision"] == "day":
                require(record["event_date"] == start == end, "Exact date inconsistency")
            else:
                require(record["event_date"] is None, "Ranged record given a fabricated event day")
    checks.append("Date precision, null exact dates and interval bounds")

    require(Counter(c["coverage_status"] for c in countries) == {"full_window_verified": meta["fullWindowCases"], "partial_events_verified": meta["partialCases"]}, "Coverage totals")
    require((meta["fullWindowCases"], meta["partialCases"]) == (analysis["full_window_cases"], analysis["partial_cases"]), "Coverage analysis totals")
    require(sum(c["no_transition_verified"] for c in countries) == meta["verifiedNoTransitionCases"], "Verified no-transition count")
    require({c["country_code"] for c in countries if c["no_transition_verified"]} == set(analysis["verified_no_transition_cases"]), "No-transition case membership")
    e_counts = Counter(r["country_code"] for r in events)
    s_counts = Counter(r["country_code"] for r in collective)
    for country in countries:
        code = country["country_code"]
        require(country["verified_event_count"] == e_counts[code], f"Handover count: {code}")
        require(country["verified_structural_change_count"] == s_counts[code], f"Collective count: {code}")
        if country["coverage_status"] == "full_window_verified":
            require(all(o["coverage_status"] != "partial_events_verified" for o in country["office_chains"] if o.get("in_scope") is not False), f"Full country has partial relevant chain: {code}")
        if country["no_transition_verified"]:
            require(e_counts[code] == s_counts[code] == 0, f"No-transition flag: {code}")
            require(country["coverage_status"] == "full_window_verified", f"No-transition coverage: {code}")
    chains = [o for c in countries for o in c["office_chains"]]
    questions = [q for c in countries for q in c["open_questions"]]
    require(len(chains) == meta["officeChains"], "Office chain total")
    require(Counter(o["coverage_status"] for o in chains) == {"full_window_verified": meta["fullOfficeChains"], "partial_events_verified": meta["partialOfficeChains"], "excluded_scope": meta["excludedOfficeChains"]}, "Office chain status totals")
    require(meta["relevantOfficeChains"] == meta["fullOfficeChains"] + meta["partialOfficeChains"] == len(chains) - meta["excludedOfficeChains"], "Relevant chain partition")
    require(len(questions) == len({q["case_id"] for q in questions}) == meta["openQuestions"] == analysis["open_follow_up_issues"], "Open question total/IDs")
    require(all(q["status"] == "open" for q in questions), "Closed question leaked into open count")
    checks.append("Country coverage, no-transition flags, chain totals and open questions")

    for series, column in ((events, "handovers"), (collective, "collective_changes")):
        assigned = Counter(r["date_start"][:4] for r in series if r["date_start"][:4] == r["date_end"][:4])
        annual = {str(x["year"]): x[column] for x in atlas["analysis"]["annual"]}
        require(Counter(annual) == assigned, f"Annual {column} counts")
        require(sum(annual.values()) + sum(r["date_start"][:4] != r["date_end"][:4] for r in series) == len(series), "Annual sums must exclude cross-year uncertainty")
    cross_year = [r for r in events + collective if r["date_start"][:4] != r["date_end"][:4]]
    require({r.get("event_id", r.get("structural_record_id")) for r in cross_year} == {r["record_id"] for r in analysis["unassigned_year_records"]}, "Cross-year register")
    checks.append("Annual counts keep cross-year intervals unassigned")

    require(all(flag["record_id"] in event_ids | structural_ids for flag in atlas["sensitivity"]["flags"]), "Unknown sensitivity flag record")
    for scenario in atlas["sensitivity"]["scenarios"]:
        require(set(scenario["excluded_event_ids"]) <= event_ids, "Unknown excluded event")
        require(set(scenario["excluded_structural_ids"]) <= structural_ids, "Unknown excluded collective record")
        calculated = (len(event_ids - set(scenario["excluded_event_ids"])), len(structural_ids - set(scenario["excluded_structural_ids"])))
        flagged = {flag["record_id"] for flag in atlas["sensitivity"]["flags"] if set(flag["categories"]) & set(scenario["excludes"])}
        require(set(scenario["excluded_event_ids"]) == flagged & event_ids, "Scenario event exclusions do not match inclusion flags")
        require(set(scenario["excluded_structural_ids"]) == flagged & structural_ids, "Scenario collective exclusions do not match inclusion flags")
        require(calculated == (scenario["handovers"], scenario["collective_changes"]), "Sensitivity count")
        copy = next(s for s in methods["sensitivity"]["scenarios"] if s["key"] == scenario["key"])
        require(calculated == (copy["handovers"], copy["collective_changes"]), "Stale methods sensitivity counts")
    require([c["value"] for c in methods["overview"]["cards"]] == [len(events), len(collective), len(countries), meta["fullWindowCases"]], "Stale overview card counts")
    checks.append("Sensitivity alternatives reconcile by stable-ID set subtraction")

    for name, records, id_key in (("events.csv", events, "event_id"), ("collective-changes.csv", collective, "structural_record_id"), ("coverage.csv", countries, "country_code"), ("open-questions.csv", questions, "case_id")):
        with (args.data / name).open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream))
        require(len(rows) == len(records), f"CSV row count: {name}")
        require({row[id_key] for row in rows} == {row[id_key] for row in records}, f"CSV ID set: {name}")
        require(all(row["source_urls"] for row in rows), f"Missing CSV evidence: {name}")
    checks.append("CSV downloads preserve record counts and source URLs")

    if args.source:
        source = {}
        for name, digest in integrity["sourceHashes"].items():
            raw = (args.source / name).read_bytes()
            require(hashlib.sha256(raw).hexdigest() == digest, f"Canonical source changed: {name}")
            source[name] = json.loads(raw)
        for exported, source_name, id_key in ((events, "events.json", "event_id"), (collective, "structural_changes.json", "structural_record_id")):
            original = {r[id_key]: r for r in source[source_name]}
            for row in exported:
                old = original[row[id_key]]
                for field in ("country_code", "office_key", "office", "event_date", "date_precision", "date_start", "date_end", "outgoing", "incoming", "mechanism", "governing_group_change", "summary", "authority_status", "unit_kind", "date_basis"):
                    require(row.get(field) == old.get(field), f"Preservation: {row[id_key]} / {field}")
                old_urls = {url for key in ("sources", "source_metadata", "verified_source_urls", "source_urls") for url in source_urls(old.get(key))}
                new_urls = {s["url"] for s in row["sources"]}
                require(old_urls == new_urls, f"Evidence URL preservation: {row[id_key]}")
            require(set(original) == {r[id_key] for r in exported}, f"Canonical IDs preserved: {source_name}")
        require({q["case_id"] for q in questions} == {q["case_id"] for q in source["follow_up.json"] if q["status"] == "open"}, "Source open question IDs")
        checks.append("Canonical hashes, all critical record fields and every direct/verified source URL preserved")

    output = {"status": "passed", "release": meta["release"], "checks": checks, "counts": {"handovers": len(events), "collectiveChanges": len(collective), "countries": len(countries), "fullWindow": meta["fullWindowCases"], "partial": meta["partialCases"], "verifiedNoTransition": meta["verifiedNoTransitionCases"], "openQuestions": len(questions), "annualUnassigned": len(cross_year)}}
    (args.data / "validation.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
