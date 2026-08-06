import {
  JUPITER_ASSETS,
  type JupiterQuoteRequest
} from "../../src/venues/jupiter/constants.js";

export function makeJupiterOrderQuote(
  request: JupiterQuoteRequest,
  overrides: {
    readonly outAmount?: string;
    readonly requestId?: string;
    readonly priceImpactPct?: string;
    readonly routePlan?: readonly Record<string, unknown>[];
  } = {}
): Record<string, unknown> {
  const outputMint = JUPITER_ASSETS[request.outputAsset].mint;
  const inputMint = JUPITER_ASSETS[request.inputAsset].mint;
  const outAmount = overrides.outAmount ?? "865000000";
  return {
    inputMint,
    outputMint,
    inAmount: request.inputAmountAtomic,
    outAmount,
    otherAmountThreshold: outAmount,
    swapMode: "ExactIn",
    slippageBps: 0,
    priceImpactPct: overrides.priceImpactPct ?? "-0.00001",
    routePlan:
      overrides.routePlan ??
      [
        {
          percent: 100,
          bps: 10_000,
          usdValue: 1_000,
          swapInfo: {
            ammKey: "test-amm",
            label: "JupiterZ",
            inputMint,
            outputMint,
            inAmount: request.inputAmountAtomic,
            outAmount
          }
        }
      ],
    feeMint: inputMint,
    feeBps: 0,
    transaction: null,
    gasless: true,
    jitOptimized: false,
    signatureFeeLamports: 0,
    signatureFeePayer: null,
    prioritizationFeeLamports: 0,
    prioritizationFeePayer: null,
    rentFeeLamports: 0,
    rentFeePayer: null,
    requestId:
      overrides.requestId ?? "11111111-1111-4111-8111-111111111111",
    swapType: "rfq",
    router: "jupiterz",
    guaranteedPrice: true,
    quoteId: "22222222-2222-4222-8222-222222222222",
    maker: "test-amm",
    taker: null,
    platformFee: {
      feeBps: 0,
      feeMint: inputMint
    },
    inUsdValue: 1_000,
    outUsdValue: 1_000,
    swapUsdValue: 1_000,
    priceImpact: -0.001,
    mode: "ultra",
    totalTime: 50
  };
}
