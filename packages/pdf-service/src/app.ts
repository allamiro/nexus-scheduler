import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { renderRunReportPdf, renderUsageReportPdf } from "@nexus-scheduler/pdf";
import { pinoHttp } from "pino-http";
import type { PdfServiceConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { Metrics } from "./metrics.js";
import { runReportRequestSchema, usageReportRequestSchema } from "./schemas.js";

const REQUEST_TIMEOUT_MS = 35_000; // slightly above renderer.ts's own per-render timeout

// Express 4 doesn't forward a rejected async handler's promise to `next`,
// so an unexpected error here would otherwise become an unhandled
// rejection instead of reaching the error-handling middleware above.
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// Isolated PDF-rendering component (REQUIREMENTS §2.5's recommended
// architecture — its own pod, no network egress via NetworkPolicy,
// independent crash-restart from the API/Worker it serves). Reachable
// only from inside the cluster (ClusterIP Service, no Ingress). Primary
// access control is NetworkPolicy, not session/API-key auth — the only
// two callers (API, Worker) are already inside the same trust boundary,
// so a second copy of that boundary here wouldn't add much. The optional
// PDF_SERVICE_SHARED_SECRET check below is defense-in-depth on top of
// that, for the case reachability alone (a NetworkPolicy misconfig, a
// compromised pod on the same network) isn't sufficient.
export function createApp(config: PdfServiceConfig, logger: Logger, metrics: Metrics): Express {
  const app = express();
  app.use((req, res, next) => {
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      if (!res.headersSent) {
        res.status(503).json({ error: "render timed out" });
      }
    });
    next();
  });
  app.use(express.json({ limit: "10mb" })); // run output can be a large agent transcript
  // express.json() throws a SyntaxError on malformed/oversized bodies
  // *before* any route handler runs; with no error-handling middleware
  // that reached Express's default handler, which serializes err.stack
  // into the response whenever NODE_ENV !== "production" — this app's
  // own config defaults NODE_ENV to "development", so that was the
  // common case, not an edge case. Every error past this point returns a
  // plain JSON body and never echoes err.stack, in production or not.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(err instanceof Error)) {
      next(err);
      return;
    }
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "malformed request body" });
      return;
    }
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: "internal error" });
  });
  app.use(pinoHttp({ logger }));

  if (config.PDF_SERVICE_SHARED_SECRET) {
    app.use((req, res, next) => {
      if (req.path === "/healthz" || req.path === "/readyz" || req.path === "/metrics") {
        next();
        return;
      }
      if (req.get("X-Internal-Auth") !== config.PDF_SERVICE_SHARED_SECRET) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      next();
    });
  }

  app.get("/healthz", (_req, res) => res.status(200).send("ok"));
  app.get("/readyz", (_req, res) => res.status(200).send("ok"));

  app.get("/metrics", asyncHandler(async (_req, res) => {
    res.setHeader("Content-Type", metrics.register.contentType);
    res.send(await metrics.register.metrics());
  }));

  app.post("/render/run-report", asyncHandler(async (req, res) => {
    const parsed = runReportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const stopTimer = metrics.renderDuration.startTimer({ template: "run-report" });
    try {
      const pdf = await renderRunReportPdf(parsed.data);
      stopTimer({ result: "success" });
      metrics.renderTotal.inc({ template: "run-report", result: "success" });
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdf);
    } catch (err) {
      stopTimer({ result: "failure" });
      metrics.renderTotal.inc({ template: "run-report", result: "failure" });
      logger.error({ err }, "run-report render failed");
      res.status(502).json({ error: "PDF render failed" });
    }
  }));

  app.post("/render/usage-report", asyncHandler(async (req, res) => {
    const parsed = usageReportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const stopTimer = metrics.renderDuration.startTimer({ template: "usage-report" });
    try {
      const pdf = await renderUsageReportPdf(parsed.data);
      stopTimer({ result: "success" });
      metrics.renderTotal.inc({ template: "usage-report", result: "success" });
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdf);
    } catch (err) {
      stopTimer({ result: "failure" });
      metrics.renderTotal.inc({ template: "usage-report", result: "failure" });
      logger.error({ err }, "usage-report render failed");
      res.status(502).json({ error: "PDF render failed" });
    }
  }));

  return app;
}

// The scrape-only counterpart to createApp, for PDF_SERVICE_METRICS_PORT
// (issue #118): in Kubernetes, /metrics on the render port is
// unreachable by design — the NetworkPolicy admits only api/worker, and
// being L3/L4 it could not admit a scraper without also admitting it to
// POST /render/*. A listener that cannot render, on its own port, is
// something a NetworkPolicy *can* reason about, so the chart opens this
// port to the configured scraper and nothing else. No shared-secret
// check here: the register holds operational counters, and the secret
// exists to guard the render capability, not them.
export function createMetricsApp(metrics: Metrics): Express {
  const app = express();
  app.get("/metrics", asyncHandler(async (_req, res) => {
    res.setHeader("Content-Type", metrics.register.contentType);
    res.send(await metrics.register.metrics());
  }));
  return app;
}
