import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// CI sets SOUNDBOX_TEST_REPORT to get report files next to the console output:
// JUnit XML and the HTML report are uploaded as an artifact, and the JSON feeds
// the run summary (scripts/test-summary.mjs). `github-actions` is listed by
// hand because naming any reporter drops the one Vitest adds on its own.
// Locally, nothing changes.
const report = !!process.env.SOUNDBOX_TEST_REPORT;

export default defineConfig({
  // test/devices.test.ts loads the app's device table to check the server's
  // copy against it; the app's modules import each other through "@/".
  resolve: {
    alias: { "@": fileURLToPath(new URL("../app/src", import.meta.url)) },
  },
  test: {
    reporters: report ? ["default", "github-actions", "junit", "json", "html"] : ["default"],
    outputFile: {
      junit: "test-results/junit.xml",
      json: "test-results/results.json",
      html: "test-results/html/index.html",
    },
  },
});
