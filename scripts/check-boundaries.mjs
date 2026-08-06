import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = join(repositoryRoot, "src");
const forbiddenDirectory = join(sourceRoot, "execution");
const forbiddenReferences = [
  "reverse-copy",
  "/opt/bybit-rev",
  "\\opt\\bybit-rev",
  "stable-corridor-live",
  "advanced-trade-ws-user.coinbase.com",
  "/api/v3/brokerage/orders",
  "X-MBX-APIKEY",
  "/api/v3/order",
  "/api/v3/account",
  "/api/v3/openOrders",
  "/api/v3/userDataStream",
  "/sapi/",
  "wss://stream.bybit.com/v5/private",
  "wss://stream.bybit.com/v5/trade",
  "/v5/order/",
  "/v5/account/",
  "/v5/asset/withdraw/",
  "wss://ws-auth.kraken.com",
  "/0/private/",
  "\"API-Key\"",
  "\"API-Sign\"",
  "/swap/v2/execute",
  "sendTransaction(",
  "signTransaction("
];
const allowedDependencies = new Set(["zod"]);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

const failures = [];

if (await exists(forbiddenDirectory)) {
  failures.push("src/execution must not exist during Stage A/B");
}

const packageJson = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8")
);
const productionDependencies = Object.keys(packageJson.dependencies ?? {});

for (const dependency of productionDependencies) {
  if (!allowedDependencies.has(dependency)) {
    failures.push(`production dependency is not allowlisted: ${dependency}`);
  }
}

for (const file of await walkFiles(sourceRoot)) {
  if (!file.endsWith(".ts")) {
    continue;
  }

  const contents = await readFile(file, "utf8");
  for (const forbiddenReference of forbiddenReferences) {
    if (contents.includes(forbiddenReference)) {
      failures.push(
        `${relative(repositoryRoot, file).split(sep).join("/")}: forbidden reference ${forbiddenReference}`
      );
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Repository boundaries are intact.");
}
