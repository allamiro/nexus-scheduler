import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";
import { recordAuditEvent } from "../audit.js";

const createLabelSchema = z.object({
  text: z.string().min(1).max(100),
  abbreviation: z.string().max(20).optional(),
  badgeBgColor: z.string().min(1),
  badgeTextColor: z.string().min(1),
  sortOrder: z.number().int().default(0),
  isDefault: z.boolean().default(false),
});

// Object-level classification labels (REQUIREMENTS.md §6) — an
// admin-editable taxonomy, deliberately independent of the system-wide
// classification banner, which isn't app-managed data at all.
export function createClassificationLabelsRouter(): Router {
  const router = Router();

  router.get("/", requireAuth, async (_req, res) => {
    const labels = await prisma.classificationLabel.findMany({ orderBy: { sortOrder: "asc" } });
    res.json(labels);
  });

  router.post("/", requireAuth, requireAdmin, async (req, res) => {
    const parsed = createLabelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const user = req.session.user!;

    if (parsed.data.isDefault) {
      await prisma.classificationLabel.updateMany({ data: { isDefault: false }, where: {} });
    }
    const label = await prisma.classificationLabel.create({ data: parsed.data });

    await recordAuditEvent({
      req,
      actorType: "USER",
      actorId: user.id,
      actorEmail: user.email,
      action: "classification_label.create",
      targetType: "classification_label",
      targetId: label.id,
      targetName: label.text,
      result: "SUCCESS",
    });

    res.status(201).json(label);
  });

  return router;
}
