import pino from "pino";
import type { PdfServiceConfig } from "./config.js";

export function createLogger(config: PdfServiceConfig) {
  return pino({
    level: config.LOG_LEVEL,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
