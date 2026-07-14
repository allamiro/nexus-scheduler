import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // access.test.ts, audit.test.ts and routes.integration.test.ts all
    // reset the *entire* shared test Postgres database in their own
    // beforeEach — running test files concurrently races one file's reset
    // against another's in-progress fixture setup (FK violations / rows
    // wiped out from under an assertion). These are integration tests
    // against one real database, not isolated units, so serialize them —
    // same posture as packages/worker/vitest.config.ts.
    fileParallelism: false,
  },
});
