import { randomUUID } from "node:crypto";
import pino from "pino";
import { buildRfc5424Message, sendSyslogMessage, auditEventSchema, type AuditCategory } from "@nexus-scheduler/shared";
import { prisma } from "./db.js";

type AuditChanges = Record<string, { from: unknown; to: unknown }>;

interface RecordAuditEventInput {
  actorType: "USER" | "SERVICE";
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId?: string;
  targetName?: string;
  // The affected second principal (§41) — see packages/api/src/audit.ts
  // for the full rationale (same shape, separate implementation).
  subjectType?: string;
  subjectId?: string;
  subjectName?: string;
  result: "SUCCESS" | "FAILURE";
  errorMessage?: string;
  correlationId?: string;
  category?: AuditCategory;
  changes?: AuditChanges;
  details?: Record<string, unknown>;
}

// See packages/api/src/audit.ts for why this is a standalone logger
// rather than threaded through every call site.
const syslogLogger = pino({ name: "syslog-mirror" });

// Worker-side counterpart to packages/api/src/audit.ts — same shape
// (REQUIREMENTS.md §7.1), separate implementation because each service
// owns its own Prisma client/process. Agent/service-initiated actions
// (a schedule firing) use actorType "SERVICE" per §7. No HTTP request
// here (no req to derive httpMethod/httpPath/userAgent/sourceIp from,
// and correlationId is whatever the caller passes — typically the
// runId that ties multiple events about one run together, playing the
// same role the API's session-hash correlationId does for one login
// session).
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  const candidate = {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    actorType: input.actorType,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    targetName: input.targetName,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    result: input.result,
    errorMessage: input.errorMessage,
    correlationId: input.correlationId,
    category: input.category,
    changes: input.changes,
    details: input.details,
  };

  const parsed = auditEventSchema.safeParse(candidate);
  if (!parsed.success) {
    syslogLogger.warn({ issues: parsed.error.issues, action: input.action }, "audit event failed schema validation");
  }

  const event = await prisma.auditEvent.create({
    data: {
      id: candidate.eventId,
      actorType: candidate.actorType,
      actorId: candidate.actorId,
      actorEmail: candidate.actorEmail,
      action: candidate.action,
      targetType: candidate.targetType,
      targetId: candidate.targetId,
      targetName: candidate.targetName,
      subjectType: candidate.subjectType,
      subjectId: candidate.subjectId,
      subjectName: candidate.subjectName,
      result: candidate.result,
      errorMessage: candidate.errorMessage,
      correlationId: candidate.correlationId,
      category: candidate.category,
      changes: candidate.changes as never,
      details: candidate.details as never,
    },
  });

  await mirrorToSyslog(event);
}

// Best-effort forward to syslog (RFC 5424, §7.1) — see the API's
// audit.ts for the full rationale (same code, separate Prisma client).
async function mirrorToSyslog(event: {
  id: string;
  timestamp: Date;
  actorType: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string | null;
  subjectType: string | null;
  subjectId: string | null;
  subjectName: string | null;
  result: string;
  errorMessage: string | null;
  correlationId: string | null;
  category: string | null;
  changes: unknown;
  details: unknown;
}): Promise<void> {
  try {
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    if (!settings?.syslogEnabled || !settings.syslogHost || !settings.syslogPort) {
      return;
    }
    const message = buildRfc5424Message({ ...event, eventId: event.id, appName: "nexus-scheduler-worker" });
    await sendSyslogMessage(
      {
        host: settings.syslogHost,
        port: settings.syslogPort,
        transport: settings.syslogTransport,
        tls: settings.syslogTls,
        caCert: settings.syslogTlsCaCert,
      },
      message,
    );
  } catch (err) {
    syslogLogger.warn({ err, eventId: event.id }, "syslog delivery failed");
  }
}
