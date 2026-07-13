import type { NextFunction, Request, Response } from "express";
import { getTeamAccess, type TeamAccessLevel } from "../access.js";

declare module "express-serve-static-core" {
  interface Request {
    teamAccess?: TeamAccessLevel;
  }
}

const RANK: Record<Exclude<TeamAccessLevel, null>, number> = { MEMBER: 1, OWNER: 2 };

// Attaches req.teamAccess and 404s if it doesn't meet `minLevel` — 404
// rather than 403 so a non-member can't tell a Team exists at all,
// consistent with "users should only see Teams they belong to." Expects
// the Team id at req.params.id.
export function requireTeamAccess(minLevel: "MEMBER" | "OWNER") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const teamId = req.params.id;
    if (!teamId) {
      res.status(400).json({ error: "team id missing from route" });
      return;
    }

    const access = await getTeamAccess(user.id, teamId);
    // Admins have full control over every Team regardless of membership
    // (REQUIREMENTS §4: admins "manage users, roles, system
    // configuration").
    const effective = user.role === "ADMIN" ? "OWNER" : access;

    if (!effective || RANK[effective] < RANK[minLevel]) {
      res.status(404).json({ error: "team not found" });
      return;
    }
    req.teamAccess = effective;
    next();
  };
}
