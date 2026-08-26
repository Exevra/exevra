import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  reporter: [["list"], ["junit", { outputFile: "artifacts/junit.xml" }]],
});
