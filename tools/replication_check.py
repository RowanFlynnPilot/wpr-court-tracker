"""List what still names the original newsroom, county, or repository.

For newsrooms adapting this tracker (see REPLICATE.md). Run it from the
repository root after working through the "Make it yours" table:

    python tools/replication_check.py

It prints every remaining mention by file and line and exits 1 if any
are left, 0 when the copy is clean. Stdlib only; reads files, changes
nothing.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# What marks a file as still pointing at the original.
PATTERNS = {
    "newsroom name": re.compile(r"Wausau Pilot|\bWPR\b", re.I),
    "newsroom site or email": re.compile(r"wausaupilotandreview", re.I),
    "newsroom phone": re.compile(r"715-301-5539"),
    "original repository": re.compile(r"rowanflynnpilot", re.I),
    "county name": re.compile(r"\bMarathon\b"),
    "county number": re.compile(r"countyNo=37\b|\b37\s*:\s*\"Marathon\""),
}

# Files that legitimately keep the original names: history and credit,
# test fixtures, generated data, and this kit itself.
SKIP = (
    "REPLICATE.md",
    "CLAUDE.md",
    "LICENSE",
    "tools/replication_check.py",
    "tools/backstop-check.ps1",
    "config/cases.example.json",
    "widget/package-lock.json",
    "data/",
    "tests/",
    "widget/scripts/fixtures/",
    "widget/scripts/test-parse.mjs",
    "widget/src/assets/",
)


def tracked_files() -> list[str]:
    try:
        out = subprocess.run(
            ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout
        return [line for line in out.splitlines() if line]
    except (OSError, subprocess.CalledProcessError):
        return [
            str(p.relative_to(ROOT)).replace("\\", "/")
            for p in ROOT.rglob("*")
            if p.is_file() and ".git/" not in str(p).replace("\\", "/")
            and "node_modules" not in p.parts and "dist" not in p.parts
        ]


def main() -> int:
    hits: dict[str, list[tuple[int, str, str]]] = {}
    for rel in tracked_files():
        if rel.startswith(SKIP) or rel in SKIP:
            continue
        try:
            text = (ROOT / rel).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binary or unreadable: nothing to rename in it
        for n, line in enumerate(text.splitlines(), 1):
            for label, pattern in PATTERNS.items():
                if pattern.search(line):
                    hits.setdefault(rel, []).append((n, label, line.strip()[:100]))
                    break

    if not hits:
        print("Clean: nothing here names the original newsroom, county or repository.")
        return 0

    total = sum(len(v) for v in hits.values())
    print(f"{total} line(s) in {len(hits)} file(s) still point at the original:\n")
    for rel in sorted(hits):
        print(rel)
        for n, label, line in hits[rel]:
            print(f"  {n:>4}  [{label}]  {line}")
        print()
    print("Work through these with the 'Make it yours' table in REPLICATE.md.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
