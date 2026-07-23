"""Unit tests for the pure response-shaping helpers.

Auth and HTTP paths are exercised by the lab smoke test in the README;
these cover the shaping logic that turns STIG Manager metrics payloads
into the compact rows the agent charts from.
"""

import server


def test_totals_collapses_result_engine_leaves():
    payload = {
        "assessments": 10,
        "results": {
            "pass": {"total": 6, "resultEngine": 2},
            "fail": {"total": 4, "resultEngine": 0},
        },
    }
    assert server._totals(payload) == {
        "assessments": 10,
        "results": {"pass": 6, "fail": 4},
    }


def test_shape_metrics_adds_percentages():
    shaped = server.shape_metrics(
        {
            "metrics": {
                "assessments": 200,
                "assessed": 150,
                "results": {"pass": {"total": 100}, "fail": {"total": 50}},
                "findings": {"high": 3, "medium": 10, "low": 7},
            }
        }
    )
    assert shaped["assessedPct"] == 75.0
    assert shaped["resultsPct"] == {"pass": 50.0, "fail": 25.0}
    assert shaped["findings"] == {"high": 3, "medium": 10, "low": 7}


def test_shape_metrics_handles_zero_assessments():
    shaped = server.shape_metrics({"metrics": {"assessments": 0, "assessed": 0}})
    assert shaped["assessedPct"] == 0.0
    assert "resultsPct" not in shaped


def test_shape_summary_row_keeps_identity_keys():
    row = {
        "assetId": "42",
        "name": "web01",
        "ignored": "x",
        "metrics": {"assessments": 4, "assessed": 2},
    }
    shaped = server.shape_summary_row(row, ("assetId", "name"))
    assert shaped["assetId"] == "42"
    assert shaped["name"] == "web01"
    assert "ignored" not in shaped
    assert shaped["assessedPct"] == 50.0
