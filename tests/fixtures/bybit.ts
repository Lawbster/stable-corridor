import type {
  BybitInstrumentResponse,
  BybitOrderbookMessage,
  BybitPublicTradeMessage,
  BybitSubscriptionResponse
} from "../../src/venues/bybit/schemas.js";

function instrument(
  symbol: "USDTEUR" | "USDCEUR" | "USDCUSDT",
  baseCoin: "USDT" | "USDC",
  quoteCoin: "EUR" | "USDT",
  minimumNotional: "1" | "5",
  maximumQuantity: string,
  maximumNotional: string
): BybitInstrumentResponse {
  return {
    retCode: 0,
    retMsg: "OK",
    result: {
      category: "spot",
      list: [
        {
          symbol,
          baseCoin,
          quoteCoin,
          status: "Trading",
          lotSizeFilter: {
            basePrecision: "0.01",
            quotePrecision: "0.0001",
            minOrderQty: "0.01",
            maxOrderQty: maximumQuantity,
            minOrderAmt: minimumNotional,
            maxOrderAmt: maximumNotional,
            maxLimitOrderQty: maximumQuantity,
            maxMarketOrderQty: maximumQuantity
          },
          priceFilter: {
            tickSize: "0.0001"
          }
        }
      ]
    },
    time: 1785668212238
  };
}

export const bybitUsdtEurInstrument = instrument(
  "USDTEUR",
  "USDT",
  "EUR",
  "1",
  "5768000",
  "180000"
);

export const bybitUsdcEurInstrument = instrument(
  "USDCEUR",
  "USDC",
  "EUR",
  "1",
  "6837000",
  "180000"
);

export const bybitUsdcUsdtInstrument = instrument(
  "USDCUSDT",
  "USDC",
  "USDT",
  "5",
  "35000000",
  "16000000"
);

export const bybitSubscriptionAck: BybitSubscriptionResponse = {
  success: true,
  ret_msg: "subscribe",
  conn_id: "cn-test-public",
  req_id: "stable-corridor-public-subscribe",
  op: "subscribe"
};

export const bybitPong = {
  success: true,
  ret_msg: "pong",
  conn_id: "cn-test-public",
  op: "ping"
} as const;

export const bybitOrderbookSnapshot: BybitOrderbookMessage = {
  topic: "orderbook.200.USDCUSDT",
  ts: 1785668237209,
  type: "snapshot",
  data: {
    s: "USDCUSDT",
    b: [
      ["1.0008", "4047095.69"],
      ["1.0007", "12561509.08"],
      ["1.0006", "162464.17"],
      ["1.0005", "2123344.84"],
      ["1.0004", "95511.26"]
    ],
    a: [
      ["1.0009", "7453939.05"],
      ["1.001", "49000.75"],
      ["1.0011", "25708.27"],
      ["1.0012", "35748.82"],
      ["1.0013", "205750.18"]
    ],
    u: 8559640,
    seq: 157068563752
  },
  cts: 1785668236664
};

export const bybitOrderbookDelta: BybitOrderbookMessage = {
  topic: "orderbook.200.USDCUSDT",
  ts: 1785668238210,
  type: "delta",
  data: {
    s: "USDCUSDT",
    b: [["1.0008", "4132998.99"]],
    a: [["1.0009", "7453629.2"]],
    u: 8559641,
    seq: 157068564373
  },
  cts: 1785668238189
};

export const bybitPublicTrade: BybitPublicTradeMessage = {
  topic: "publicTrade.USDCUSDT",
  ts: 1785668238180,
  type: "snapshot",
  data: [
    {
      i: "2210000001554675568",
      T: 1785668238180,
      p: "1.0009",
      v: "309.85",
      S: "Buy",
      seq: 157068564370,
      s: "USDCUSDT",
      BT: false,
      RPI: false
    }
  ]
};

export const bybitPublicTradeBatch: BybitPublicTradeMessage = {
  topic: "publicTrade.USDCUSDT",
  ts: 1785668241227,
  type: "snapshot",
  data: [
    {
      i: "2210000001554675572",
      T: 1785668241227,
      p: "1.0009",
      v: "290.28",
      S: "Buy",
      seq: 157068565637,
      s: "USDCUSDT",
      BT: false,
      RPI: false
    },
    {
      i: "2210000001554675573",
      T: 1785668241227,
      p: "1.0009",
      v: "40.02",
      S: "Buy",
      seq: 157068565637,
      s: "USDCUSDT",
      BT: false,
      RPI: false
    },
    {
      i: "2210000001554675574",
      T: 1785668241227,
      p: "1.0009",
      v: "4665.2",
      S: "Buy",
      seq: 157068565637,
      s: "USDCUSDT",
      BT: false,
      RPI: false
    }
  ]
};
