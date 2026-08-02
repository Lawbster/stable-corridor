import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false
        }
      },
      {
        test: {
          name: "replay",
          environment: "node",
          include: ["tests/replay/**/*.test.ts"],
          fileParallelism: false
        }
      }
    ]
  }
});
