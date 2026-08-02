import { runCollectorMain } from "./main.js";

runCollectorMain()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`stable-corridor collector failed: ${reason}`);
    process.exitCode = 1;
  });
