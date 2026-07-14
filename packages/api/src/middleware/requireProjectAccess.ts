import type { NextFunction, Request, Response } from "express";
import { getProjectAccess, type ProjectAccessLevel } from "../access.js";
import { asyncHandler } from "./asyncHandler.js";

declare module "express-serve-static-core" {
  interface Request {
    projectAccess?: ProjectAccessLevel;
  }
}

const RANK: Record<Exclude<ProjectAccessLevel, null>, number> = { READ: 1, EDIT: 2, OWNER: 3 };

// Attaches req.projectAccess and 403s if it doesn't meet `minLevel`.
// Expects the Project id at req.params.id (or req.params.projectId for
// nested routes like /projects/:projectId/acl).
export function requireProjectAccess(minLevel: "READ" | "EDIT" | "OWNER") {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const projectId = req.params.projectId ?? req.params.id;
    if (!projectId) {
      res.status(400).json({ error: "project id missing from route" });
      return;
    }

    const access = await getProjectAccess(user.id, projectId);
    // Admins can always reach a Project regardless of ACLs — consistent
    // with the admin role's "manage system configuration" scope (§4).
    const effective = user.role === "ADMIN" ? "OWNER" : access;

    if (!effective || RANK[effective] < RANK[minLevel]) {
      res.status(access === null ? 404 : 403).json({ error: "insufficient project access" });
      return;
    }
    req.projectAccess = effective;
    next();
  });
}
