import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMetricsApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createMetrics } from "./metrics.js";

let server: Server | undefined;

function listen(app: ReturnType<typeof createMetricsApp>): Promise<string> {
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("dedicated metrics listener (PDF_SERVICE_METRICS_PORT)", () => {
  it("serves the shared register on /metrics", async () => {
    const metrics = createMetrics();
    metrics.renderTotal.inc({ template: "run-report", result: "success" });
    const base = await listen(createMetricsApp(metrics));

    const res = await fetch(`${base}/metrics`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain(
      'nexus_scheduler_pdf_renders_total{template="run-report",result="success"} 1',
    );
  });

  it("exposes no render capability — the whole point of the split port", async () => {
    const base = await listen(createMetricsApp(createMetrics()));

    for (const path of ["/render/run-report", "/render/usage-report"]) {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(404);
    }
  });
});

describe("PDF_SERVICE_METRICS_PORT config", () => {
  it("is off unless set, and coerces the env string when set", () => {
    expect(loadConfig({}).PDF_SERVICE_METRICS_PORT).toBeUndefined();
    expect(
      loadConfig({ PDF_SERVICE_METRICS_PORT: "9464" }).PDF_SERVICE_METRICS_PORT,
    ).toBe(9464);
  });
});
