"""STIG Manager MCP server.

Exposes read-only STIG Manager compliance data as MCP tools over
streamable HTTP, so a LibreChat Agent (and therefore a Nexus Scheduler
job) can generate compliance reports and charts from live data.

Authentication: OAuth2 client-credentials against Keycloak using a
dedicated confidential client (see ../keycloak/realm-import/
stigman-realm.json and the README). The token carries the
stig-manager:* scopes and aud=stig-manager; STIG Manager authorizes
the resulting service-account user per collection via normal grants.

All tools are read-only. Nothing here mutates STIG Manager.
"""

import os
import time
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

STIGMAN_API_URL = os.environ.get("STIGMAN_API_URL", "http://stigman:54000/api").rstrip("/")
KEYCLOAK_TOKEN_URL = os.environ.get(
    "KEYCLOAK_TOKEN_URL",
    "http://keycloak:8080/realms/stigman/protocol/openid-connect/token",
)
OIDC_CLIENT_ID = os.environ.get("OIDC_CLIENT_ID", "nexus-mcp")
OIDC_CLIENT_SECRET = os.environ.get("OIDC_CLIENT_SECRET", "")
HTTP_TIMEOUT = float(os.environ.get("HTTP_TIMEOUT_SECONDS", "30"))

mcp = FastMCP(
    "stigman",
    host=os.environ.get("MCP_HOST", "0.0.0.0"),
    port=int(os.environ.get("MCP_PORT", "8005")),
    # LibreChat opens a fresh session per request cycle; stateless keeps
    # the server restart-safe with no session affinity to lose.
    stateless_http=True,
)


class TokenCache:
    """Client-credentials token, refreshed 30s before expiry."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._expires_at: float = 0.0

    def get(self) -> str:
        if self._token and time.monotonic() < self._expires_at - 30:
            return self._token
        resp = httpx.post(
            KEYCLOAK_TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": OIDC_CLIENT_ID,
                "client_secret": OIDC_CLIENT_SECRET,
            },
            timeout=HTTP_TIMEOUT,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Keycloak token request failed ({resp.status_code}) at "
                f"{KEYCLOAK_TOKEN_URL}: {resp.text[:300]}. Check "
                "OIDC_CLIENT_ID/OIDC_CLIENT_SECRET and that the client has "
                "service accounts enabled."
            )
        payload = resp.json()
        self._token = payload["access_token"]
        self._expires_at = time.monotonic() + float(payload.get("expires_in", 60))
        return self._token


_tokens = TokenCache()


def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    resp = httpx.get(
        f"{STIGMAN_API_URL}{path}",
        params=params,
        headers={"Authorization": f"Bearer {_tokens.get()}"},
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code == 401:
        raise RuntimeError(
            "STIG Manager rejected the token (401). Usual causes: issuer "
            "mismatch (token minted against a different Keycloak URL than "
            "STIGMAN_OIDC_PROVIDER), or a missing aud=stig-manager audience "
            "mapper on the client."
        )
    if resp.status_code == 403:
        raise RuntimeError(
            f"STIG Manager denied access (403) for {path}. The service "
            "account authenticated but lacks a grant: an admin must add the "
            "service-account user to the collection (Manage Collection -> "
            "Grants), and the token must carry the stig-manager:* scopes."
        )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Response shaping: keep tool output compact and chart-ready. Metrics
# payloads nest {total, resultEngine} objects several levels deep; the
# agent only needs the totals, and smaller tool output means fewer
# context tokens per scheduled run.
# ---------------------------------------------------------------------------

def _totals(obj: Any) -> Any:
    """Collapse {total, resultEngine} leaves to their total."""
    if isinstance(obj, dict):
        if set(obj.keys()) <= {"total", "resultEngine"} and "total" in obj:
            return obj["total"]
        return {k: _totals(v) for k, v in obj.items()}
    return obj


def shape_metrics(m: dict[str, Any]) -> dict[str, Any]:
    """Compact a STIG Manager metrics object and add derived percentages."""
    metrics = _totals(m.get("metrics", m))
    if not isinstance(metrics, dict):
        return {"metrics": metrics}
    assessments = metrics.get("assessments") or 0
    assessed = metrics.get("assessed") or 0
    out = dict(metrics)
    out["assessedPct"] = round(100 * assessed / assessments, 1) if assessments else 0.0
    results = metrics.get("results")
    if isinstance(results, dict) and assessments:
        out["resultsPct"] = {
            k: round(100 * (v or 0) / assessments, 1) for k, v in results.items()
        }
    return out


def shape_summary_row(row: dict[str, Any], keep: tuple[str, ...]) -> dict[str, Any]:
    out = {k: row[k] for k in keep if k in row}
    out.update(shape_metrics(row))
    return out


@mcp.tool()
def whoami() -> dict[str, Any]:
    """Return the identity STIG Manager sees for this MCP server's service
    account: username, userId, privileges, and effective grants. Call this
    first when debugging authentication or empty results — a service
    account with no collection grants sees an empty collection list, not
    an error."""
    return _get("/user")


@mcp.tool()
def list_collections() -> list[dict[str, Any]]:
    """List the STIG Manager collections this service account can access,
    with collectionId, name, and description. Returns only granted
    collections — if one is missing, an admin has not granted the service
    account access to it."""
    rows = _get("/collections")
    return [
        {k: r.get(k) for k in ("collectionId", "name", "description")}
        for r in rows
    ]


@mcp.tool()
def collection_metrics(collection_id: str) -> dict[str, Any]:
    """Aggregated compliance metrics for one collection: asset/checklist
    counts, how many checks are assessed (with assessedPct), result totals
    (pass/fail/notapplicable/...), review statuses (saved/submitted/
    accepted/rejected), and open findings by severity (findings.high =
    CAT I, medium = CAT II, low = CAT III). Use for the headline numbers
    and overall pie/bar charts of a report."""
    rows = _get(f"/collections/{collection_id}/metrics/summary/collection")
    row = rows[0] if isinstance(rows, list) and rows else rows
    return shape_summary_row(row, ("collectionId", "name", "assets", "stigs", "checklists"))


@mcp.tool()
def asset_metrics(collection_id: str) -> list[dict[str, Any]]:
    """Per-asset compliance metrics for one collection. Each row: asset
    name/id, benchmark count, assessed counts and assessedPct, result
    totals, and open findings by severity. Use to rank the worst assets
    and build per-asset tables."""
    rows = _get(f"/collections/{collection_id}/metrics/summary/asset")
    return [
        shape_summary_row(r, ("assetId", "name", "labels", "benchmarkIds", "stigs"))
        for r in rows
    ]


@mcp.tool()
def stig_metrics(collection_id: str) -> list[dict[str, Any]]:
    """Per-STIG-benchmark compliance metrics for one collection. Each row:
    benchmarkId, revision, asset count, assessed counts and assessedPct,
    result totals, and open findings by severity. Use to show which
    benchmarks drive the risk."""
    rows = _get(f"/collections/{collection_id}/metrics/summary/stig")
    return [
        shape_summary_row(r, ("benchmarkId", "title", "revisionStr", "assets"))
        for r in rows
    ]


@mcp.tool()
def findings(collection_id: str, aggregator: str = "groupId") -> list[dict[str, Any]]:
    """Open findings for one collection, aggregated by 'groupId' (default),
    'ruleId', or 'cci'. Each row: the aggregation key, severity (high =
    CAT I, medium = CAT II, low = CAT III), title when available, and how
    many assets are affected. Sorted worst-first (severity, then asset
    count). Use for the top-findings table of a report."""
    if aggregator not in ("groupId", "ruleId", "cci"):
        raise ValueError("aggregator must be one of: groupId, ruleId, cci")
    rows = _get(
        f"/collections/{collection_id}/findings",
        params={"aggregator": aggregator, "acceptedOnly": "false", "projection": "rules"},
    )
    sev_rank = {"high": 0, "medium": 1, "low": 2}
    shaped = []
    for r in rows:
        rules = r.get("rules") or []
        shaped.append(
            {
                "key": r.get(aggregator) or r.get("groupId") or r.get("ruleId") or r.get("cci"),
                "severity": r.get("severity"),
                "title": (rules[0].get("title") if rules else r.get("title")),
                "assetCount": r.get("assetCount"),
            }
        )
    shaped.sort(key=lambda f: (sev_rank.get(f["severity"], 3), -(f["assetCount"] or 0)))
    return shaped


if __name__ == "__main__":
    if not OIDC_CLIENT_SECRET:
        raise SystemExit("OIDC_CLIENT_SECRET is required (see .env.example)")
    mcp.run(transport="streamable-http")
