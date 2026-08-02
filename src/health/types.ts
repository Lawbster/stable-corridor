import type { z } from "zod";

import { feedHealthSchema } from "./schema.js";

export type FeedHealth = z.infer<typeof feedHealthSchema>;
