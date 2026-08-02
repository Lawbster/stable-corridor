import type {
  KrakenAssetPairsResponse,
  KrakenSubscriptionAck
} from "../../src/venues/kraken/schemas.js";

export const krakenAssetPairs: KrakenAssetPairsResponse = {
  error: [],
  result: {
    EURCEUR: {
      altname: "EURCEUR",
      wsname: "EURC/EUR",
      base: "EURC",
      quote: "ZEUR",
      pair_decimals: 4,
      lot_decimals: 8,
      ordermin: "4",
      costmin: "0.45",
      tick_size: "0.0001",
      status: "online",
      execution_venue: "international"
    },
    EURCUSD: {
      altname: "EURCUSD",
      wsname: "EURC/USD",
      base: "EURC",
      quote: "ZUSD",
      pair_decimals: 5,
      lot_decimals: 8,
      ordermin: "4",
      costmin: "0.5",
      tick_size: "0.00001",
      status: "online",
      execution_venue: "international"
    },
    EURCUSDC: {
      altname: "EURCUSDC",
      wsname: "EURC/USDC",
      base: "EURC",
      quote: "USDC",
      pair_decimals: 5,
      lot_decimals: 8,
      ordermin: "4",
      costmin: "0.5",
      tick_size: "0.00001",
      status: "online",
      execution_venue: "international"
    },
    USDCEUR: {
      altname: "USDCEUR",
      wsname: "USDC/EUR",
      base: "USDC",
      quote: "ZEUR",
      pair_decimals: 4,
      lot_decimals: 8,
      ordermin: "5",
      costmin: "0.45",
      tick_size: "0.0001",
      status: "online",
      execution_venue: "international"
    },
    USDCUSD: {
      altname: "USDCUSD",
      wsname: "USDC/USD",
      base: "USDC",
      quote: "ZUSD",
      pair_decimals: 4,
      lot_decimals: 8,
      ordermin: "5",
      costmin: "0.5",
      tick_size: "0.0001",
      status: "online",
      execution_venue: "international"
    }
  }
};

export const krakenBookSubscriptionAck: KrakenSubscriptionAck = {
  method: "subscribe",
  result: {
    channel: "book",
    symbol: "USDC/USD",
    snapshot: true,
    depth: 25
  },
  success: true,
  time_in: "2026-08-02T14:18:38.100000Z",
  time_out: "2026-08-02T14:18:38.100100Z",
  req_id: 301
};

export const krakenTradeSubscriptionAck: KrakenSubscriptionAck = {
  method: "subscribe",
  result: {
    channel: "trade",
    symbol: "USDC/USD",
    snapshot: false
  },
  success: true,
  time_in: "2026-08-02T14:18:38.100200Z",
  time_out: "2026-08-02T14:18:38.100300Z",
  req_id: 302
};

export const krakenStatus = {
  channel: "status",
  type: "update",
  data: [
    {
      version: "2.0.10",
      system: "online",
      api_version: "v2",
      connection_id: 15554068979111373000
    }
  ]
} as const;

export const krakenHeartbeat = '{"channel":"heartbeat"}';

export const krakenBookSnapshotRaw =
  '{"channel":"book","type":"snapshot","data":[{"symbol":"USDC/USD","bids":[{"price":0.9997,"qty":3458455.09588324},{"price":0.9996,"qty":121278.21147528},{"price":0.9995,"qty":107068.64756338},{"price":0.9994,"qty":1050.02601480},{"price":0.9993,"qty":1408879.72643197},{"price":0.9992,"qty":3640.51240990},{"price":0.9991,"qty":7585.61155195},{"price":0.9990,"qty":51916.71640639},{"price":0.9989,"qty":1604.38275101},{"price":0.9988,"qty":20.02402882}],"asks":[{"price":0.9998,"qty":5764470.90836009},{"price":0.9999,"qty":511413.23906338},{"price":1.0000,"qty":2019643.00338220},{"price":1.0001,"qty":1469785.26145770},{"price":1.0002,"qty":200648.22989717},{"price":1.0003,"qty":1060.12081067},{"price":1.0004,"qty":577.10342548},{"price":1.0005,"qty":48.42403700},{"price":1.0006,"qty":12004.20252151},{"price":1.0007,"qty":557.11142228}],"checksum":240008930,"timestamp":"2026-08-02T14:18:55.706617Z"}]}';

export const krakenBookUpdateRaw =
  '{"channel":"book","type":"update","data":[{"symbol":"USDC/USD","bids":[{"price":0.9997,"qty":3458427.68005360}],"asks":[],"checksum":3271444979,"timestamp":"2026-08-02T14:18:59.179906Z"}]}';

export const krakenTradeRaw =
  '{"channel":"trade","type":"update","data":[{"symbol":"USDC/USD","side":"sell","price":0.9997,"qty":2.85085526,"ord_type":"limit","trade_id":22719451,"timestamp":"2026-08-02T14:19:07.241261Z"}]}';
