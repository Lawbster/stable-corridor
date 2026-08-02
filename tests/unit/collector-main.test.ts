import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCollectorMain } from "../../src/collector/main.js";

describe("collector command entrypoint", () => {
  it("rejects startup without exactly one configuration path", async () => {
    await expect(runCollectorMain([])).rejects.toThrow(
      /dist\/collector\/entrypoint\.js.*absolute-config-path/iu
    );
  });

  it("uses the dedicated always-executed entrypoint in package and PM2 scripts", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8")
    ) as { scripts?: Record<string, string> };
    const ecosystem = await readFile(
      resolve("ecosystem.config.cjs"),
      "utf8"
    );

    expect(packageJson.scripts?.["start:collector"]).toBe(
      "node dist/collector/entrypoint.js"
    );
    expect(ecosystem).toContain(
      'script: "dist/collector/entrypoint.js"'
    );
    expect(ecosystem).toContain("autorestart: false");
  });
});
