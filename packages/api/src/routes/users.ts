import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

// Minimal read-only listing to back the user-picker used when adding
// Team members or granting a Project ACL to a specific user. Full user
// administration (deactivation, role changes) is an Admin-page concern
// that doesn't exist yet.
export function createUsersRouter(): Router {
  const router = Router();

  router.get("/", requireAuth, async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const users = await prisma.user.findMany({
      where: search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { displayName: { contains: search, mode: "insensitive" } },
            ],
          }
        : undefined,
      select: { id: true, email: true, displayName: true, role: true, active: true },
      take: 25,
      orderBy: { email: "asc" },
    });
    res.json(users);
  });

  return router;
}
