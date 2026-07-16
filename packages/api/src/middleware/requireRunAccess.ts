import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { getProjectAccess, type ProjectAccessLevel } from "../access.js";
import { asyncHandler } from "./asyncHandler.js";
import { routeParam } from "./routeParam.js";

const RANK: Record<Exclude<ProjectAccessLevel, null>, number> = { READ: 1, EDIT: 2, OWNER: 3 };

// A Run's access is inherited from its Job's Project, same chain as
// requireJobAccess/requireScheduleAccess (REQUIREMENTS.md §2.3). Runs
// are created via schedule fire or run-now, never directly through this
// middleware's routes — "READ" covers viewing one, "EDIT" covers the
// one mutation a Run supports directly: cancelling it (issue #111).
export function requireRunAccess(minLevel: "READ" | "EDIT" | "OWNER") {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const runId = routeParam(req, "id");
    if (!runId) {
      res.status(400).json({ error: "run id missing from route" });
      return;
    }

    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: { jobId: true, job: { select: { projectId: true } } },
    });
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }

    const access = await getProjectAccess(user.id, run.job.projectId);
    const effective = user.role === "ADMIN" ? "OWNER" : access;

    if (!effective || RANK[effective] < RANK[minLevel]) {
      res.status(access === null ? 404 : 403).json({ error: "insufficient project access" });
      return;
    }
    req.projectAccess = effective;
    next();
  });
}
