import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const roots = ["src", "tests", "scripts", "config"];
const rootFiles = [
  "package.json",
  "package-lock.json",
  "ecosystem.config.cjs",
  "tsconfig.json",
  "tsconfig.build.json",
  "vitest.config.ts"
];
const checkedExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".jsonl",
  ".mjs",
  ".ts",
  ".yaml",
  ".yml"
]);

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".gitkeep") {
      continue;
    }

    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)));
    } else if (entry.isFile() && checkedExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

const files = rootFiles.map((file) => join(repositoryRoot, file));
for (const root of roots) {
  files.push(...(await walkFiles(join(repositoryRoot, root))));
}

const failures = [];

for (const file of files) {
  const contents = await readFile(file, "utf8");
  const displayPath = relative(repositoryRoot, file).split(sep).join("/");

  if (contents.includes("\r")) {
    failures.push(`${displayPath}: contains CRLF or bare CR characters`);
  }
  if (!contents.endsWith("\n")) {
    failures.push(`${displayPath}: missing final newline`);
  }

  const lines = contents.split("\n");
  lines.forEach((line, index) => {
    if (/[ \t]+$/u.test(line)) {
      failures.push(`${displayPath}:${index + 1}: trailing whitespace`);
    }
    if (line.includes("\t")) {
      failures.push(`${displayPath}:${index + 1}: tab character`);
    }
  });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Formatting checks passed for ${files.length} files.`);
}
