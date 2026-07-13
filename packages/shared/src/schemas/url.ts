import { z } from "zod";

// z.string().url() alone accepts javascript:/data:/file: URLs too — a
// false sense of safety for fields that get emitted into markup
// (logoUrl, a stored-XSS vector depending on render context) or serve
// as an SSRF/exfiltration allow-list entry (webhook destination url).
// Restricting to http(s) closes both off at the schema level.
export const httpUrlSchema = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: "must be an http:// or https:// URL" });
