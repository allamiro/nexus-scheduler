import type { Request } from "express";
import "express-session";
import type { RoleName } from "@nexus-scheduler/shared";

// Augments express-session's SessionData with the fields Nexus Scheduler
// actually needs post-login. Kept minimal — anything else about the user
// is looked up from Postgres by id, not cached in the session.
declare module "express-session" {
  interface SessionData {
    user?: {
      id: string;
      email: string;
      displayName: string | null;
      role: RoleName;
      authSource: "OIDC" | "LOCAL";
    };
    oidc?: {
      state: string;
      nonce: string;
      codeVerifier: string;
      returnTo?: string;
    };
  }
}

// Rotates the session id at the moment a session is elevated to
// authenticated, so a session id an attacker fixed on a victim before
// login (cookie injection, shared subdomain) can't be reused afterward —
// wraps express-session's callback-based regenerate() in a Promise.
export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
