export const JUPITER_SWAP_V2_ORDER_URL =
  "https://api.jup.ag/swap/v2/order";

export const JUPITER_PUBLIC_PRODUCT = "EURC-USDC";

export const JUPITER_ASSETS = {
  EURC: {
    mint: "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
    decimals: 6
  },
  USDC: {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6
  }
} as const;

export const JUPITER_APPROVED_INPUT_AMOUNTS = [
  "1000",
  "10000"
] as const;

export type JupiterAsset = keyof typeof JUPITER_ASSETS;
export type JupiterApprovedInputAmount =
  (typeof JUPITER_APPROVED_INPUT_AMOUNTS)[number];

export interface JupiterQuoteRequest {
  readonly inputAsset: JupiterAsset;
  readonly outputAsset: JupiterAsset;
  readonly inputAmount: JupiterApprovedInputAmount;
  readonly inputAmountAtomic: string;
}

export function decimalToAtomic(
  amount: JupiterApprovedInputAmount,
  decimals = 6
): string {
  return (BigInt(amount) * 10n ** BigInt(decimals)).toString();
}

export function createJupiterQuoteRequests(
  inputAmounts: readonly JupiterApprovedInputAmount[]
): readonly JupiterQuoteRequest[] {
  return inputAmounts.flatMap((inputAmount) => [
    {
      inputAsset: "USDC",
      outputAsset: "EURC",
      inputAmount,
      inputAmountAtomic: decimalToAtomic(inputAmount)
    },
    {
      inputAsset: "EURC",
      outputAsset: "USDC",
      inputAmount,
      inputAmountAtomic: decimalToAtomic(inputAmount)
    }
  ]);
}

export function jupiterQuoteRequestKey(
  request: JupiterQuoteRequest
): string {
  return (
    `${request.inputAsset}-${request.outputAsset}:` +
    request.inputAmount
  );
}

