import { Router } from "express";
import { updateUserSchema, createLocalUserSchema } from "@nexus-scheduler/shared";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";
import { recordAuditEvent } from "../audit.js";
import { issuePasswordResetEmail } from "../passwordReset.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

// Doubles as the read-only picker used when adding Team members/Project
// ACLs (any authenticated user, capped result set) and, for admins, the
// full user list backing role/active-status management (§4).
export function createUsersRouter(config: AppConfig, logger: Logger): Router {
  const router = Router();

  router.get("/", requireAuth, async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const isAdmin = req.session.user!.role === "ADMIN";
    const users = await prisma.user.findMany({
      where: search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { displayName: { contains: search, mode: "insensitive" } },
            ],
          }
        : undefined,
      select: { id: true, email: true, displayName: true, role: true, active: true, authSource: true },
      // Admin listing isn't paginated yet — fine well past REQUIREMENTS'
      // 500-user target, but real pagination is a follow-up if this
      // deployment's directory ends up much larger.
      take: isAdmin ? 1000 : 25,
      orderBy: { email: "asc" },
    });
    res.json(users);
  });

  router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const admin = req.session.user!;

    if (req.params.id === admin.id && parsed.data.role && parsed.data.role !== "ADMIN") {
      res.status(400).json({ error: "cannot demote your own account" });
      return;
    }
    if (req.params.id === admin.id && parsed.data.active === false) {
      res.status(400).json({ error: "cannot deactivate your own account" });
      return;
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: parsed.data,
      select: { id: true, email: true, displayName: true, role: true, active: true, authSource: true },
    });

    await recordAuditEvent({
      req,
      actorType: "USER",
      actorId: admin.id,
      actorEmail: admin.email,
      action: "user.update",
      targetType: "user",
      targetId: user.id,
      targetName: user.email,
      result: "SUCCESS",
      details: parsed.data,
    });

    res.json(user);
  });

  // Provisions a local account with no password set yet (§4) — the
  // account holder sets one via the same reset-password link this
  // immediately triggers, so there's never a temp password to
  // communicate out of band.
  router.post("/", requireAuth, requireAdmin, async (req, res) => {
    if (!config.LOCAL_AUTH_ENABLED) {
      res.status(503).json({ error: "local accounts are disabled on this deployment" });
      return;
    }
    const parsed = createLocalUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const admin = req.session.user!;

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      res.status(409).json({ error: "a user with that email already exists" });
      return;
    }

    const user = await prisma.user.create({
      data: {
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        authSource: "LOCAL",
        role: parsed.data.role,
      },
    });

    await issuePasswordResetEmail(config, logger, user);

    await recordAuditEvent({
      req,
      actorType: "USER",
      actorId: admin.id,
      actorEmail: admin.email,
      action: "user.create",
      targetType: "user",
      targetId: user.id,
      targetName: user.email,
      result: "SUCCESS",
      details: { authSource: "LOCAL", role: user.role },
    });

    res.status(201).json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role });
  });

  router.post("/:id/send-password-reset", requireAuth, requireAdmin, async (req, res) => {
    const admin = req.session.user!;
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user || user.authSource !== "LOCAL") {
      res.status(400).json({ error: "not a local account" });
      return;
    }

    await issuePasswordResetEmail(config, logger, user);

    await recordAuditEvent({
      req,
      actorType: "USER",
      actorId: admin.id,
      actorEmail: admin.email,
      action: "user.password_reset_sent",
      targetType: "user",
      targetId: user.id,
      targetName: user.email,
      result: "SUCCESS",
    });

    res.status(204).send();
  });

  return router;
}
