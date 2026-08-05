import { resolve } from "node:path";

import {
  applyJournalSourceReclamationPlan,
  writeJournalSourceReclamationPlan
} from "./journal/reclamation.js";

interface ReclamationArguments {
  readonly dataRoot: string;
  readonly planPath: string;
  readonly maxParts?: number;
  readonly apply: boolean;
  readonly confirmPlanSha256?: string;
}

function usage(): string {
  return (
    "Usage: node dist/collector/reclaim-entrypoint.js " +
    "--data-root <absolute-path> --plan <absolute-path> " +
    "[--max-parts <count>] " +
    "[--apply --confirm-plan-sha256 <sha256>]"
  );
}

function parseArguments(arguments_: readonly string[]): ReclamationArguments {
  let dataRoot: string | undefined;
  let planPath: string | undefined;
  let maxParts: number | undefined;
  let apply = false;
  let confirmPlanSha256: string | undefined;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--data-root" && value !== undefined) {
      dataRoot = resolve(value);
      index += 1;
    } else if (argument === "--plan" && value !== undefined) {
      planPath = resolve(value);
      index += 1;
    } else if (argument === "--max-parts" && value !== undefined) {
      maxParts = Number(value);
      index += 1;
    } else if (argument === "--apply") {
      apply = true;
    } else if (
      argument === "--confirm-plan-sha256" &&
      value !== undefined
    ) {
      confirmPlanSha256 = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  if (dataRoot === undefined || planPath === undefined) {
    throw new Error(usage());
  }
  if (apply && confirmPlanSha256 === undefined) {
    throw new Error(
      "--apply requires --confirm-plan-sha256 <sha256>"
    );
  }
  if (!apply && confirmPlanSha256 !== undefined) {
    throw new Error(
      "--confirm-plan-sha256 is valid only together with --apply"
    );
  }
  if (apply && maxParts !== undefined) {
    throw new Error(
      "--max-parts creates a plan and cannot be used with --apply"
    );
  }
  return {
    dataRoot,
    planPath,
    ...(maxParts === undefined ? {} : { maxParts }),
    apply,
    ...(confirmPlanSha256 === undefined
      ? {}
      : { confirmPlanSha256 })
  };
}

const arguments_ = parseArguments(process.argv.slice(2));
const onProgress = (message: string): void => console.error(message);

if (arguments_.apply) {
  const result = await applyJournalSourceReclamationPlan({
    dataRoot: arguments_.dataRoot,
    planPath: arguments_.planPath,
    confirmPlanSha256: arguments_.confirmPlanSha256!,
    onProgress
  });
  console.log(JSON.stringify({ mode: "apply", ...result }));
} else {
  const plan = await writeJournalSourceReclamationPlan({
    dataRoot: arguments_.dataRoot,
    planPath: arguments_.planPath,
    ...(arguments_.maxParts === undefined
      ? {}
      : { maxParts: arguments_.maxParts }),
    onProgress
  });
  console.log(
    JSON.stringify({
      mode: "plan",
      planPath: arguments_.planPath,
      planSha256: plan.planSha256,
      plannedParts: plan.entryCount,
      sourceBytes: plan.totalSourceBytes,
      compressedBytes: plan.totalCompressedBytes
    })
  );
}
