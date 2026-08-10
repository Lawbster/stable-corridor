import {
  createJupiterQuoteRequests,
  JUPITER_ASSETS,
  JUPITER_SWAP_V2_ORDER_URL,
  type JupiterApprovedInputAmount,
  type JupiterQuoteRequest,
  type JupiterQuoteRequestContext
} from "./constants.js";

export interface JupiterPublicQuoteSessionOptions {
  readonly inputAmounts: readonly JupiterApprovedInputAmount[];
  readonly minimumRequestIntervalMs: number;
  readonly retryDelayMs: number;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly onQuote: (
    request: JupiterQuoteRequest,
    response: unknown,
    requestStartedAtMs: number,
    receivedTimestampMs: number,
    context: JupiterQuoteRequestContext
  ) => void | Promise<void>;
  readonly onFailure: (
    error: Error,
    receivedTimestampMs: number
  ) => void | Promise<void>;
  readonly onClose?: (code: number | undefined, reason: string) => void;
  readonly now?: () => number;
  readonly fetchImplementation?: typeof fetch;
}

export function createJupiterOrderUrl(
  request: JupiterQuoteRequest
): string {
  const url = new URL(JUPITER_SWAP_V2_ORDER_URL);
  url.searchParams.set(
    "inputMint",
    JUPITER_ASSETS[request.inputAsset].mint
  );
  url.searchParams.set(
    "outputMint",
    JUPITER_ASSETS[request.outputAsset].mint
  );
  url.searchParams.set("amount", request.inputAmountAtomic);
  return url.toString();
}

async function responseJsonBounded(
  response: Response,
  maxResponseBytes: number
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number(declaredLength) > maxResponseBytes
  ) {
    throw new Error(
      `Jupiter response exceeded ${maxResponseBytes} bytes`
    );
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > maxResponseBytes) {
    throw new Error(
      `Jupiter response exceeded ${maxResponseBytes} bytes`
    );
  }
  if (!response.ok) {
    throw new Error(
      `Jupiter quote HTTP ${response.status}: ${body.slice(0, 128)}`
    );
  }
  return JSON.parse(body) as unknown;
}

export class JupiterPublicQuoteSession {
  readonly #options: JupiterPublicQuoteSessionOptions;
  readonly #requests: readonly JupiterQuoteRequest[];
  readonly #now: () => number;
  readonly #fetch: typeof fetch;
  readonly #priorityRequests: Array<{
    readonly request: JupiterQuoteRequest;
    readonly context: JupiterQuoteRequestContext;
  }> = [];
  #controller: AbortController | undefined;
  #runPromise: Promise<void> | undefined;
  #baselineIndex = 0;
  #closeCode: number | undefined;
  #closeReason = "";

  constructor(options: JupiterPublicQuoteSessionOptions) {
    if (
      !Number.isSafeInteger(options.minimumRequestIntervalMs) ||
      options.minimumRequestIntervalMs < 2_000
    ) {
      throw new Error(
        "Jupiter minimum request interval must be at least 2000ms"
      );
    }
    if (
      !Number.isSafeInteger(options.maxResponseBytes) ||
      options.maxResponseBytes < 1
    ) {
      throw new Error("Invalid Jupiter max response bytes");
    }
    this.#options = options;
    this.#requests = createJupiterQuoteRequests(options.inputAmounts);
    this.#now = options.now ?? Date.now;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  get started(): boolean {
    return this.#runPromise !== undefined;
  }

  start(): void {
    if (this.#runPromise !== undefined) {
      throw new Error("Jupiter quote session already started");
    }
    this.#controller = new AbortController();
    const signal = this.#controller.signal;
    this.#runPromise = this.#run(signal)
      .catch(async (error: unknown) => {
        if (!signal.aborted) {
          this.#closeCode = 4001;
          this.#closeReason = "transport_failure";
          const failure =
            error instanceof Error ? error : new Error(String(error));
          await Promise.resolve(
            this.#options.onFailure(failure, this.#now())
          ).catch(() => undefined);
        }
      })
      .finally(() => {
        this.#controller = undefined;
        this.#options.onClose?.(this.#closeCode, this.#closeReason);
      });
  }

  async drain(): Promise<void> {
    await this.#runPromise;
  }

  stop(code = 1000, reason = "collector_stop"): void {
    this.#closeCode = code;
    this.#closeReason = reason;
    this.#controller?.abort();
  }

  scheduleAnomalyFollowUps(
    request: JupiterQuoteRequest,
    triggerRequestId: string,
    followUpCount: number
  ): void {
    if (this.#runPromise === undefined || this.#controller?.signal.aborted) {
      throw new Error("Jupiter quote session is not active");
    }
    if (
      triggerRequestId.length < 1 ||
      triggerRequestId.length > 256
    ) {
      throw new Error("Invalid Jupiter anomaly trigger request ID");
    }
    if (
      !Number.isSafeInteger(followUpCount) ||
      followUpCount < 1 ||
      followUpCount > 10
    ) {
      throw new Error("Invalid Jupiter anomaly follow-up count");
    }
    const approved = this.#requests.some(
      (candidate) =>
        candidate.inputAsset === request.inputAsset &&
        candidate.outputAsset === request.outputAsset &&
        candidate.inputAmount === request.inputAmount &&
        candidate.inputAmountAtomic === request.inputAmountAtomic
    );
    if (!approved) {
      throw new Error("Jupiter anomaly follow-up request is not approved");
    }
    if (this.#priorityRequests.length > 0) {
      throw new Error("A Jupiter anomaly follow-up is already scheduled");
    }
    for (let followUpIndex = 1; followUpIndex <= followUpCount; followUpIndex += 1) {
      this.#priorityRequests.push({
        request,
        context: {
          kind: "anomaly_follow_up",
          triggerRequestId,
          followUpIndex
        }
      });
    }
  }

  async #run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const priority = this.#priorityRequests.shift();
      const request =
        priority?.request ?? this.#requests[this.#baselineIndex]!;
      const context = priority?.context ?? ({ kind: "baseline" } as const);
      if (priority === undefined) {
        this.#baselineIndex =
          (this.#baselineIndex + 1) % this.#requests.length;
      }
      const startedAtMs = this.#now();
      try {
        const timeout = AbortSignal.timeout(
          this.#options.requestTimeoutMs
        );
        const combined = AbortSignal.any([signal, timeout]);
        const response = await this.#fetch(
          createJupiterOrderUrl(request),
          {
            method: "GET",
            headers: { accept: "application/json" },
            signal: combined
          }
        );
        const parsed = await responseJsonBounded(
          response,
          this.#options.maxResponseBytes
        );
        await this.#options.onQuote(
          request,
          parsed,
          startedAtMs,
          this.#now(),
          context
        );
        await this.#delayFrom(
          startedAtMs,
          this.#options.minimumRequestIntervalMs,
          signal
        );
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        const failure =
          error instanceof Error ? error : new Error(String(error));
        await this.#options.onFailure(failure, this.#now());
        await this.#delayFrom(
          startedAtMs,
          Math.max(
            this.#options.retryDelayMs,
            this.#options.minimumRequestIntervalMs
          ),
          signal
        );
      }
    }
  }

  async #delayFrom(
    startedAtMs: number,
    minimumElapsedMs: number,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) {
      return;
    }
    const remaining = Math.max(
      0,
      minimumElapsedMs - (this.#now() - startedAtMs)
    );
    if (remaining === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, remaining);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }
}
