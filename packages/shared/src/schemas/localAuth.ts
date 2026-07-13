import { z } from "zod";

// Break-glass local authentication (REQUIREMENTS §4) — SSO/OIDC is the
// standard path; these exist so access never depends entirely on
// Keycloak being reachable.

const PASSWORD_MIN_LENGTH = 12; // local accounts aren't held to SSO's rigor, but this is still a floor

export const localLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LocalLoginInput = z.infer<typeof localLoginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Admin-only: provisions a local account with no password set yet — the
// account holder sets one via the same reset-password flow used for
// "forgot password," which doubles as "set your initial password."
export const createLocalUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(200).optional(),
  role: z.enum(["ADMIN", "EDITOR", "VIEW"]).default("VIEW"),
});
export type CreateLocalUserInput = z.infer<typeof createLocalUserSchema>;

// Admin-only: sets a local account's password directly, in-band, right
// now — the complement to issuePasswordResetEmail's out-of-band emailed
// link, for when SMTP isn't configured (a real possibility in an
// air-gapped deployment) or an admin just wants to hand a user a
// working password immediately rather than waiting on email delivery.
export const adminSetPasswordSchema = z.object({
  newPassword: z.string().min(PASSWORD_MIN_LENGTH),
});
export type AdminSetPasswordInput = z.infer<typeof adminSetPasswordSchema>;
