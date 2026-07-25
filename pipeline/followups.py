"""Find watched cases whose hearing has passed with no newsroom note since.

The tracker's quiet failure mode: "Judicial pretrial, Sept. 30" comes and
goes and the file never says what happened. The machine can't write the
follow-up (editorial fields are reporters' work - CLAUDE.md boundary #6),
but it CAN notice the promise went unkept. The publish sweep turns this
list into one auto-managed `hearing-followup` issue that closes itself
once the files are current.

A case needs follow-up when:
  * it's real (not a placeholder) and still `watching`
  * its nextHearing date is at least GRACE_DAYS in the past (court minutes
    and reporter write-ups lag a day; don't nag at breakfast)
  * no editorial update is dated on or after the hearing date

Reads config/cases.json via the same load_config() gate the pipeline
uses - hearings and updates are both editorial fields, so the just-swept
working tree is already current. No network.

CLI:  python pipeline/followups.py            -> JSON list
      python pipeline/followups.py --markdown -> issue body (empty if none)
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fetch import SITE_URL, load_config  # noqa: E402

GRACE_DAYS = 2
DESK_URL = f"{SITE_URL}editor.html"


def stale_hearings(cases: list[dict], today: str) -> list[dict]:
    """Cases whose hearing passed >= GRACE_DAYS ago with no note since."""
    cutoff = (date.fromisoformat(today) - timedelta(days=GRACE_DAYS)).isoformat()
    stale = []
    for case in cases:
        if case.get("placeholder") or case.get("status") == "closed":
            continue
        hearing = case.get("nextHearing")
        if not hearing or hearing["date"] > cutoff:
            continue
        # YYYY-MM-DD strings compare correctly as strings.
        if any(u["date"] >= hearing["date"] for u in case.get("updates", [])):
            continue
        stale.append(
            {
                "id": case["id"],
                "headline": case["headline"],
                "caseNo": case["caseNo"],
                "date": hearing["date"],
                "note": hearing.get("note", ""),
            }
        )
    stale.sort(key=lambda c: c["date"])
    return stale


def markdown_body(stale: list[dict]) -> str:
    lines = [
        "These watched cases had a hearing at least two days ago, and the",
        "file has no newsroom note dated since. The tracker only observes;",
        "a reporter says what happened.",
        "",
    ]
    for c in stale:
        note = f" — {c['note']}" if c["note"] else ""
        lines += [
            f"- [ ] **{c['headline']}** (`{c['caseNo']}`)",
            f"      Hearing {c['date']}{note}",
            f"      [Update the file at the Case Entry Desk]({DESK_URL}) — pick it under “Working on” and add a timeline entry (or move the hearing date).",
        ]
    lines += [
        "",
        "_This issue rewrites itself on every publish sweep and closes",
        "automatically once every file is current._",
    ]
    return "\n".join(lines)


def main() -> None:
    cases = load_config()["cases"]
    stale = stale_hearings(cases, date.today().isoformat())
    if "--markdown" in sys.argv:
        # Print NOTHING when current - the workflow's [ -s ] check treats
        # a zero-byte file as "no issue needed" (a bare newline would not).
        if stale:
            print(markdown_body(stale))
    else:
        print(json.dumps(stale))


if __name__ == "__main__":
    main()
