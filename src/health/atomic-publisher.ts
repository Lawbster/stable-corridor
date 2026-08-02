import { collectorHealthSchema, type CollectorHealth } from "./schema.js";
import { writeFileAtomic } from "../collector/filesystem/atomic-write.js";
import { canonicalJsonLine } from "../collector/serialization.js";

export type HealthPublishResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: Error };

export async function publishCollectorHealthAtomic(
  targetPath: string,
  health: CollectorHealth
): Promise<void> {
  const validated = collectorHealthSchema.parse(health);
  await writeFileAtomic(targetPath, canonicalJsonLine(validated));
}

export async function tryPublishCollectorHealthAtomic(
  targetPath: string,
  health: CollectorHealth
): Promise<HealthPublishResult> {
  try {
    await publishCollectorHealthAtomic(targetPath, health);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
