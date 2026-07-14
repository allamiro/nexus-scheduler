import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db.js";
import { recordAuditEvent } from "./audit.js";

// Real Postgres, not a mocked Prisma client — same discipline as the
// API's audit.test.ts (this is the worker's separate implementation of
// the same recordAuditEvent contract).
async function resetDb() {
  await prisma.auditEvent.deleteMany({});
}

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe("recordAuditEvent (worker) §41", () => {
  it("persists subject fields, category, and a changes diff alongside the caller-supplied correlationId", async () => {
    await recordAuditEvent({
      actorType: "SERVICE",
      actorId: "system:scheduler",
      actorEmail: "system:scheduler",
      action: "schedule.approve",
      targetType: "schedule",
      targetId: "sched-1",
      targetName: "Nightly report",
      subjectType: "user",
      subjectId: "user-1",
      subjectName: "submitter@example.test",
      category: "lifecycle",
      changes: { status: { from: "PENDING", to: "APPROVED" } },
      result: "SUCCESS",
      correlationId: "run-99",
    });

    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "schedule.approve" } });
    expect(event.subjectType).toBe("user");
    expect(event.subjectId).toBe("user-1");
    expect(event.subjectName).toBe("submitter@example.test");
    expect(event.category).toBe("lifecycle");
    expect(event.changes).toEqual({ status: { from: "PENDING", to: "APPROVED" } });
    expect(event.correlationId).toBe("run-99");
  });

  // Regression: see the identical test in packages/api/src/audit.test.ts
  // — every SERVICE-actor call site in this file uses "system:scheduler"
  // as actorEmail, which is not RFC-valid; validation must accept it.
  it("accepts the non-email 'system:scheduler' actorEmail used by every SERVICE-actor call site", async () => {
    await recordAuditEvent({
      actorType: "SERVICE",
      actorId: "system:scheduler",
      actorEmail: "system:scheduler",
      action: "run.complete",
      targetType: "run",
      result: "SUCCESS",
    });

    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "run.complete" } });
    expect(event.actorEmail).toBe("system:scheduler");
  });
});
