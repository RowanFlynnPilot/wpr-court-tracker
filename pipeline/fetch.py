"""WPR Court Tracker pipeline.

Reads the editorial watchlist (config/cases.json), polls each case's
official WCCA RSS feed (the court system's sanctioned "data extraction
option"), records new activity observations, and writes:

  data/feed.json     - everything the widget renders (editorial + observed)
  data/changes.json  - cases with NEW activity this run (newsletter digest input)

Facts this design rests on (verified 2026-07-11):
  * Feed URL: https://wcca.wicourts.gov/caseSearchResults.do?rss=1
              &countyNo={N}&caseNo={CASE}
  * The feed is a change PING, not a docket transcript. Each <item> carries
    the official caption, case link, last-updated pubDate, and a guid that
    embeds the update timestamp. New guid == new court activity.
  * An empty feed means "no recent activity", NOT "case not found".
  * The WCCA web UI is captcha-protected and its terms prohibit scraping.
    This pipeline touches ONLY the RSS endpoint. Do not add caseDetail
    fetching here - that capability is the Phase 2 paid REST subscription.

Stdlib only. Any failure exits nonzero and loudly.
"""

import hashlib
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import format_datetime, parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).parent))
import policy

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "cases.json"
FEED_PATH = ROOT / "data" / "feed.json"
CHANGES_PATH = ROOT / "data" / "changes.json"
RSS_PATH = ROOT / "data" / "tracker.xml"
ICS_PATH = ROOT / "data" / "hearings.ics"

# Public tracker URL - reader-facing links in the RSS/ics outputs.
SITE_URL = "https://rowanflynnpilot.github.io/wpr-court-tracker/"
RSS_MAX_ITEMS = 50

RSS_URL = "https://wcca.wicourts.gov/caseSearchResults.do?rss=1&countyNo={county_no}&caseNo={case_no}"
USER_AGENT = "WPR-CourtTracker/1.0 (Wausau Pilot & Review; news@wausaupilotandreview.com)"
# WCCA throttles/slows for cloud IPs some evenings (3 of 5 Actions runs
# timed out on 2026-07-11 while local fetches were instant). Be patient,
# then still fail loudly: 60s per attempt, two retries, escalating waits.
TIMEOUT_S = 60
RETRY_WAITS_S = (5, 25)

REQUIRED_CASE_FIELDS = ("id", "wccaUrl", "county", "headline", "summary", "tags")

# Editorial lifecycle. "closed" cases move to the widget's collapsed
# "Closed files" drawer but KEEP being fetched - appeals and post-judgment
# motions still show up on the record and should still alert the newsroom.
VALID_STATUSES = ("watching", "closed")


class PipelineError(Exception):
    pass


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_date(value, where: str) -> None:
    """Editorial dates must be real YYYY-MM-DD dates.

    The widget trusts feed.json completely and formats dates for readers;
    an invalid date here would crash the public page. This gate turns a
    config mistake (e.g. a leftover TODO) into a red build instead.
    """
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise PipelineError(f"{where} must be YYYY-MM-DD, got {value!r}")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as e:
        raise PipelineError(f"{where} is not a real date: {value!r}") from e


def validate_status(value, where: str) -> str:
    """Normalize the optional editorial `status` field (default: watching)."""
    if value is None:
        return "watching"
    if value not in VALID_STATUSES:
        raise PipelineError(
            f"{where} must be one of {', '.join(VALID_STATUSES)}, got {value!r}"
        )
    return value


def parse_wcca_url(url: str) -> tuple[str, int]:
    """Derive (case_no, county_no) from a pasted WCCA case detail URL.

    Reporters add a case by pasting the caseDetail.html link from their
    browser. Deriving both identifiers from that one URL eliminates
    transcription errors - the URL is the single source of truth.
    """
    parts = urlsplit(url)
    if parts.hostname != "wcca.wicourts.gov" or not parts.path.endswith("caseDetail.html"):
        raise PipelineError(
            f"wccaUrl must be a wcca.wicourts.gov caseDetail.html link, got {url!r}"
        )
    q = parse_qs(parts.query)
    try:
        return q["caseNo"][0], int(q["countyNo"][0])
    except (KeyError, ValueError) as e:
        raise PipelineError(f"wccaUrl missing caseNo/countyNo: {url!r}") from e


def load_config() -> dict:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    seen_ids = set()
    for case in config["cases"]:
        for field in REQUIRED_CASE_FIELDS:
            if field not in case:
                raise PipelineError(f"Case missing required field {field!r}: {case}")
        if case["id"] in seen_ids:
            raise PipelineError(f"Duplicate case id {case['id']!r}")
        seen_ids.add(case["id"])
        case_no, county_no = parse_wcca_url(case["wccaUrl"])
        # Policy check happens for every case, placeholder or not.
        case["caseNo"] = case_no
        case["countyNo"] = county_no
        case["caseType"] = policy.case_type(case_no)
        case["caseTypeLabel"] = policy.case_type_label(case_no)
        case["isCriminal"] = policy.is_criminal(case_no)
        case["status"] = validate_status(case.get("status"), f"{case['id']}: status")
        if "nextHearing" in case:
            validate_date(case["nextHearing"].get("date"),
                          f"{case['id']}: nextHearing.date")
        for i, update in enumerate(case.get("updates", [])):
            validate_date(update.get("date"), f"{case['id']}: updates[{i}].date")
    return config


def parse_feed(xml_bytes: bytes) -> list[dict]:
    """Parse a WCCA case RSS feed into observation dicts."""
    root = ET.fromstring(xml_bytes)
    if root.tag != "rss":
        raise PipelineError(f"Expected <rss> root, got <{root.tag}>")
    observations = []
    for item in root.iter("item"):
        guid = item.findtext("guid", "").strip()
        pub_date = item.findtext("pubDate", "").strip()
        title = item.findtext("title", "").strip()
        if not guid or not pub_date:
            raise PipelineError(f"Feed item missing guid/pubDate: title={title!r}")
        updated = parsedate_to_datetime(pub_date).astimezone(timezone.utc)
        # Title format: "2026CF000123 - State of Wisconsin vs. ..." - keep
        # the caption portion as the official caption.
        caption = title.split(" - ", 1)[1] if " - " in title else title
        observations.append(
            {"guid": guid, "updated": updated.isoformat(), "officialCaption": caption}
        )
    return observations


def fetch_case_feed(case_no: str, county_no: int) -> list[dict]:
    """Fetch one case's RSS feed, retrying on transient failures.

    Escalating patience (RETRY_WAITS_S between attempts): a slow WCCA
    evening shouldn't redden the run, but anything persistent must still
    fail loudly rather than quietly skip a case.
    """
    url = RSS_URL.format(county_no=county_no, case_no=case_no)
    req = Request(url, headers={"User-Agent": USER_AGENT})
    last_err = None
    for attempt in range(len(RETRY_WAITS_S) + 1):
        try:
            with urlopen(req, timeout=TIMEOUT_S) as resp:
                if resp.status != 200:
                    raise PipelineError(f"HTTP {resp.status} for {url}")
                return parse_feed(resp.read())
        except (OSError, ET.ParseError, PipelineError) as e:
            last_err = e
            if attempt < len(RETRY_WAITS_S):
                wait = RETRY_WAITS_S[attempt]
                print(f"retrying {case_no} in {wait}s after: {e}")
                time.sleep(wait)
    raise PipelineError(f"fetch failed for {url}: {last_err}")


def load_prior_observations() -> dict[str, list[dict]]:
    """Prior observed activity, keyed by case id, from the last feed.json."""
    if not FEED_PATH.exists():
        return {}
    prior = json.loads(FEED_PATH.read_text(encoding="utf-8"))
    return {c["id"]: c.get("observed", []) for c in prior.get("cases", [])}


def load_prior_first_tracked() -> dict[str, str]:
    """Prior firstTrackedAt stamps, keyed by case id, from the last feed.json."""
    if not FEED_PATH.exists():
        return {}
    prior = json.loads(FEED_PATH.read_text(encoding="utf-8"))
    return {
        c["id"]: c["firstTrackedAt"]
        for c in prior.get("cases", [])
        if c.get("firstTrackedAt")
    }


def first_tracked_at(prior_value, observed: list[dict], now: str) -> str:
    """When did this case join the watchlist?

    The prior feed's stamp wins (stable across runs). Cases tracked before
    the stamp existed backfill from their earliest observation - accurate,
    since the first fetch happens minutes after a case is added. Brand-new
    cases with an empty feed stamp as now.
    """
    if prior_value:
        return prior_value
    stamps = [o["observedAt"] for o in observed if o.get("observedAt")]
    return min(stamps) if stamps else now


def _editorial_dt(date_str: str) -> datetime:
    """Editorial YYYY-MM-DD as a UTC instant (noonish Central)."""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return d.replace(hour=17, tzinfo=timezone.utc)


def build_tracker_rss(feed: dict) -> bytes:
    """Readers' RSS: every observed record change + editorial update.

    Guids are stable across runs (WCCA's own guid for observed activity; a
    content hash for editorial notes) so feed readers never see repeats.
    """
    entries = []
    for case in feed["cases"]:
        if case.get("placeholder"):
            continue
        link = f"{SITE_URL}#{case['id']}"
        for obs in case.get("observed", []):
            entries.append({
                "title": f"Court record updated: {case['headline']}",
                "link": link,
                "guid": obs["guid"],
                "date": datetime.fromisoformat(obs["updated"]),
                "desc": f"{case.get('officialCaption', case['headline'])} - the "
                        "official court record changed. Open the case file for "
                        "the reporting.",
            })
        for u in case.get("updates", []):
            digest = hashlib.sha256(u["note"].encode("utf-8")).hexdigest()[:12]
            entries.append({
                "title": f"{case['headline']}",
                "link": link,
                "guid": f"wpr-{case['id']}-{u['date']}-{digest}",
                "date": _editorial_dt(u["date"]),
                "desc": u["note"],
            })
    entries.sort(key=lambda e: e["date"], reverse=True)

    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = "WPR Court Tracker - case activity"
    ET.SubElement(channel, "link").text = SITE_URL
    ET.SubElement(channel, "description").text = (
        "New activity on Marathon County court cases tracked by the "
        "Wausau Pilot & Review newsroom."
    )
    ET.SubElement(channel, "lastBuildDate").text = format_datetime(
        datetime.fromisoformat(feed["generatedAt"]))
    for e in entries[:RSS_MAX_ITEMS]:
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = e["title"]
        ET.SubElement(item, "link").text = e["link"]
        guid = ET.SubElement(item, "guid", isPermaLink="false")
        guid.text = e["guid"]
        ET.SubElement(item, "pubDate").text = format_datetime(e["date"])
        ET.SubElement(item, "description").text = e["desc"]
    return ET.tostring(rss, encoding="utf-8", xml_declaration=True)


def _ics_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    )


def build_hearings_ics(feed: dict) -> str:
    """Subscribable calendar of upcoming hearings (watching cases only).

    All-day events on purpose: hearing times live in free-text editorial
    notes, and a wrong parsed time on a subscriber's calendar is worse
    than no time.
    """
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Wausau Pilot & Review//Court Tracker//EN",
        "X-WR-CALNAME:WPR Court Tracker - hearings",
        "X-WR-TIMEZONE:America/Chicago",
    ]
    for case in feed["cases"]:
        if case.get("placeholder") or case.get("status") == "closed":
            continue
        hearing = case.get("nextHearing")
        if not hearing:
            continue
        start = hearing["date"].replace("-", "")
        d = datetime.strptime(hearing["date"], "%Y-%m-%d")
        end = datetime.fromordinal(d.toordinal() + 1).strftime("%Y%m%d")
        lines += [
            "BEGIN:VEVENT",
            f"UID:{case['caseNo']}-{start}@wpr-court-tracker",
            f"DTSTART;VALUE=DATE:{start}",
            f"DTEND;VALUE=DATE:{end}",
            f"SUMMARY:{_ics_escape('Hearing: ' + case['headline'])}",
            f"DESCRIPTION:{_ics_escape(hearing.get('note', '') + ' (Case ' + case['caseNo'] + ', ' + case['county'] + ' County)')}",
            f"URL:{SITE_URL}#{case['id']}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def run() -> None:
    config = load_config()
    prior = load_prior_observations()
    prior_first = load_prior_first_tracked()
    now = datetime.now(timezone.utc).isoformat()
    changed = []

    for case in config["cases"]:
        observed = prior.get(case["id"], [])
        if case.get("placeholder"):
            case["observed"] = observed
            continue
        fresh = fetch_case_feed(case["caseNo"], case["countyNo"])
        known_guids = {o["guid"] for o in observed}
        new = [o for o in fresh if o["guid"] not in known_guids]
        for obs in new:
            obs["observedAt"] = now
        if new:
            observed = observed + new
            changed.append(
                {
                    "id": case["id"],
                    "headline": case["headline"],
                    "caseNo": case["caseNo"],
                    "county": case["county"],
                    "updated": max(o["updated"] for o in new),
                    "wccaUrl": case["wccaUrl"],
                }
            )
            print(f"NEW ACTIVITY: {case['id']} ({case['caseNo']})")
        else:
            print(f"no change:    {case['id']} ({case['caseNo']})")
        case["observed"] = sorted(observed, key=lambda o: o["updated"], reverse=True)
        if case["observed"]:
            case["officialCaption"] = case["observed"][0]["officialCaption"]
        case["firstTrackedAt"] = first_tracked_at(
            prior_first.get(case["id"]), case["observed"], now
        )

    feed = {
        "generatedAt": now,
        "source": "Wisconsin Circuit Court Access (official per-case RSS feeds)",
        "requestEmail": config["requestEmail"],
        "disclaimer": policy.DISCLAIMER,
        "presumptionNote": policy.PRESUMPTION_NOTE,
        "cases": config["cases"],
    }
    FEED_PATH.parent.mkdir(exist_ok=True)
    FEED_PATH.write_text(json.dumps(feed, indent=2) + "\n", encoding="utf-8")
    CHANGES_PATH.write_text(
        json.dumps({"generatedAt": now, "changed": changed}, indent=2) + "\n",
        encoding="utf-8",
    )
    RSS_PATH.write_bytes(build_tracker_rss(feed))
    ICS_PATH.write_text(build_hearings_ics(feed), encoding="utf-8", newline="")
    print(f"wrote {FEED_PATH.relative_to(ROOT)} ({len(config['cases'])} cases, "
          f"{len(changed)} with new activity), tracker.xml, hearings.ics")


if __name__ == "__main__":
    run()