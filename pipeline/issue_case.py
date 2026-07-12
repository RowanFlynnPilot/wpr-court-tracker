"""Turn a "Track a case" issue form into a validated watchlist entry.

Reads the GitHub issue body from the ISSUE_BODY env var (or stdin), builds
a case entry, appends it to config/cases.json, and re-validates the whole
config through the same load_config() gate the pipeline uses — so a form
that violates editorial policy (blocked case type, malformed date, case
already tracked) fails HERE, with a message the reporter can act on,
before any human reviews a PR.

On success: config/cases.json is updated in place and out/new_case.json
holds the entry (the intake workflow reads it for the PR title/body).
On failure: a reporter-readable reason on stderr, exit 1.

Issue bodies are untrusted input from a public repo. Nothing here executes
or renders them: the WCCA URL must parse against wcca.wicourts.gov, dates
must be real dates, and everything else is carried as inert JSON strings
into a pull request a human must approve.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import policy  # noqa: E402
from fetch import (  # noqa: E402
    CONFIG_PATH,
    PipelineError,
    load_config,
    parse_wcca_url,
)

OUT_PATH = Path(__file__).resolve().parent.parent / "out" / "new_case.json"

# The tracker is a Marathon County product today. Extending coverage is an
# editorial decision: add the county here deliberately.
COUNTY_NAMES = {37: "Marathon"}

# Issue-form section headings (must match .github/ISSUE_TEMPLATE/track-a-case.yml labels).
F_MODE = "New case or update?"
F_STATUS = "Case status"
F_URL = "WCCA case link"
F_HEADLINE = "Headline"
F_SUMMARY = "Summary"
F_TOPICS = "Topics"
F_HEARING_DATE = "Next hearing date (optional)"
F_HEARING_NOTE = "Next hearing details (optional)"
F_UPDATES = "Timeline entries (optional)"
F_LINKS = "Related links (optional)"


def parse_form(body: str) -> dict[str, str]:
    """Parse GitHub's issue-form rendering: '### Label' followed by the value."""
    fields: dict[str, str] = {}
    current = None
    lines: list[str] = []
    for line in body.splitlines():
        if line.startswith("### "):
            if current is not None:
                fields[current] = "\n".join(lines).strip()
            current = line[4:].strip()
            lines = []
        elif current is not None:
            lines.append(line)
    if current is not None:
        fields[current] = "\n".join(lines).strip()
    # GitHub writes "_No response_" for empty optional fields.
    return {
        k: ("" if v == "_No response_" else v.strip()) for k, v in fields.items()
    }


def parse_piped_lines(raw: str, what: str, keys: tuple[str, str]) -> list[dict]:
    """Parse 'left | right' lines into [{keys[0]: left, keys[1]: right}]."""
    rows = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if "|" not in line:
            raise PipelineError(
                f"{what}: each line needs a pipe separator "
                f"('left | right'), got {line!r}"
            )
        left, right = (part.strip() for part in line.split("|", 1))
        if not left or not right:
            raise PipelineError(f"{what}: both sides of the pipe are required, got {line!r}")
        rows.append({keys[0]: left, keys[1]: right})
    return rows


def build_case(body: str) -> dict:
    form = parse_form(body)
    missing = [f for f in (F_URL, F_HEADLINE, F_SUMMARY, F_TOPICS) if not form.get(f)]
    if missing:
        raise PipelineError(
            "These required fields are empty: " + ", ".join(missing)
        )

    wcca_url = form[F_URL]
    case_no, county_no = parse_wcca_url(wcca_url)
    # Editorial gate up front, so the reporter's error message points at
    # the policy rather than at a failed downstream validation.
    policy.case_type(case_no)
    if county_no not in COUNTY_NAMES:
        raise PipelineError(
            f"County {county_no} isn't covered yet - the tracker currently "
            "follows Marathon County (37). Adding a county is an editorial "
            "decision; see COUNTY_NAMES in pipeline/issue_case.py."
        )
    county = COUNTY_NAMES[county_no]

    case = {
        "id": f"{county.lower()}-{case_no.lower()}",
        "wccaUrl": wcca_url,
        "county": county,
        "headline": form[F_HEADLINE],
        "summary": form[F_SUMMARY],
        "tags": [t.strip() for t in form[F_TOPICS].split(",") if t.strip()],
    }
    if form.get(F_STATUS, "").lower().startswith("closed"):
        case["status"] = "closed"
    if form.get(F_HEARING_DATE):
        case["nextHearing"] = {
            "date": form[F_HEARING_DATE],
            "note": form.get(F_HEARING_NOTE, ""),
        }
    updates = parse_piped_lines(form.get(F_UPDATES, ""), "Timeline entries", ("date", "note"))
    if updates:
        case["updates"] = updates
    links = parse_piped_lines(form.get(F_LINKS, ""), "Related links", ("label", "url"))
    if links:
        case["links"] = links
    return case


def is_update(body: str) -> bool:
    return parse_form(body).get(F_MODE, "").lower().startswith("update")


def add_to_config(case: dict, update: bool = False) -> None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    original = CONFIG_PATH.read_text(encoding="utf-8")
    case_no = case_no_of(case)
    # Match the tracked entry by caseNo (ids may be hand-written slugs).
    idx = next(
        (i for i, c in enumerate(config["cases"])
         if not c.get("placeholder") and case_no_of(c) == case_no),
        None,
    )
    if update:
        if idx is None:
            raise PipelineError(
                f"Case {case_no} isn't on the watchlist yet - submit it as "
                "a new case instead."
            )
        # Keep the original id: observed history in feed.json and reader
        # permalinks are keyed on it.
        case["id"] = config["cases"][idx]["id"]
        config["cases"][idx] = case
    else:
        if idx is not None:
            raise PipelineError(
                f"Case {case_no} is already on the watchlist. To change its "
                "fields (or close it), submit as an update instead."
            )
        config["cases"].append(case)
    CONFIG_PATH.write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    # The real gate: the exact validation the pipeline runs. Any failure
    # here must leave the config untouched for the next attempt.
    try:
        validated = load_config()
    except Exception:
        CONFIG_PATH.write_text(original, encoding="utf-8")
        raise
    # Persist the derived fields (+ intake mode) for the PR/commit text.
    new = next(c for c in validated["cases"] if c["id"] == case["id"])
    OUT_PATH.parent.mkdir(exist_ok=True)
    OUT_PATH.write_text(
        json.dumps({**new, "intakeMode": "update" if update else "new"}, indent=2) + "\n",
        encoding="utf-8",
    )


def case_no_of(case: dict) -> str:
    return parse_wcca_url(case["wccaUrl"])[0]


def main() -> None:
    body = os.environ.get("ISSUE_BODY") or sys.stdin.read()
    try:
        case = build_case(body)
        add_to_config(case, update=is_update(body))
    except (PipelineError, policy.PolicyError) as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    print(f"validated and staged: {case['id']}")


if __name__ == "__main__":
    main()
