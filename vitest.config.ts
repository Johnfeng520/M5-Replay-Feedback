import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    reporters: ["default", "json"],
    outputFile: { json: ".local/vitest-results.json" },
  },
});
