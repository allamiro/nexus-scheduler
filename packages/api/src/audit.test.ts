import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { prisma } from "./db.js";
import { recordAuditEvent } from "./audit.js";

// Real Postgres, not a mocked Prisma client — same discipline as
// access.test.ts. syslogEnabled is false (no AppSettings row / default
// false), so mirrorToSyslog no-ops and these tests only exercise the
// Postgres write path.
async function resetDb() {
  await prisma.auditEvent.deleteMany({});
}

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

function fakeRequest(overrides: Partial<Request> = {}): Request {
  return {
    ip: "10.1.2.3",
    sessionID: "sess-abc123",
    id: "req-xyz789",
    method: "PATCH",
    baseUrl: "/api/teams",
    route: { path: "/:teamId/members/:userId" },
    originalUrl: "/api/teams/team-1/members/user-1",
    get: (name: string) => (name.toLowerCase() === "user-agent" ? "vitest-agent/1.0" : undefined),
    ...overrides,
  } as unknown as Request;
}

describe("recordAuditEvent (API) — derived how/where fields (§41)", () => {
  it("derives httpMethod, httpPath, userAgent, requestId, and a session-hashed correlationId from req", async () => {
    await recordAuditEvent({
      req: fakeRequest(),
      actorType: "USER",
      actorId: "user-1",
      actorEmail: "actor@example.test",
      action: "team.membership.update",
      targetType: "team",
      targetId: "team-1",
      result: "SUCCESS",
    });

    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "team.membership.update" } });
    expect(event.httpMethod).toBe("PATCH");
    expect(event.httpPath).toBe("/api/teams/:teamId/members/:userId");
    expect(event.userAgent).toBe("vitest-agent/1.0");
    expect(event.requestId).toBe("req-xyz789");
    expect(event.sourceIp).toBe("10.1.2.3");
    expect(event.correlationId).toBe(createHash("sha256").update("sess-abc123").digest("hex").slice(0, 32));
    // Never the raw session id — same sensitivity as a bearer credential.
    expect(event.correlationId).not.toBe("sess-abc123");
  });

  it("falls back to req.originalUrl for httpPath when no route matched (e.g. an error path)", async () => {
    await recordAuditEvent({
      req: fakeRequest({ route: undefined }),
      actorType: "USER",
      actorId: "user-1",
      actorEmail: "actor@example.test",
      action: "login.failure",
      targetType: "user",
      result: "FAILURE",
    });

    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "login.failure" } });
    expect(event.httpPath).toBe("/api/teams/team-1/members/user-1");
  });

  it("leaves all derived fields null when no req is supplied (worker-style call)", async () => {
    await recordAuditEvent({
      actorType: "SERVICE",
      actorId: "system:scheduler",
      actorEmail: "system:scheduler",
      action: "schedule.approve",
      targetType: "schedule",
      result: "SUCCESS",
      correlationId: "run-42",
    });

    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "schedule.approve" } });
    expect(event.httpMethod).toBeNull();
    expect(event.httpPath).toBeNull();
    expect(event.userAgent).toBeNull();
    expect(event.requestId).toBeNull();
    expect(event.sourceIp).toBeNull();
    // An explicit correlationId (e.g. a runId) is never overridden by
    // the session-hash derivation.
    expect(event.correlationId).toBe("run-42");
  });

  // Regression: auditEventSchema originally constrained actorEmail to
  // `.email()`, which every SERVICE-actor and pre-auth call site in this
  // codebase already violates ("system:scheduler", "unknown") per
  // REQUIREMENTS §7.1's own definition of actor_email. Wiring up
  // validation must not turn those established, correct call sites into
  // permanent warning-log spam.
  it("accepts non-email actorEmail values already used by SERVICE and pre-auth events", async () => {
    await recordAuditEvent({
      actorType: "SERVICE",
      actorId: "system:scheduler",
      actorEmail: "system:scheduler",
      action: "run.notify_email",
      targetType: "run",
      result: "SUCCESS",
    });
    await recordAuditEvent({
      actorType: "USER",
      actorId: "unknown",
      actorEmail: "unknown",
      action: "login.failure",
      targetType: "user",
      result: "FAILURE",
    });

    const events = await prisma.auditEvent.findMany({
      where: { action: { in: ["run.notify_email", "login.failure"] } },
    });
    expect(events).toHaveLength(2);
  });

  it("persists subject fields, category, and a before->after changes diff", async () => {
    await recordAuditEvent({
      req: fakeRequest(),
      actorType: "USER",
      actorId: "admin-1",
      actorEmail: "admin@example.test",
      action: "user.update",
      targetType: "user",
      targetId: "user-2",
      targetName: "user2@example.test",
      subjectType: "user",
      subjectId: "user-2",
      subjectName: "user2@example.test",
      category: "authz_change",
      changes: { role: { from: "VIEW", to: "ADMIN" } },
      result: "SUCCESS",
    });

    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "user.update" } });
    expect(event.subjectType).toBe("user");
    expect(event.subjectId).toBe("user-2");
    expect(event.subjectName).toBe("user2@example.test");
    expect(event.category).toBe("authz_change");
    expect(event.changes).toEqual({ role: { from: "VIEW", to: "ADMIN" } });
  });

  it("two requests with the same session hash to the same correlationId", async () => {
    await recordAuditEvent({
      req: fakeRequest({ sessionID: "shared-session" }),
      actorType: "USER",
      actorId: "user-1",
      actorEmail: "actor@example.test",
      action: "login.success",
      targetType: "user",
      result: "SUCCESS",
    });
    await recordAuditEvent({
      req: fakeRequest({ sessionID: "shared-session", id: "req-2" }),
      actorType: "USER",
      actorId: "user-1",
      actorEmail: "actor@example.test",
      action: "project.acl.grant",
      targetType: "project",
      result: "SUCCESS",
    });

    const login = await prisma.auditEvent.findFirstOrThrow({ where: { action: "login.success" } });
    const grant = await prisma.auditEvent.findFirstOrThrow({ where: { action: "project.acl.grant" } });
    expect(login.correlationId).toBe(grant.correlationId);
    // ...but each request still gets its own distinct requestId.
    expect(login.requestId).not.toBe(grant.requestId);
  });
});
