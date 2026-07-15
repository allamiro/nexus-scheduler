import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "json-summary"],
      // Modest floor a few points under today's numbers (34% lines,
      // 73% branches, 62% functions — issue #52): catches a large
      // untested addition without blocking normal work. Ratchet these
      // up as coverage grows; never down.
      thresholds: {
        lines: 30,
        functions: 55,
        branches: 65,
        statements: 30,
      },
    },
  },
});
