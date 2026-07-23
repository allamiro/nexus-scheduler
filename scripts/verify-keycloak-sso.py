"""End-to-end check of the Keycloak SSO overlay (docs/keycloak-sso.md).

Drives a real authorization-code flow per client — discovery, authorize,
login-form POST, redirect with code, token exchange, claim/role decode —
so a broken issuer, a missing client, or a bad role mapping fails loudly
instead of surfacing later as a confusing browser redirect error.

Run it from inside the compose network, where `keycloak` resolves the
same way it will for a browser once /etc/hosts has the entry:

    docker run --rm --network <project>_default \\
      -e KC_BASE=http://keycloak:${KEYCLOAK_PORT:-8081} \\
      -v "$PWD/scripts/verify-keycloak-sso.py:/t.py:ro" \\
      python:3.12-slim python3 /t.py

Exits non-zero if any check fails. Demo credentials are the realm's
fixed dev values — local development only.
"""
import base64, html, json, os, re, sys, urllib.parse, urllib.request, http.cookiejar

KC = os.environ["KC_BASE"]                      # e.g. http://keycloak:8099
REALM = "nexus-scheduler"
ISSUER = f"{KC}/realms/{REALM}"

CLIENTS = {
    "nexus-scheduler": ("dev-only-nexus-scheduler-secret", "http://localhost:8080/auth/callback"),
    "librechat":       ("dev-only-librechat-secret",       "http://localhost:3080/oauth/openid/callback"),
    "grafana":         ("dev-only-grafana-secret",         "http://localhost:3300/login/generic_oauth"),
}
USERS = {
    "sso-admin":  "sso-admin-password",
    "sso-editor": "sso-editor-password",
    "sso-viewer": "sso-viewer-password",
    "sso-norole": "sso-norole-password",
}

results = []
def rec(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)

def jwt_claims(tok):
    p = tok.split(".")[1]
    p += "=" * (-len(p) % 4)
    return json.loads(base64.urlsafe_b64decode(p))

# --- discovery: the issuer the tokens will carry must equal our base ---
disc = json.load(urllib.request.urlopen(f"{ISSUER}/.well-known/openid-configuration", timeout=20))
rec("discovery issuer matches the URL used", disc["issuer"] == ISSUER, f"{disc['issuer']}")

def login(client_id, secret, redirect_uri, user, pw):
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    auth_url = disc["authorization_endpoint"] + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri,
        "response_type": "code", "scope": "openid profile email", "state": "xyz",
    })
    page = op.open(auth_url, timeout=20).read().decode()
    m = re.search(r'action="([^"]+)"', page)
    if not m:
        raise RuntimeError("no login form action found")
    action = html.unescape(m.group(1))
    # Follow-redirect must be suppressed: the success response is a 302 to
    # the app's redirect_uri (which isn't reachable from here) carrying ?code=.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    op2 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)
    data = urllib.parse.urlencode({"username": user, "password": pw}).encode()
    try:
        resp = op2.open(urllib.request.Request(action, data=data), timeout=20)
        raise RuntimeError(f"no redirect issued (HTTP {resp.status}) - credentials rejected")
    except urllib.error.HTTPError as e:
        if e.code not in (302, 303):
            raise RuntimeError(f"login failed HTTP {e.code}: {e.read()[:200]}")
        loc = e.headers["Location"]
    code = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query).get("code", [None])[0]
    if not code:
        raise RuntimeError(f"no code in redirect: {loc[:160]}")
    tok = json.load(urllib.request.urlopen(urllib.request.Request(
        disc["token_endpoint"],
        data=urllib.parse.urlencode({
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": redirect_uri, "client_id": client_id, "client_secret": secret,
        }).encode()), timeout=20))
    return tok

# --- scheduler: every role tier, including the fail-closed no-role user ---
EXPECT = {"sso-admin": "ADMIN", "sso-editor": "EDITOR", "sso-viewer": "VIEW", "sso-norole": None}
cid, (sec, redir) = "nexus-scheduler", CLIENTS["nexus-scheduler"]
for user, want in EXPECT.items():
    try:
        tok = login(cid, sec, redir, user, USERS[user])
        c = jwt_claims(tok["access_token"])
        roles = (c.get("resource_access", {}).get(cid, {}) or {}).get("roles", [])
        got = next((r for r in ("ADMIN", "EDITOR", "VIEW") if r in [x.upper() for x in roles]), None)
        ok = got == want and c["iss"] == ISSUER and c.get("email")
        rec(f"scheduler login {user}", ok, f"roles={roles} -> app role {got or 'none (=VIEW default)'}")
    except Exception as e:
        rec(f"scheduler login {user}", False, str(e)[:160])

# --- grafana: role claim drives its Admin/Editor/Viewer mapping ---
cid, (sec, redir) = "grafana", CLIENTS["grafana"]
for user, want in {"sso-admin": "Admin", "sso-editor": "Editor", "sso-viewer": "Viewer"}.items():
    try:
        tok = login(cid, sec, redir, user, USERS[user])
        c = jwt_claims(tok["access_token"])
        roles = (c.get("resource_access", {}).get("grafana", {}) or {}).get("roles", [])
        rec(f"grafana login {user}", want in roles, f"resource_access.grafana.roles={roles}")
    except Exception as e:
        rec(f"grafana login {user}", False, str(e)[:160])

# --- librechat: any realm user signs in; no role model expected ---
cid, (sec, redir) = "librechat", CLIENTS["librechat"]
try:
    tok = login(cid, sec, redir, "sso-viewer", USERS["sso-viewer"])
    c = jwt_claims(tok["access_token"])
    rec("librechat login sso-viewer", bool(c.get("email")) and c["iss"] == ISSUER,
        f"email={c.get('email')} iss ok")
except Exception as e:
    rec("librechat login sso-viewer", False, str(e)[:160])

# --- negative: wrong password must not yield a code ---
try:
    login("nexus-scheduler", CLIENTS["nexus-scheduler"][0], CLIENTS["nexus-scheduler"][1],
          "sso-admin", "wrong-password")
    rec("wrong password rejected", False, "SECURITY: a code was issued for a bad password")
except Exception as e:
    # Keycloak re-renders the login page (HTTP 200) with an error and
    # issues no code — that is the correct rejection, not a redirect.
    msg = str(e)
    rec("wrong password rejected (no code issued)", "credentials rejected" in msg, msg[:90])

p = sum(1 for _, ok, _ in results if ok)
print(f"\nOIDC FLOW TOTAL: {p}/{len(results)} passed", flush=True)
sys.exit(0 if p == len(results) else 1)
