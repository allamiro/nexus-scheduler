import { z } from "zod";

// Admin-editable branding (§5) and the system-wide classification
// banner (§6) — one settings surface, two independent concerns living
// in it (the banner is never derived from anything else, per §6).
// SMTP (§5) lives here too, for the same reason: one system-settings
// singleton rather than scattering admin config across tables.
export const updateAppSettingsSchema = z.object({
  productName: z.string().min(1).max(100).optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().min(1).optional(),
  classificationBannerText: z.string().min(1).max(200).optional(),
  classificationBannerBgColor: z.string().min(1).optional(),
  classificationBannerTextColor: z.string().min(1).optional(),
  smtpHost: z.string().min(1).nullable().optional(),
  smtpPort: z.number().int().positive().nullable().optional(),
  smtpSecure: z.boolean().optional(),
  smtpUsername: z.string().nullable().optional(),
  // Omitted entirely = leave the stored password unchanged; empty string
  // = clear it. Never returned by any GET, so "leave unchanged" has to
  // be expressible as "field not present" rather than "matches current".
  smtpPassword: z.string().optional(),
  smtpFromAddress: z.string().email().nullable().optional(),
});
export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;
