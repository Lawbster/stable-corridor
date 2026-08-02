import type {
  BinanceDepthSnapshot,
  BinanceDepthUpdate,
  BinanceExchangeInfo,
  BinanceSymbolFilter,
  BinanceTrade
} from "../../src/venues/binance/schemas.js";

const commonOrderTypes = [
  "LIMIT",
  "LIMIT_MAKER",
  "MARKET",
  "STOP_LOSS",
  "STOP_LOSS_LIMIT",
  "TAKE_PROFIT",
  "TAKE_PROFIT_LIMIT"
];

function filters(
  minPrice: string,
  maxPrice: string,
  tickSize: string,
  minQty: string,
  maxQty: string,
  stepSize: string
): BinanceSymbolFilter[] {
  return [
    {
      filterType: "PRICE_FILTER",
      minPrice,
      maxPrice,
      tickSize
    },
    {
      filterType: "LOT_SIZE",
      minQty,
      maxQty,
      stepSize
    },
    {
      filterType: "NOTIONAL",
      minNotional: "5.00000000",
      maxNotional: "9000000.00000000"
    }
  ];
}

export const binanceExchangeInfo: BinanceExchangeInfo = {
  timezone: "UTC",
  serverTime: 1785634718592,
  symbols: [
    {
      symbol: "EURUSDC",
      status: "TRADING",
      baseAsset: "EUR",
      quoteAsset: "USDC",
      orderTypes: commonOrderTypes,
      isSpotTradingAllowed: true,
      filters: filters(
        "0.90000000",
        "1.40000000",
        "0.00010000",
        "0.10000000",
        "6000000.00000000",
        "0.10000000"
      )
    },
    {
      symbol: "EURIUSDC",
      status: "TRADING",
      baseAsset: "EURI",
      quoteAsset: "USDC",
      orderTypes: commonOrderTypes,
      isSpotTradingAllowed: true,
      filters: filters(
        "0.90000000",
        "1.40000000",
        "0.00010000",
        "0.10000000",
        "6000000.00000000",
        "0.10000000"
      )
    },
    {
      symbol: "USDCUSD",
      status: "TRADING",
      baseAsset: "USDC",
      quoteAsset: "USD",
      orderTypes: commonOrderTypes,
      isSpotTradingAllowed: true,
      filters: filters(
        "0.80000000",
        "1.20000000",
        "0.00001000",
        "1.00000000",
        "10000000.00000000",
        "1.00000000"
      )
    }
  ]
};

export const binanceExchangeInfoEurUsdc: BinanceExchangeInfo = {
  ...binanceExchangeInfo,
  symbols: [binanceExchangeInfo.symbols[0]!]
};

export const binanceDepthSnapshot: BinanceDepthSnapshot = {
  lastUpdateId: 190295610,
  bids: [
    ["1.15200000", "31585.40000000"],
    ["1.15190000", "20709.70000000"],
    ["1.15180000", "35848.30000000"],
    ["1.15170000", "7356.00000000"],
    ["1.15160000", "4904.00000000"]
  ],
  asks: [
    ["1.15210000", "8681.60000000"],
    ["1.15220000", "5756.40000000"],
    ["1.15230000", "7174.60000000"],
    ["1.15240000", "17359.80000000"],
    ["1.15260000", "940.10000000"]
  ]
};

export const binanceDepthUpdate: {
  readonly stream: string;
  readonly data: BinanceDepthUpdate;
} = {
  stream: "eurusdc@depth@100ms",
  data: {
    e: "depthUpdate",
    E: 1785634344868,
    s: "EURUSDC",
    U: 190295611,
    u: 190295611,
    b: [],
    a: [["1.15210000", "8609.20000000"]]
  }
};

export const binanceTrade: {
  readonly stream: string;
  readonly data: BinanceTrade;
} = {
  stream: "eurusdc@trade",
  data: {
    e: "trade",
    E: 1785634344784,
    s: "EURUSDC",
    t: 27369602,
    p: "1.15210000",
    q: "72.40000000",
    T: 1785634344784,
    m: false,
    M: true
  }
};
