# Nexus Scheduler — Requirements & Design

Status: **Draft** — living document, updated as design decisions are made.

Last updated: 2026-07-12

## 1. Overview

Nexus Scheduler is a web-based application for scheduling agentic AI tasks
that run against a **LibreChat** agent API. Users define jobs (prompts /
agent invocations), schedule them as one-time or recurring, and Nexus
Scheduler executes them concurrently against LibreChat using a
user-supplied API key, storing and surfacing the results.

Target deployment: air-gapped, security-hardened **Government Kubernetes**
environment, with a **Docker Compose** setup for local development/testing.

## 2. Purpose & Core Functionality

- Web application for scheduling agentic AI tasks executed via the
  LibreChat front end / agent API.
- Connects to the LibreChat agent API using a **user-supplied API key**.
  - The API key is entered and stored per-user via the web UI (not
    configured only at the system/admin level).
- Supports **concurrent** execution of multiple scheduled jobs.
- Supports both:
  - **One-time** (run-once, at a specified date/time) jobs.
  - **Recurring** jobs, defined via **simplified interval pickers** (e.g.
    "every N minutes/hours/days/weeks", day-of-week + time-of-day, etc.)
    rather than raw cron syntax — prioritizes usability for non-technical
    users. Advanced/cron-style expressions are not required for v1.

### 2.1 LibreChat Integration Model

LibreChat exposes an **Agents API** (beta) that is OpenAI-compatible:
<https://www.librechat.ai/docs/features/agents_api>

- Endpoint: `POST /api/agents/v1/chat/completions` (OpenAI-compatible chat
  completions shape), or the Open Responses variant at
  `POST /api/agents/v1/responses`.
- The `model` field is the target **agent ID**; `messages` (or `input` for
  the responses variant) carries the job's configured prompt/payload.
- Authentication is via `Authorization: Bearer <API key>`, using the
  user-supplied LibreChat API key (LibreChat API keys are created via
  `POST /api/api-keys` on the LibreChat side, outside Nexus Scheduler).
- Integration is a **REST call per job execution**: on each trigger, Nexus
  Scheduler calls the LibreChat Agents API with the job's configured
  prompt/payload and the owning user's API key. `stream` is not needed for
  scheduled/unattended execution — request the non-streaming response.
- Each execution is stateless — a fresh request per run. Conversation/
  thread continuity across runs is **out of scope for v1**.
- Because this API is documented as **beta**, Nexus Scheduler's LibreChat
  client should isolate the request/response mapping behind a single
  adapter module so breaking changes upstream are easy to absorb.
- Job execution timeout and retry policy are configurable (see below);
  concurrency limits (global and per-user) are configurable by an admin.
- **Default execution timeout: 10 minutes per job run**, admin-configurable
  with a hard ceiling of 60 minutes (agentic/multi-step tasks can run long,
  but an unbounded call risks starving worker capacity). Jobs may override
  the default timeout downward but not above the admin-set ceiling.
- **Job cancellation is required for v1**: a user with sufficient
  permission (job owner, or admin) can cancel a running job; the scheduler
  must abort the in-flight LibreChat request and mark the run cancelled.
- **Concurrency defaults** (sized for an enterprise directory of 500+
  users with expected light-to-moderate concurrent usage, not 500
  simultaneous runs): global default max **25 concurrent job executions**,
  per-user default max **5 concurrent job executions**, both
  admin-configurable. Worker capacity should scale horizontally (via
  replica count) if real usage exceeds these defaults.

### 2.2 Job Output Handling

- Full LibreChat response (and execution metadata: start/end time, status,
  duration, error if any) is persisted in PostgreSQL.
- Users can view job run history and full output/detail in the web UI.
- Email notification (via SMTP) is optionally sent to the job owner on
  completion and/or failure, per-job configurable.

### 2.3 Saved & Shareable Prompts (Projects)

- Users can save reusable prompt/job templates rather than re-authoring
  them per schedule.
- Saved prompts are organized into **Projects** — shared containers that
  group related prompts/jobs so power users can collaborate and reuse each
  other's work.
- Each Project has an owner and a visibility/sharing setting (e.g.
  private, shared with specific users, or org-wide/shared with all
  authenticated users) — exact sharing model to be finalized (see §12).
- A saved prompt in a shared Project can be used as the basis for a new
  job/schedule by any user with access to that Project, without needing to
  know the underlying LibreChat agent/prompt details.
- Editing a shared prompt is restricted to the Project owner/collaborators
  with edit access; other members with access can view and use (copy/run)
  it per the role model (§4).

## 3. Constraints

- **Container-based**: the application ships as container image(s),
  designed to run in Kubernetes.
- **Docker Compose** file provided for local dev/testing:
  - Includes all required supporting services (Postgres, Redis, etc.).
  - Uses **randomly generated secrets/keys** for local testing (no
    hardcoded defaults).
  - The local Compose environment has internet access and exists purely to
    test the scheduler app itself (it does not need to simulate the
    air-gapped constraint).
- **Air-gapped production environment**:
  - No outbound external network access may be assumed or required at
    runtime.
  - All dependencies (base images, language packages, fonts, etc.) must be
    vendored/bundled into build artifacts — no pulling from the internet
    at deploy or runtime.
  - Container images must be built to be pushed into an internal/offline
    registry.
- **Government network / high security priority**:
  - Follow security hardening best practices throughout (see §8).
- **Use well-known, established components** for each architectural layer
  (e.g., PostgreSQL, Redis, nginx) rather than niche/bespoke tooling.

## 4. Authentication & Authorization

- Modern, web-based login supporting:
  - **OIDC** (tested against **Keycloak**).
  - **Locally managed accounts** (username/password) as a fallback/alt
    path, for environments without an IdP.
- OIDC claims mapping must support:
  - Email
  - Given name
  - Last (family) name
  - Full / display name
- **Roles** (simplified to 3 + admin, per design decision):
  - **admin** — manage users, roles, system configuration, LibreChat
    connection defaults, audit log access, branding/customization.
  - **editor** — create and edit job definitions, manage LibreChat API key
    connections, create/manage schedules for jobs, and create/edit Projects
    and saved prompts (merges the originally proposed "build" and
    "schedule" roles).
  - **view** — read-only access to job definitions, schedules, run
    history/output, audit logs, and shared Projects/prompts (can view and
    copy shared prompts, but cannot create schedules or run jobs).
- Role assignment supported both via local role management and via OIDC
  group/role claim mapping. Confirmed approach: map role from an OIDC
  group/role claim (claim name admin-configurable) with a fallback default
  role for authenticated users who have no matching claim.
- Passwords for local accounts must be stored using a strong adaptive hash
  (e.g., bcrypt/argon2); no plaintext or reversible storage.
- Per-user LibreChat API keys must be stored **encrypted at rest**.

## 5. Look & Feel

- Modern web UI (responsive, accessible).
- Branding/customization support: logo, product name, color theme
  configurable by an admin without a rebuild (e.g., via mounted config or
  admin settings screen).
- SMTP-based email notifications:
  - Job completion / failure notifications (per §2.2).
  - Account-related notifications (e.g., password reset, if local auth is
    used).
  - SMTP server settings configurable by admin (host, port, TLS, auth,
    from-address).

## 6. Auditing & Logging

- All actions are logged and attributed to an **actor identity**:
  - Human users → by **email**.
  - Agent/system/service-initiated actions (e.g., scheduler firing a job)
    → by **service identity** (e.g., `system:scheduler`).
- Audited action categories:
  - **User actions**: login/logout, job create/edit/delete, schedule
    create/edit/delete, API key add/remove, settings changes.
  - **Admin actions**: user/role management, system configuration changes,
    branding changes, SMTP config changes.
  - **Agent/task actions**: job execution start, completion, failure,
    cancellation, and the LibreChat request/response metadata.
- Local log/audit retention: **14 days by default**, configurable by
  admin.
- Audit records are stored in **PostgreSQL** (structured, queryable) as
  the system of record for local retention/UI display.
- Nexus Scheduler must **also support emitting logs via syslog** (e.g.
  RFC 5424, over UDP/TCP/TLS to an admin-configured destination) so
  Government environments can forward application/audit events into an
  existing centralized log pipeline (e.g. SIEM), independent of the
  14-day local Postgres retention. Syslog output should be enable/
  disable-able and point at an admin-configured host:port.

## 7. Deployment

### 7.1 Kubernetes (Production)

- **Helm chart** for deployment, optionally including:
  - PostgreSQL (as a subchart/dependency, or bring-your-own).
  - Redis (as a subchart/dependency, or bring-your-own).
- **nginx is not deployed by this chart** — the target environment already
  provides nginx as a reverse proxy in front of the application; the Helm
  chart only needs to expose a standard Service/Ingress the existing proxy
  can target.
- All images referenced by the chart must be relocatable to an internal/
  offline registry (configurable image repository/registry values, no
  hardcoded public registry references required at runtime).
- Secrets (DB credentials, session signing keys, OIDC client secret, SMTP
  credentials, API key encryption key) sourced from Kubernetes Secrets —
  never baked into images.

### 7.2 Docker Compose (Local Dev / Testing)

- Single `docker-compose.yml` (or set of compose files) that stands up
  everything needed to run and exercise Nexus Scheduler locally:
  - Nexus Scheduler app container(s) (web/API, scheduler worker).
  - PostgreSQL.
  - Redis.
  - nginx (as a local reverse-proxy stand-in, since production nginx is
    external to the app).
  - Local Keycloak instance (for testing OIDC end-to-end), or documented
    steps to point at an external test IdP.
  - Local mail-catcher (e.g., MailHog/Mailpit) to test SMTP notifications
    without a real mail server.
- All secrets/keys in the Compose setup are **randomly generated at
  startup** (e.g., via an init script or `.env` generation step) — no
  committed default passwords/keys.
- Compose environment assumes internet access is available and is only
  intended to validate the scheduler application itself, not to simulate
  the air-gapped constraint.

## 8. Security Considerations

- All traffic terminates TLS at the (externally managed) nginx layer in
  production; internal service-to-service traffic should still be
  encrypted or run within a trusted cluster network per Government network
  policy.
- Secrets never logged, never returned in API responses beyond what's
  necessary, and encrypted at rest where persisted (LibreChat API keys,
  OIDC client secret, SMTP credentials).
- CSRF protection, secure cookie flags, and standard OWASP web hardening
  applied to the web application.
- Principle of least privilege enforced via the role model (§4).
- Dependency/container images scanned for CVEs as part of the build
  pipeline (tooling TBD — must itself be air-gap-compatible).
- No telemetry/analytics calls to external services (air-gap constraint).

## 9. Proposed Architecture (Draft)

> This section captures a working technical direction; not yet finalized.

- **Frontend**: modern SPA (e.g., React) served as static assets.
- **Backend API**: handles auth (OIDC + local), job/schedule CRUD, user/
  role management, audit log access.
- **Scheduler/Worker**: separate process/container from the API, executes
  due jobs concurrently, calls the LibreChat API, writes results back.
  - Redis used as the job queue / scheduling coordination layer (e.g.,
    backing a queue library) to support concurrency and horizontal scaling
    of workers.
- **Database**: PostgreSQL — users, roles, job definitions, schedules,
  run history, audit log, Projects, saved prompts.
- **Reverse proxy**: nginx (external/pre-existing in prod; included in
  Compose for local parity).

## 10. Non-Goals (v1)

- Multi-tenant / multi-organization isolation beyond role-based access
  within a single deployment.
- Continuing/threading LibreChat conversations across scheduled runs.
- Outbound webhook/callback delivery of job results (may revisit later).

## 11. Glossary

- **Job**: a defined unit of work — a prompt/payload to send to the
  LibreChat agent API, plus execution configuration.
- **Schedule**: the timing definition (one-time or recurring) attached to
  a job that determines when it runs.
- **Run**: a single execution instance of a job, with its own result/
  status/history record.
- **Project**: a shared container for saved prompts/job templates that a
  group of users collaborate on and reuse.

## 12. Open Questions

- Exact Project sharing/ACL granularity: is "shared with specific users"
  needed at launch, or is private + org-wide sufficient for v1?
- Should saved prompts support versioning/history (e.g. see prior edits),
  or just a single current version?
- Syslog message format details: RFC 5424 structured-data fields for
  audit events, and whether TLS-syslog is mandatory in the target
  Government environment or optional/admin-configured.
- Confirm the OIDC role/group claim name convention (e.g.
  `groups` vs a custom claim) against the target Keycloak realm
  configuration once available.
- Should the 25 global / 5 per-user concurrency defaults be revisited
  once real usage patterns are observed, or is there a known peak load
  (e.g. batch of scheduled reports at top of hour) that should inform
  sizing now?

## 13. Change Log

- 2026-07-12: Initial draft created from project kickoff requirements.
- 2026-07-12: Resolved initial open questions — recurring schedules use
  interval pickers (not cron); OIDC role/group claim mapping confirmed;
  added default concurrency limits (25 global / 5 per-user) and default
  job timeout (10 min, 60 min ceiling) with required job cancellation;
  documented concrete LibreChat Agents API integration details; added
  syslog output alongside Postgres audit storage; added Projects /
  shareable saved-prompts feature (§2.3).
