"""Editorial display policy for the WPR Court Tracker.

This module is the single place where Wausau Pilot & Review's rules about
what may appear in the public widget are encoded. The pipeline hard-fails
if the watchlist violates policy. Changing policy is an editorial decision:
edit this file deliberately, with publisher sign-off.

Policy summary
--------------
1. Only these circuit court case types may be tracked publicly. Family,
   juvenile, guardianship, mental health, adoption, and paternity cases are
   never tracked, even though some appear on WCCA.
2. Criminal case types always display a presumption-of-innocence note in
   the widget (enforced by the widget via `presumption_note`).
3. The watchlist is hand-curated by the newsroom. There is no automated
   case discovery in Phase 1.
"""

import re

# Wisconsin circuit court case class codes WPR will track publicly.
ALLOWED_CASE_TYPES = {
    "CF": "Felony",
    "CM": "Misdemeanor",
    "CT": "Criminal traffic",
    "CV": "Civil",
    "SC": "Small claims",
    "FO": "Forfeiture",
    "TR": "Traffic forfeiture",
    "PR": "Probate",
}

# Case types that carry a criminal charge and therefore require the
# presumption-of-innocence note in every public display.
CRIMINAL_CASE_TYPES = {"CF", "CM", "CT"}

PRESUMPTION_NOTE = (
    "A criminal charge is an accusation. Every defendant is presumed "
    "innocent unless and until proven guilty."
)

DISCLAIMER = (
    "Information here is drawn from Wisconsin Circuit Court Access (WCCA) "
    "and Wausau Pilot & Review reporting. It is not the official court "
    "record and may lag the court file. The official custodian of circuit "
    "court records is the Clerk of Circuit Court in the county where the "
    "case was filed."
)

_CASE_NO_RE = re.compile(r"^(19|20)\d{2}([A-Z]{2})\d{6}$")


class PolicyError(Exception):
    """Raised when the watchlist violates editorial policy."""


def case_type(case_no: str) -> str:
    """Return the two-letter class code from a WCCA case number.

    Raises PolicyError if the case number is malformed or the case type is
    not allowed for public tracking.
    """
    m = _CASE_NO_RE.match(case_no)
    if not m:
        raise PolicyError(
            f"Malformed case number {case_no!r}. Expected e.g. 2026CF000123."
        )
    code = m.group(2)
    if code not in ALLOWED_CASE_TYPES:
        raise PolicyError(
            f"Case type {code!r} ({case_no}) is not allowed for public "
            f"tracking. Allowed: {', '.join(sorted(ALLOWED_CASE_TYPES))}. "
            "This is an editorial policy decision - see pipeline/policy.py."
        )
    return code


def case_type_label(case_no: str) -> str:
    return ALLOWED_CASE_TYPES[case_type(case_no)]


def is_criminal(case_no: str) -> bool:
    return case_type(case_no) in CRIMINAL_CASE_TYPES
