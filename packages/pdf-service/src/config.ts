import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // Optional defense-in-depth on top of NetworkPolicy (this service's
  // primary access control) — when set, only requests carrying the same
  // value in X-Internal-Auth are served. Left unset, the service behaves
  // exactly as before; API/Worker only send the header when they're
  // configured with the same value (see their own PDF_SERVICE_SHARED_SECRET).
  PDF_SERVICE_SHARED_SECRET: z.string().optional(),
  // When set, /metrics is additionally served by a dedicated listener on
  // this port so Kubernetes can scrape it without opening the render
  // port: a NetworkPolicy matches on L3/L4 and cannot tell GET /metrics
  // from POST /render/*, so on a shared port the rule that admits
  // Prometheus also admits that namespace to drive Chromium (issue
  // #118). Unset (the default), no second listener starts and nothing
  // changes — the compose stack keeps scraping the main port, which
  // has no NetworkPolicy in front of it.
  PDF_SERVICE_METRICS_PORT: z.coerce.number().int().positive().optional(),
});

export type PdfServiceConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PdfServiceConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
