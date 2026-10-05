import { defineConfig } from "vitest/config";

// Emulator-backed integration tests (see package.json → test:integration).
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 60000,
    fileParallelism: false,
    env: {
      GCLOUD_PROJECT: "demo-zarin",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      INTEGRATION_SECRET: "local-dev-secret",
      N8N_WEBHOOK_URL: "",
      AI_MODEL: "claude-opus-5-5",
    },
  },
});
