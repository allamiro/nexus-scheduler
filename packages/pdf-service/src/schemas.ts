import { z } from "zod";

// Mirrors packages/pdf/src/templates/banner.ts's ClassificationBannerInfo
// and templates/{runReport,usageReport}.ts's data interfaces exactly.
// Runtime-validated at this HTTP boundary even though every caller is
// internal (API/Worker) — the request body crossing a process boundary
// is reason enough on its own, isolation from the callers' own type
// safety notwithstanding.
const bannerSchema = z.object({
  text: z.string(),
  backgroundColor: z.string(),
  textColor: z.string(),
});

export const runReportRequestSchema = z.object({
  productName: z.string(),
  primaryColor: z.string(),
  banner: bannerSchema,
  classification: z
    .object({
      text: z.string(),
      badgeBgColor: z.string(),
      badgeTextColor: z.string(),
    })
    .nullable(),
  jobName: z.string(),
  runId: z.string(),
  triggerType: z.string(),
  status: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  promptTokens: z.number().nullable(),
  completionTokens: z.number().nullable(),
  computedCost: z.string().nullable(),
  output: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

const runStatusSchema = z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED", "CANCELLED", "SKIPPED"]);

export const usageReportRequestSchema = z.object({
  productName: z.string(),
  primaryColor: z.string(),
  banner: bannerSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  generatedAt: z.string(),
  runCounts: z.record(runStatusSchema, z.number()),
  totalPromptTokens: z.number(),
  totalCompletionTokens: z.number(),
  totalCost: z.string().nullable(),
});
