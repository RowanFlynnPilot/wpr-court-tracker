"""Find case files that owe readers a newsroom note.

Two quiet failure modes, one auto-managed issue. The machine can't write
the follow-up (editorial fields are reporters' work - CLAUDE.md boundary
#6), but it CAN notice a promise went unkept:

  1. A hearing passed with no note since. "Judicial pretrial, Sept. 30"
     comes and goes and the file never says what happened. Fires
     GRACE_DAYS after the hearing (court minutes and write-ups lag a
     day; don't nag at breakfast).
  2. The record moved; the file is silent. The official record changed
     NUDGE_AFTER_DAYS+ ago and no newsroom note is dated on or after
     that change - the ledger fills with red rows the newsroom never
     explains. Watching cases only: closed files are collapsed and
     their record churn is administrative more often than newsworthy.

The publish sweep turns the combined list into one `needs-newsroom-note`
issue that rewrites itself each sweep and closes once files are current.

Editorial fields (updates/hearings/status) come from config/cases.json
via the pipeline's own load_config() - current even seconds after a
sweep publish. Observed court-record history comes from the committed
data/feed.json - always current in-tree, because new observations are
exactly what the signal-commit gate commits. No network.

CLI:  python pipeline/followups.py            -> JSON {hearings, activity}
      python pipeline/followups.py --markdown -> issue body (empty if none)
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fetch import FEED_PATH, SITE_URL, load_config  # noqa: E402

GRACE_DAYS = 2
NUDGE_AFTER_DAYS = 7
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


def unnarrated_activity(cases: list[dict], today: str) -> list[dict]:
    """Watching cases whose latest record change sits unexplained.

    Flags when the newest observed change is >= NUDGE_AFTER_DAYS old and
    no newsroom note is dated on or after it. Uses only the LATEST
    observation: once the most recent change is narrated, the file reads
    current even if older rows went unnarrated.
    """
    cutoff = (date.fromisoformat(today) - timedelta(days=NUDGE_AFTER_DAYS)).isoformat()
    out = []
    for case in cases:
        if case.get("placeholder") or case.get("status") == "closed":
            continue
        obs = case.get("observed") or []
        if not obs:
            continue
        latest = max(o["updated"][:10] for o in obs)
        if latest > cutoff:
            continue
        notes = [u["date"] for u in case.get("updates", [])]
        if any(d >= latest for d in notes):
            continue
        out.append(
            {
                "id": case["id"],
                "headline": case["headline"],
                "caseNo": case["caseNo"],
                "recordDate": latest,
                "lastNote": max(notes) if notes else None,
            }
        )
    out.sort(key=lambda c: c["recordDate"])
    return out


def markdown_body(hearings: list[dict], activity: list[dict]) -> str:
    lines = [
        "The tracker only observes; a reporter says what happened. These",
        "files owe readers a newsroom note.",
        "",
    ]
    if hearings:
        lines += ["### A hearing passed with no note since", ""]
        for c in hearings:
            note = f" — {c['note']}" if c["note"] else ""
            lines += [
                f"- [ ] **{c['headline']}** (`{c['caseNo']}`)",
                f"      Hearing {c['date']}{note}",
                f"      [Update the file at the Case Entry Desk]({DESK_URL}) — pick it under “Working on” and add a timeline entry (or move the hearing date).",
            ]
        lines.append("")
    if activity:
        lines += ["### The record moved; the file is silent", ""]
        for c in activity:
            last = f"last newsroom note {c['lastNote']}" if c["lastNote"] else "no newsroom notes on the file yet"
            lines += [
                f"- [ ] **{c['headline']}** (`{c['caseNo']}`)",
                f"      Court record changed {c['recordDate']}; {last}.",
                f"      [Update the file at the Case Entry Desk]({DESK_URL}) — a dated timeline entry clears this.",
            ]
        lines.append("")
    lines += [
        "_This issue rewrites itself on every publish sweep and closes",
        "automatically once every file is current._",
    ]
    return "\n".join(lines)


def load_joined_cases() -> list[dict]:
    """Editorial truth from config, observed history from the last feed."""
    cases = load_config()["cases"]
    observed = {}
    if FEED_PATH.exists():
        feed = json.loads(FEED_PATH.read_text(encoding="utf-8"))
        observed = {c["id"]: c.get("observed", []) for c in feed.get("cases", [])}
    for c in cases:
        c["observed"] = observed.get(c["id"], [])
    return cases


def main() -> None:
    cases = load_joined_cases()
    today = date.today().isoformat()
    hearings = stale_hearings(cases, today)
    activity = unnarrated_activity(cases, today)
    if "--markdown" in sys.argv:
        # Print NOTHING when current - the workflow's [ -s ] check treats
        # a zero-byte file as "no issue needed" (a bare newline would not).
        if hearings or activity:
            print(markdown_body(hearings, activity))
    else:
        print(json.dumps({"hearings": hearings, "activity": activity}))


if __name__ == "__main__":
    main()
