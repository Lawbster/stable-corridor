import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseCollectorConfig } from "./config.js";
import { PublicCollectorRunner } from "./runtime/runner.js";

const MAX_CONFIG_BYTES = 1024 * 1024;

export async function runCollectorMain(
  arguments_: readonly string[] = process.argv.slice(2)
): Promise<number> {
  if (arguments_.length !== 1) {
    throw new Error(
      "Usage: node dist/collector/main.js <absolute-config-path>"
    );
  }
  const configPath = resolve(arguments_[0]!);
  const information = await stat(configPath);
  if (!information.isFile() || information.size > MAX_CONFIG_BYTES) {
    throw new Error("Collector configuration is missing or too large");
  }
  const config = parseCollectorConfig(
    JSON.parse(await readFile(configPath, "utf8"))
  );
  const commitSha = process.env.STABLE_CORRIDOR_COMMIT_SHA;
  const runner = new PublicCollectorRunner({
    config,
    ...(commitSha === undefined ? {} : { commitSha })
  });
  let signalHandled = false;
  const handleSignal = (signal: NodeJS.Signals): void => {
    if (signalHandled) {
      return;
    }
    signalHandled = true;
    void runner.stop(`signal_${signal.toLowerCase()}`, 0);
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  try {
    await runner.start();
    await runner.wait();
    return runner.exitCode;
  } finally {
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  runCollectorMain()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`stable-corridor collector failed: ${reason}`);
      process.exitCode = 1;
    });
}
