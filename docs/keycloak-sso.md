# Keycloak SSO for the Compose stack

One realm, one client per app. SSO is **opt-in**: layer the Keycloak
overlay on and the apps authenticate against Keycloak; leave it off and
everything behaves exactly as it does today (local break-glass auth for
the scheduler, local registration for LibreChat, anonymous Grafana).

```
                    realm: nexus-scheduler
  ┌───────────────────────────────────────────────────────┐
  │  client nexus-scheduler   roles ADMIN / EDITOR / VIEW  │
  │  client librechat         (no roles — any realm user)  │
  │  client grafana           roles Admin / Editor / Viewer│
  └───────────────────────────────────────────────────────┘
```

## One-time host setup (required)

```
127.0.0.1 keycloak
```

Add that to `/etc/hosts`. The OIDC issuer string must be **identical**
for the browser (which is redirected to Keycloak) and for the
`api`/`librechat`/`grafana` containers (which fetch discovery and
exchange tokens). A container cannot reach the host's `localhost`, and
the host cannot resolve Docker's internal DNS — so both sides use the
one name `keycloak`, on the same port inside and out. Skip this and the
browser simply cannot resolve the login redirect.

## Run it

```bash
make up-sso          # app stack + Keycloak
make up-obs-sso      # + observability, and Grafana SSO too
make down-sso        # stop
```

Or explicitly:

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml \
               -f docker-compose.keycloak.yml \
               -f docker-compose.keycloak-observability.yml up -d
```

Grafana's SSO lives in a second file because `grafana` only exists once
the observability overlay is loaded — a compose overlay that references
a service the base never defines fails outright.

## Demo users (dev only)

| Username | Password | Scheduler role | Grafana role |
|---|---|---|---|
| `sso-admin` | `sso-admin-password` | ADMIN | Admin |
| `sso-editor` | `sso-editor-password` | EDITOR | Editor |
| `sso-viewer` | `sso-viewer-password` | VIEW | Viewer |
| `sso-norole` | `sso-norole-password` | *(none)* | *(none)* |

`sso-norole` exists to exercise the fail-closed path: a user with no
recognized client role gets the **least** privilege (`VIEW` in the
scheduler, `Viewer` in Grafana), never a default of something higher.

Keycloak admin console: `http://keycloak:8081` — credentials are
`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` from `.env`.

## How roles map

- **Scheduler** — `packages/api/src/auth/oidc.ts`'s `mapKeycloakRole()`
  reads `resource_access["nexus-scheduler"].roles` from the token and
  matches `ADMIN` / `EDITOR` / `VIEW` case-insensitively. These are
  **client** roles on the `nexus-scheduler` client, not realm roles and
  not groups. No match ⇒ `VIEW`.
- **Grafana** — `GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH` maps
  `resource_access.grafana.roles` to Grafana's own Admin/Editor/Viewer,
  falling through to Viewer.
- **LibreChat** — has no role model here; any realm user may sign in.

To add a user: create them in the realm, then assign client roles under
the relevant client. To change what a role grants, change the app — the
realm only carries the role names.

## What turns SSO on

Nothing in the base stack depends on Keycloak. The `api` enables OIDC
only when `OIDC_CLIENT_SECRET` is non-empty, and
`scripts/generate-local-env.sh` deliberately leaves it unset — so the
plain stack always falls back to local auth. The overlay supplies that
secret (and LibreChat's and Grafana's), defaulted to the fixed dev
secrets baked into `docker/keycloak/realm-nexus-scheduler.json`.

Override any of them in `.env` if you edit the realm:
`OIDC_CLIENT_SECRET`, `LIBRECHAT_OIDC_CLIENT_SECRET`,
`GRAFANA_OIDC_CLIENT_SECRET`.

## Verify it end to end

`scripts/verify-keycloak-sso.py` drives a real authorization-code flow
for each client — discovery, authorize, login POST, redirect with code,
token exchange, role decode — so a broken issuer or role mapping fails
loudly instead of turning into a confusing browser error later:

```bash
docker run --rm --network "$(basename $PWD)_default" \
  -e KC_BASE=http://keycloak:${KEYCLOAK_PORT:-8081} \
  -v "$PWD/scripts/verify-keycloak-sso.py:/t.py:ro" \
  python:3.12-slim python3 /t.py
```

It covers every scheduler role tier (including the no-role user landing
on VIEW), Grafana's three roles, a LibreChat sign-in, and that a wrong
password yields no authorization code.

## Notes and limits

- The realm is re-imported on every start (`start-dev --import-realm`,
  in-memory database). Changes made in the admin console do **not**
  survive a recreate — deliberate, so the realm stays reproducible.
  Edit `docker/keycloak/realm-nexus-scheduler.json` for durable changes.
- Client secrets in that file are **fixed dev values**. This realm is a
  local stand-in for the CAC/PIV-capable OIDC provider REQUIREMENTS §4
  describes; never reuse it outside local development.
- `KEYCLOAK_PORT` in `.env` changes the port on both sides at once
  (published and in-container), keeping the issuer consistent — useful
  when 8081 is already taken on your machine.
- Enabling Grafana SSO turns **off** its dev-only anonymous admin, so
  an unauthenticated visitor gets a login page instead of an Admin
  session.
- LiteLLM is not wired to Keycloak: its OSS proxy authenticates with
  master/virtual keys, which is how the gateway is metered here.
