import { Registry, collectDefaultMetrics, Counter, Histogram } from "prom-client";

export function createMetrics() {
  const register = new Registry();
  collectDefaultMetrics({ register });

  const renderDuration = new Histogram({
    name: "nexus_scheduler_pdf_render_duration_seconds",
    help: "Duration of a single PDF render (Chromium launch through page.pdf())",
    labelNames: ["template", "result"] as const,
    buckets: [0.25, 0.5, 1, 2, 5, 10, 20],
    registers: [register],
  });

  const renderTotal = new Counter({
    name: "nexus_scheduler_pdf_renders_total",
    help: "Total PDF render requests, by template and outcome",
    labelNames: ["template", "result"] as const,
    registers: [register],
  });

  return { register, renderDuration, renderTotal };
}

export type Metrics = ReturnType<typeof createMetrics>;
