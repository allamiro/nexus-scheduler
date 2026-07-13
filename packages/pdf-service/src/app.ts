import express, { type Express } from "express";
import { renderRunReportPdf, renderUsageReportPdf } from "@nexus-scheduler/pdf";
import { pinoHttp } from "pino-http";
import type { Logger } from "./logger.js";
import type { Metrics } from "./metrics.js";
import { runReportRequestSchema, usageReportRequestSchema } from "./schemas.js";

// Isolated PDF-rendering component (REQUIREMENTS §2.5's recommended
// architecture — its own pod, no network egress via NetworkPolicy,
// independent crash-restart from the API/Worker it serves). Reachable
// only from inside the cluster (ClusterIP Service, no Ingress), and
// unauthenticated by design: the only two callers are the API and
// Worker, both already inside the same trust boundary, and adding
// session/API-key auth here would just mean re-deriving a second copy
// of that trust boundary. NetworkPolicy is what actually enforces "only
// API/Worker can reach this," not anything in this app layer.
export function createApp(logger: Logger, metrics: Metrics): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" })); // run output can be a large agent transcript
  app.use(pinoHttp({ logger }));

  app.get("/healthz", (_req, res) => res.status(200).send("ok"));
  app.get("/readyz", (_req, res) => res.status(200).send("ok"));

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", metrics.register.contentType);
    res.send(await metrics.register.metrics());
  });

  app.post("/render/run-report", async (req, res) => {
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
  });

  app.post("/render/usage-report", async (req, res) => {
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
  });

  return app;
}
