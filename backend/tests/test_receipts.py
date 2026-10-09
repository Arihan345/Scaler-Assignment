import json
import os
from types import SimpleNamespace

import pytest

from app.services.receipts import compute_status

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "..", "shared", "status_fixtures.json")
CASES = json.load(open(FIXTURES))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_status_matches_shared_fixtures(case):
    members = [SimpleNamespace(**m) for m in case["members"]]
    assert compute_status(case["seq"], case["sender_id"], members) == case["expected"]
