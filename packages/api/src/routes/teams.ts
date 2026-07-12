import { Router } from "express";
import { createTeamSchema, updateTeamSchema, addTeamMemberSchema } from "@nexus-scheduler/shared";
import { prisma } from "../db.js";
import { requireAuth, requireEditor } from "../middleware/requireAuth.js";
import { recordAuditEvent } from "../audit.js";

// Teams are local-only, UI-managed groups used purely as a Project ACL
// sharing target (REQUIREMENTS.md §2.3/§4) — not sourced from Keycloak,
// not tied to roles/permissions.
export function createTeamsRouter(): Router {
  const router = Router();

  router.get("/", requireAuth, async (_req, res) => {
    const teams = await prisma.team.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { memberships: true, subTeams: true } } },
    });
    res.json(teams);
  });

  router.get("/:id", requireAuth, async (req, res) => {
    const team = await prisma.team.findUnique({
      where: { id: req.params.id },
      include: {
        memberships: { include: { user: { select: { id: true, email: true, displayName: true } } } },
        subTeams: { select: { id: true, name: true } },
        parentTeam: { select: { id: true, name: true } },
      },
    });
    if (!team) {
      res.status(404).json({ error: "team not found" });
      return;
    }
    res.json(team);
  });

  router.post("/", requireAuth, requireEditor, async (req, res) => {
    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const user = req.session.user!;

    if (parsed.data.parentTeamId) {
      const parent = await prisma.team.findUnique({ where: { id: parsed.data.parentTeamId } });
      if (!parent) {
        res.status(400).json({ error: "parentTeamId does not exist" });
        return;
      }
    }

    const team = await prisma.team.create({ data: parsed.data });

    await recordAuditEvent({
      req,
      actorType: "USER",
      actorId: user.id,
      actorEmail: user.email,
      action: "team.create",
      targetType: "team",
      targetId: team.id,
      targetName: team.name,
      result: "SUCCESS",
    });

    res.status(201).json(team);
  });

  router.patch("/:id", requireAuth, requireEditor, async (req, res) => {
    const parsed = updateTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const user = req.session.user!;

    if (parsed.data.parentTeamId === req.params.id) {
      res.status(400).json({ error: "a team cannot be its own parent" });
      return;
    }

    const team = await prisma.team.update({ where: { id: req.params.id }, data: parsed.data });

    await recordAuditEvent({
      req,
      actorType: "USER",
      actorId: user.id,
      actorEmail: user.email,
      action: "team.update",
      targetType: "team",
      targetId: team.id,
      targetName: team.name,
      result: "SUCCESS",
    });

    res.json(team);
  });

  router.delete("/:id", requireAuth, requireEditor, async (req, res) => {
    const user = req.session.user!;
    const [subTeamCount, aclCount] = await Promise.all([
      prisma.team.count({ where: { parentTeamId: req.params.id } }),
      prisma.projectAcl.count({ where: { granteeTeamId: req.params.id } }),
    ]);
    if (subTeamCount > 0 || aclCount > 0) {
      res.status(409).json({
        error: "team has sub-teams or Project shares referencing it — reassign those first",
      });
      return;
    }

    const team = await prisma.team.delete({ where: { id: req.params.id } });

    await recordAuditEvent({
      req,
      actorType: "USER",
      actorId: user.id,
      actorEmail: user.email,
      action: "team.delete",
      targetType: "team",
      targetId: team.id,
      targetName: team.name,
      result: "SUCCESS",
    });

    res.status(204).send();
  });

  router.post("/:id/members", requireAuth, requireEditor, async (req, res) => {
    const parsed = addTeamMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const user = req.session.user!;

    const membership = await prisma.teamMembership.upsert({
      where: { teamId_userId: { teamId: req.params.id!, userId: parsed.data.userId } },
      create: { teamId: req.params.id!, userId: parsed.data.userId },
      update: {},
    });

    await recordAuditEvent({
      req,
      actorType: "USER",
      actorId: user.id,
      actorEmail: user.email,
      action: "team.membership.add",
      targetType: "team",
      targetId: req.params.id,
      result: "SUCCESS",
      details: { addedUserId: parsed.data.userId },
    });

    res.status(201).json(membership);
  });

  router.delete("/:id/members/:userId", requireAuth, requireEditor, async (req, res) => {
    const user = req.session.user!;
    await prisma.teamMembership.delete({
      where: { teamId_userId: { teamId: req.params.id!, userId: req.params.userId! } },
    });

    await recordAuditEvent({
      req,
      actorType: "USER",
      actorId: user.id,
      actorEmail: user.email,
      action: "team.membership.remove",
      targetType: "team",
      targetId: req.params.id,
      result: "SUCCESS",
      details: { removedUserId: req.params.userId },
    });

    res.status(204).send();
  });

  return router;
}
