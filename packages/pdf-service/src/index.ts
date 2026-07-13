import "dotenv/config";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createMetrics } from "./metrics.js";
import { createApp } from "./app.js";

const config = loadConfig();
const logger = createLogger(config);
const metrics = createMetrics();
const app = createApp(logger, metrics);

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "nexus-scheduler pdf-service started");
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down pdf-service");
    server.close(() => process.exit(0));
  });
}
