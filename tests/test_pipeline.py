"""Evidence-based checks against a real captured WCCA feed (party name
redacted). Run: python tests/test_pipeline.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import policy
from fetch import (
    parse_feed,
    parse_wcca_url,
    validate_date,
    validate_status,
    PipelineError,
)


def test_date_validation_blocks_todo_placeholders():
    # Regression: 2026-07-11, a leftover "TODO-YYYY-MM-DD" in cases.json
    # reached feed.json and crashed the public widget at render.
    validate_date("2026-09-30", "ok")
    for bad in ("TODO-YYYY-MM-DD", "TODO-filing-date", "2026-13-01",
                "2026-02-30", "9/30/2026", "", None):
        try:
            validate_date(bad, "test")
        except PipelineError:
            pass
        else:
            raise AssertionError(f"{bad!r} must fail date validation")

def test_status_defaults_to_watching_and_rejects_unknown():
    assert validate_status(None, "t") == "watching"
    assert validate_status("watching", "t") == "watching"
    assert validate_status("closed", "t") == "closed"
    for bad in ("archived", "open", "CLOSED", "", 0):
        try:
            validate_status(bad, "test")
        except PipelineError:
            pass
        else:
            raise AssertionError(f"{bad!r} must fail status validation")


FIXTURE = (ROOT / "tests" / "fixtures" / "wcca_feed_sample.xml").read_bytes()


def test_parse_real_feed():
    obs = parse_feed(FIXTURE)
    assert len(obs) == 1, obs
    o = obs[0]
    assert o["guid"].strip().startswith("37-2026CF000100-"), o["guid"]
    assert o["updated"] == "2026-07-10T18:46:30+00:00", o["updated"]
    assert o["officialCaption"] == "State of Wisconsin vs. Sample D. Party", o


def test_parse_empty_feed_is_no_activity_not_error():
    empty = b"""<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>WCCA</title></channel></rss>"""
    assert parse_feed(empty) == []


def test_parse_wcca_url():
    case_no, county_no = parse_wcca_url(
        "https://wcca.wicourts.gov/caseDetail.html?caseNo=2026CF000100&countyNo=37"
    )
    assert case_no == "2026CF000100" and county_no == 37


def test_parse_wcca_url_rejects_wrong_host():
    try:
        parse_wcca_url("https://example.com/caseDetail.html?caseNo=1&countyNo=1")
    except PipelineError:
        pass
    else:
        raise AssertionError("wrong host must be rejected")


def test_policy_allows_tracked_types():
    assert policy.case_type_label("2026CF000100") == "Felony"
    assert policy.is_criminal("2026CM000200") is True
    assert policy.is_criminal("2026CV000300") is False


def test_policy_blocks_family_and_juvenile():
    for bad in ("2026FA000001", "2026JV000001", "2026ME000001", "2026GN000001"):
        try:
            policy.case_type(bad)
        except policy.PolicyError:
            pass
        else:
            raise AssertionError(f"{bad} must be blocked by policy")


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as e:  # noqa: BLE001 - report and count
                failures += 1
                print(f"FAIL {name}: {e}")
    sys.exit(1 if failures else 0)