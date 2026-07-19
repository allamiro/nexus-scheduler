import "dotenv/config";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createMetrics } from "./metrics.js";
import { createApp, createMetricsApp } from "./app.js";

const config = loadConfig();
const logger = createLogger(config);
const metrics = createMetrics();
const app = createApp(config, logger, metrics);

const servers = [
  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "nexus-scheduler pdf-service started");
  }),
];

if (config.PDF_SERVICE_METRICS_PORT === config.PORT) {
  // A misconfig, not a fatal one: the render listener already serves
  // /metrics on that port, so binding a second listener there would
  // only crash startup with EADDRINUSE.
  logger.error(
    { port: config.PORT },
    "PDF_SERVICE_METRICS_PORT equals PORT — dedicated metrics listener disabled",
  );
} else if (config.PDF_SERVICE_METRICS_PORT) {
  servers.push(
    createMetricsApp(metrics, logger).listen(config.PDF_SERVICE_METRICS_PORT, () => {
      logger.info(
        { port: config.PDF_SERVICE_METRICS_PORT },
        "pdf-service metrics listener started",
      );
    }),
  );
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down pdf-service");
    let open = servers.length;
    for (const server of servers) {
      server.close(() => {
        open--;
        if (open === 0) process.exit(0);
      });
    }
  });
}
