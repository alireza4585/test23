import { defineConfig } from "vitest/config";

// One seeded PocketBase per run (test/global-setup.mjs); files run in
// sequence because they share that server.
export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
    globalSetup: ["test/global-setup.mjs"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
