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

# --- track-a-case issue intake ------------------------------------------

from issue_case import build_case, parse_form  # noqa: E402

ISSUE_BODY = """### WCCA case link

https://wcca.wicourts.gov/caseDetail.html?caseNo=2026CF000456&countyNo=37

### Headline

Test headline

### Summary

Why we track it.

### Topics

Courts, Public safety

### Next hearing date (optional)

2026-10-01

### Next hearing details (optional)

Arraignment, Branch 1

### Timeline entries (optional)

2026-07-01 | Complaint filed.
2026-07-08 | Initial appearance held.

### Related links (optional)

_No response_
"""


def test_issue_form_parses_to_case():
    case = build_case(ISSUE_BODY)
    assert case["id"] == "marathon-2026cf000456"
    assert case["county"] == "Marathon"
    assert case["tags"] == ["Courts", "Public safety"]
    assert case["nextHearing"] == {"date": "2026-10-01", "note": "Arraignment, Branch 1"}
    assert case["updates"] == [
        {"date": "2026-07-01", "note": "Complaint filed."},
        {"date": "2026-07-08", "note": "Initial appearance held."},
    ]
    assert "links" not in case  # "_No response_" means empty


def test_issue_form_empty_optionals():
    body = ISSUE_BODY.split("### Next hearing date")[0]
    case = build_case(body)
    assert "nextHearing" not in case and "updates" not in case


def test_issue_form_blocks_family_case():
    body = ISSUE_BODY.replace("2026CF000456", "2026FA000456")
    try:
        build_case(body)
    except policy.PolicyError:
        pass
    else:
        raise AssertionError("family case must be blocked at intake")


def test_issue_form_rejects_missing_pipe():
    body = ISSUE_BODY.replace("2026-07-01 | Complaint filed.", "just a note, no date")
    try:
        build_case(body)
    except PipelineError as e:
        assert "pipe" in str(e)
    else:
        raise AssertionError("pipeless timeline line must be rejected")


def test_issue_form_rejects_unknown_county():
    body = ISSUE_BODY.replace("countyNo=37", "countyNo=13")
    try:
        build_case(body)
    except PipelineError as e:
        assert "Marathon" in str(e)
    else:
        raise AssertionError("unknown county must be rejected")


def test_issue_intake_end_to_end_with_rollback():
    import json
    import shutil
    import tempfile

    import fetch
    import issue_case

    with tempfile.TemporaryDirectory() as td:
        cfg = Path(td) / "cases.json"
        shutil.copy(ROOT / "config" / "cases.json", cfg)
        saved = (fetch.CONFIG_PATH, issue_case.CONFIG_PATH, issue_case.OUT_PATH)
        fetch.CONFIG_PATH = issue_case.CONFIG_PATH = cfg
        issue_case.OUT_PATH = Path(td) / "new_case.json"
        try:
            issue_case.add_to_config(build_case(ISSUE_BODY))
            data = json.loads(cfg.read_text(encoding="utf-8"))
            assert any(c["id"] == "marathon-2026cf000456" for c in data["cases"])
            derived = json.loads(issue_case.OUT_PATH.read_text(encoding="utf-8"))
            assert derived["caseNo"] == "2026CF000456"
            assert derived["caseTypeLabel"] == "Felony"

            # Same case again: rejected before touching the config.
            before = cfg.read_text(encoding="utf-8")
            try:
                issue_case.add_to_config(build_case(ISSUE_BODY))
            except PipelineError as e:
                assert "already" in str(e)
            else:
                raise AssertionError("duplicate case must be rejected")
            assert cfg.read_text(encoding="utf-8") == before
        finally:
            fetch.CONFIG_PATH, issue_case.CONFIG_PATH, issue_case.OUT_PATH = saved


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