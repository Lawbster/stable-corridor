import { z } from "zod";

const atomicAmountSchema = z.string().regex(/^[1-9]\d*$/u);
const mintSchema = z.string().min(32).max(128);

const swapInfoSchema = z.object({
  ammKey: z.string().min(1).max(128),
  label: z.string().min(1).max(128),
  inputMint: mintSchema,
  outputMint: mintSchema,
  inAmount: atomicAmountSchema,
  outAmount: atomicAmountSchema
});

export const jupiterRouteLegSchema = z.object({
  percent: z.number().int().positive().max(100),
  bps: z.number().int().positive().max(10_000),
  swapInfo: swapInfoSchema
});

export const jupiterOrderQuoteSchema = z.object({
  inputMint: mintSchema,
  outputMint: mintSchema,
  inAmount: atomicAmountSchema,
  outAmount: atomicAmountSchema,
  otherAmountThreshold: atomicAmountSchema,
  swapMode: z.literal("ExactIn"),
  slippageBps: z.number().int().nonnegative(),
  priceImpactPct: z.string().regex(/^-?\d+(?:\.\d+)?$/u),
  routePlan: z.array(jupiterRouteLegSchema).min(1).max(32),
  feeBps: z.number().int().nonnegative(),
  transaction: z.null(),
  gasless: z.boolean(),
  signatureFeeLamports: z.number().int().nonnegative(),
  prioritizationFeeLamports: z.number().int().nonnegative(),
  rentFeeLamports: z.number().int().nonnegative(),
  requestId: z.string().min(1).max(256),
  swapType: z.string().min(1).max(128),
  router: z.string().min(1).max(128),
  guaranteedPrice: z.boolean(),
  quoteId: z.string().min(1).max(256).nullable().optional(),
  taker: z.null(),
  platformFee: z.object({
    feeBps: z.number().int().nonnegative()
  }),
  totalTime: z.number().finite().nonnegative()
});

export type JupiterOrderQuote = z.infer<
  typeof jupiterOrderQuoteSchema
>;

export function parseJupiterOrderQuote(input: unknown): JupiterOrderQuote {
  return jupiterOrderQuoteSchema.parse(input);
}

