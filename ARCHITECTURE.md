# Nexus Scheduler — Architecture

This document visualizes the system structure described in
[REQUIREMENTS.md](./REQUIREMENTS.md). It captures the working technical
direction (still draft, see REQUIREMENTS.md §11) as diagrams rather than
prose — the "why" behind each decision lives in REQUIREMENTS.md; this file
is the "what it looks like."

Diagrams are [Mermaid](https://mermaid.js.org/) and render natively on
GitHub/GitLab.

## 1. System Context

Who and what Nexus Scheduler talks to, at the boundary of the deployment.

```mermaid
flowchart LR
    subgraph Users
        EndUser[Editor / Viewer<br/>browser]
        Admin[Admin<br/>browser]
    end

    NS[["Nexus Scheduler"]]

    KC[(Keycloak<br/>OIDC IdP)]
    LC[[LibreChat<br/>Agents API]]
    SMTP[(SMTP Relay)]
    SIEM[(Syslog / SIEM)]
    WH[(Internal Webhook<br/>Destinations<br/>admin allow-listed)]

    EndUser -- HTTPS --> NS
    Admin -- HTTPS --> NS
    NS -- OIDC login --> KC
    NS -- "Bearer API key<br/>(user or Team key)" --> LC
    NS -- notifications --> SMTP
    NS -- RFC 5424 audit/log stream --> SIEM
    NS -- signed run results --> WH
```

Everything above the dotted line in later diagrams runs **inside** the
air-gapped Government network. LibreChat, Keycloak, SMTP, SIEM, and
webhook destinations are all internal services on that same network —
nothing here reaches the public internet at runtime (REQUIREMENTS.md §3).

## 2. Containers / Runtime Components

```mermaid
flowchart TB
    subgraph edge["Edge (pre-existing in prod)"]
        NGINX[nginx reverse proxy<br/>TLS termination]
    end

    subgraph app["Nexus Scheduler"]
        FE[Frontend SPA<br/>static assets]
        API[Backend API<br/>auth · CRUD · audit access]
        WORKER[Scheduler / Worker<br/>fires due schedules,<br/>calls LibreChat, retries,<br/>enforces concurrency]
        PDFSVC[PDF Renderer<br/>isolated service,<br/>no network egress]
    end

    subgraph data["Data Layer"]
        PG[(PostgreSQL<br/>system of record)]
        REDIS[(Redis<br/>job queue /<br/>scheduling coordination)]
    end

    NGINX --> FE
    NGINX --> API
    API <--> PG
    API <--> REDIS
    API -- HTTP, in-cluster only --> PDFSVC
    WORKER <--> PG
    WORKER <--> REDIS
    WORKER -- REST, Bearer key --> LC[[LibreChat Agents API]]
    WORKER -- HTTP, in-cluster only --> PDFSVC
```

**Why API and Worker are separate containers**: the API serves interactive
UI traffic; the Worker runs due schedules concurrently and must scale
independently (horizontally, via replica count) as job volume grows,
without affecting UI responsiveness. Redis is the coordination point
between them — see REQUIREMENTS.md §2.1 and §11.

**Why the PDF Renderer is its own service, not a library**: it's the only
component that launches a headless browser (REQUIREMENTS.md §2.5 calls
for full isolation — its own pod, no network egress, independent crash-
restart), so it's split out rather than linked into API/Worker directly.
Both call it over HTTP; a `NetworkPolicy` (§5 below) enforces that only
API/Worker pods can reach it and that it can reach nothing outbound.

### Component responsibilities

| Component | Responsibility |
|---|---|
| Frontend (SPA) | Job/schedule/Project/Team UI, Prompt Library, admin settings, classification banner rendering |
| Backend API | AuthN/AuthZ (OIDC + local), CRUD for jobs/schedules/Projects/Teams/prompts, audit log access, approval queue, reporting endpoints, on-demand PDF download (via the PDF Renderer service) |
| Scheduler/Worker | Polls due schedules, enqueues/dequeues runs respecting concurrency limits, calls LibreChat, retries, computes cost, sends notifications/webhooks/emailed PDF reports (via the PDF Renderer service), writes audit events, and sends a recurring admin usage-report email on its own schedule |
| PDF Renderer | `packages/pdf-service` — an isolated internal-only service (headless Chromium via Playwright) that renders run reports and the admin usage report to PDF on request from the API or Worker over HTTP. No inbound route from outside the cluster, no outbound network access at all (REQUIREMENTS.md §2.5) |
| PostgreSQL | System of record: see §5 data model |
| Redis | Job queue + scheduling coordination across Worker replicas |
| nginx | TLS termination + reverse proxy (pre-existing in prod; included in Compose for local parity) |

## 3. Job Execution Flow

The core operational loop: a schedule fires, a job runs against LibreChat,
and the result is stored, audited, and optionally delivered.

```mermaid
sequenceDiagram
    actor U as Editor
    participant FE as Frontend
    participant API as Backend API
    participant DB as PostgreSQL
    participant Q as Redis Queue
    participant W as Scheduler/Worker
    participant LC as LibreChat Agents API
    participant PDF as PDF Renderer
    participant SMTP as SMTP
    participant WH as Webhook Destination

    U->>FE: Define schedule (interval, prompt, agent, timezone)
    FE->>API: POST /schedules
    API->>DB: Persist schedule
    Note over API,DB: Shared Project? status = pending_approval (§2.4)
    API-->>FE: 201 Created

    loop Every tick
        W->>DB: Find schedules due to fire
        W->>Q: Enqueue due run (skips if worker was down at fire time)
    end

    W->>Q: Dequeue run (bounded by global/per-user concurrency, §2.1)
    W->>DB: Load job + pinned/latest prompt version + API key (user or Team)
    W->>LC: POST /api/agents/v1/chat/completions (Bearer API key)
    alt success
        LC-->>W: response + usage (prompt/completion tokens)
        W->>DB: Store run (output, tokens, computed cost, status=success)
    else transient failure
        W->>W: Retry with backoff (default 2x, §2.1)
        W->>LC: retry request
    else non-transient failure (e.g. 401 expired key)
        W->>DB: Store run (status=failed), mark API key invalid
        W->>U: Notify key owner (UI banner + email)
    end
    W->>DB: Write audit event (run.start / run.complete)
    opt Email notification configured
        opt PDF report attachment enabled
            W->>PDF: POST /render/run-report (branding + classification banner)
            PDF-->>W: PDF bytes
        end
        W->>SMTP: Send completion/failure email (optionally with PDF attached)
    end
    opt Webhook configured
        W->>WH: POST signed run result (allow-listed destination only)
    end
```

## 4. Data Model (Illustrative)

Not a final schema — shows the key entities and relationships implied by
REQUIREMENTS.md (§2–§8).

```mermaid
erDiagram
    USER ||--o{ TEAM_MEMBERSHIP : "belongs to"
    TEAM ||--o{ TEAM_MEMBERSHIP : has
    TEAM ||--o{ TEAM : "parent of (nesting)"
    USER ||--o{ API_KEY : owns
    TEAM ||--o{ API_KEY : owns

    USER ||--o{ PROJECT : owns
    PROJECT ||--o{ PROJECT_ACL : "shared via (user or Team)"
    PROJECT }o--|| CLASSIFICATION_LABEL : "tagged with"
    PROJECT ||--o{ PROMPT : contains

    PROMPT ||--o{ PROMPT_VERSION : has

    PROJECT ||--o{ JOB : contains
    PROMPT_VERSION ||--o{ JOB : "referenced by (pinned or latest)"
    JOB ||--o{ SCHEDULE : "triggered by"
    SCHEDULE ||--o{ RUN : produces
    JOB ||--o{ RUN : "ad-hoc (Run Now)"

    RUN ||--o{ AUDIT_EVENT : generates
    JOB ||--o{ WEBHOOK_DESTINATION : "delivers to (allow-listed)"
    AGENT_COST_RATE ||--o{ RUN : "priced by (rate in effect at run time)"
```

Key fields worth calling out explicitly (full detail in REQUIREMENTS.md):

- `RUN`: `trigger_type` (scheduled/manual), `status`, `prompt_tokens`,
  `completion_tokens`, `computed_cost`, `output`, timing fields. Token
  fields are populated from whichever of LibreChat's two observed
  `usage` shapes the underlying provider returns (OpenAI-style
  `prompt_tokens`/`completion_tokens`, or Anthropic-style
  `input_tokens`/`output_tokens`).
- `SCHEDULE`: `timezone` (IANA), `paused`, `approval_status`,
  `version_pin_mode` (pinned vs. always-latest).
- `TEAM_MEMBERSHIP`: an `is_owner` flag — a Team can have one or more
  owners, distinct from ordinary members, who alone (plus admins) can
  rename/delete the Team or manage its membership.
- `PROJECT`: `owner_id` is transferable after creation (owner- or
  admin-only) via a dedicated endpoint, not the general Project-edit
  path, so an edit-level collaborator can never grant themselves
  ownership.
- `AUDIT_EVENT`: see the proposed schema in REQUIREMENTS.md §7.1.

## 5. Deployment Topology — Kubernetes (Production)

```mermaid
flowchart TB
    subgraph ext["Existing Cluster/Network Infra"]
        NGINX[nginx<br/>reverse proxy]
        KC[Keycloak]
        LC[[LibreChat Agents API]]
        SIEM[(Syslog / SIEM)]
        SMTPX[(SMTP relay)]
    end

    subgraph ns["K8s Namespace: nexus-scheduler (Helm release)"]
        SVC_API[Service: api]
        subgraph apipods["Deployment: api"]
            API1[api pod]
            API2[api pod ...N]
        end
        subgraph workerpods["Deployment: worker"]
            W1[worker pod]
            W2[worker pod ...N]
        end
        subgraph pdfpods["Deployment: pdf-service<br/>(NetworkPolicy: ingress from<br/>api/worker only, egress denied)"]
            PDF1[pdf-service pod]
            PDF2[pdf-service pod ...N]
        end
        PG[("PostgreSQL<br/>bundled first-party subchart<br/>(default) or external")]
        REDIS[("Redis<br/>bundled first-party subchart<br/>(default) or external")]
        SEC[/K8s Secrets:<br/>DB/Redis creds, OIDC client secret,<br/>SMTP creds, key-encryption key/]
    end

    NGINX --> SVC_API --> API1 & API2
    API1 & API2 --> PG
    API1 & API2 --> REDIS
    API1 & API2 -- HTTP, in-cluster only --> PDF1 & PDF2
    W1 & W2 --> PG
    W1 & W2 --> REDIS
    W1 & W2 -- Bearer API key --> LC
    W1 & W2 -- HTTP, in-cluster only --> PDF1 & PDF2
    API1 -. OIDC .-> KC
    API1 & W1 -. RFC 5424 .-> SIEM
    W1 -. SMTP .-> SMTPX
    SEC -.-> API1
    SEC -.-> W1
```

- Images relocatable to an internal/offline registry (REQUIREMENTS.md §3).
- Runs in FIPS mode end to end (REQUIREMENTS.md §10).
- `/healthz` and `/metrics` on all three Deployments (api, worker,
  pdf-service — REQUIREMENTS.md §10, §11).
- PostgreSQL/Redis are bundled by default as minimal first-party Helm
  subcharts (`helm/nexus-scheduler/charts/{postgresql,redis}`) so a
  default install needs no external dependency or network access to
  stand them up; either can be swapped for an externally-managed
  instance via a values toggle.
- The LibreChat connection supports a custom CA bundle
  (`librechat.tls.caBundle`) for environments where LibreChat's
  certificate chains to an internal CA, and a TLS-validation-bypass
  escape hatch for testing (`librechat.tls.insecureSkipVerify`).
- `pdf-service` is the only component this chart applies a
  `NetworkPolicy` to so far — everything else (api/worker/frontend/
  postgresql/redis) has none defined yet (see §8).

## 6. Deployment Topology — Docker Compose (Local Dev/Test)

```mermaid
flowchart TB
    subgraph compose["docker-compose (has internet access)"]
        NGINX2[nginx]
        API2[nexus-api]
        W2[nexus-worker]
        FE2[nexus-frontend]
        PDF2[nexus-pdf-service]
        PG2[(postgres)]
        REDIS2[(redis)]
        KC2[keycloak<br/>test realm]
        MAIL[mailpit]
        LC2[[librechat<br/>real local instance]]
        MONGO2[(librechat-mongo)]
        OLLAMA2[ollama<br/>qwen3:0.6b, or use<br/>a real Anthropic key]
    end

    NGINX2 --> FE2
    NGINX2 --> API2
    API2 --> PG2
    API2 --> REDIS2
    API2 --> PDF2
    W2 --> PG2
    W2 --> REDIS2
    W2 --> PDF2
    W2 -- Bearer API key --> LC2
    LC2 --> MONGO2
    LC2 --> OLLAMA2
    API2 -. OIDC .-> KC2
    W2 -. SMTP .-> MAIL
```

- All secrets/keys **randomly generated at compose-up** (REQUIREMENTS.md
  §9.2) — no committed defaults.
- Exists purely to exercise Nexus Scheduler itself; does not attempt to
  simulate the air-gapped constraint.

## 7. Roles at a Glance

```mermaid
flowchart LR
    admin[admin] -->|manage| users[Users / Roles / System Config /<br/>Branding / Classification Taxonomy]
    editor[editor] -->|create & run| jobs[Jobs / Schedules /<br/>Projects / Prompts / API Keys]
    view[view] -->|read only| history[Run History / Audit Logs /<br/>Shared Projects & Prompts]
```

Full role/permission detail: REQUIREMENTS.md §4.

## 8. Open Items Affecting Architecture

- **LibreChat `usage` response shape**: REQUIREMENTS.md §14 still lists
  live confirmation against the target LibreChat deployment as open. The
  `RUN` entity impact (§4) is no longer blocked on that answer either
  way — the Worker now recognizes both the OpenAI-style and
  Anthropic-style shapes LibreChat is known to pass through depending on
  the underlying provider — but a live check is still worth doing to
  catch a third shape neither branch handles.
- **Cluster-wide `NetworkPolicy` posture**: only `pdf-service` (§5) has
  one so far, scoped narrowly to the specific isolation requirement
  REQUIREMENTS.md §2.5 calls out for it. api/worker/frontend/postgresql/
  redis have no `NetworkPolicy` yet — broadening that posture is a
  separate piece of work if a security review calls for it.
- **Non-root UID for the bundled PostgreSQL/Redis subcharts**: both
  currently run as their upstream images' default user rather than a
  hardened non-root UID, deferred until a real cluster is available to
  validate the resulting boot behavior against (REQUIREMENTS.md §3/§9.1/
  §10's broader hardening baseline).
