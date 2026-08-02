export const coinbaseEurcUsdcProduct = {
  product_id: "EURC-USDC",
  base_increment: "1",
  quote_increment: "0.0001",
  quote_min_size: "2",
  quote_max_size: "10000000",
  base_min_size: "1",
  base_max_size: "8944543.8282647584973166",
  status: "online",
  cancel_only: false,
  limit_only: true,
  post_only: false,
  trading_disabled: false,
  view_only: false,
  product_type: "SPOT",
  quote_currency_id: "USDC",
  base_currency_id: "EURC"
} as const;

export const coinbaseUsdcEurProduct = {
  product_id: "USDC-EUR",
  base_increment: "0.01",
  quote_increment: "0.0001",
  quote_min_size: "1",
  quote_max_size: "10000000",
  base_min_size: "0.01",
  base_max_size: "10000000",
  status: "online",
  cancel_only: false,
  limit_only: false,
  post_only: false,
  trading_disabled: false,
  view_only: false,
  product_type: "SPOT",
  quote_currency_id: "EUR",
  base_currency_id: "USDC"
} as const;

export const coinbaseLevel2Snapshot = {
  channel: "l2_data",
  timestamp: "2026-08-02T00:53:11.420933992Z",
  sequence_num: 0,
  events: [
    {
      type: "snapshot",
      product_id: "EURC-USDC",
      updates: [
        {
          side: "bid",
          event_time: "2026-08-02T00:53:11.056071Z",
          price_level: "1.1519",
          new_quantity: "8200"
        },
        {
          side: "bid",
          event_time: "2026-08-02T00:53:11.056071Z",
          price_level: "1.1518",
          new_quantity: "8683"
        },
        {
          side: "offer",
          event_time: "2026-08-02T00:53:11.056071Z",
          price_level: "1.1521",
          new_quantity: "4172"
        },
        {
          side: "offer",
          event_time: "2026-08-02T00:53:11.056071Z",
          price_level: "1.1522",
          new_quantity: "52"
        }
      ]
    }
  ]
} as const;

export const coinbaseTradeSnapshot = {
  channel: "market_trades",
  timestamp: "2026-08-02T00:53:11.422801842Z",
  sequence_num: 1,
  events: [
    {
      type: "snapshot",
      trades: [
        {
          product_id: "EURC-USDC",
          trade_id: "18143644",
          price: "1.1519",
          size: "1",
          time: "2026-08-02T00:52:44.917858Z",
          side: "BUY"
        },
        {
          product_id: "EURC-USDC",
          trade_id: "18143643",
          price: "1.152",
          size: "1",
          time: "2026-08-02T00:51:28.448427Z",
          side: "SELL"
        }
      ]
    }
  ]
} as const;

export const coinbaseHeartbeat = {
  channel: "heartbeats",
  timestamp: "2026-08-02T00:53:12.085623147Z",
  sequence_num: 3,
  events: [
    {
      current_time:
        "2026-08-02 00:53:12.081285895 +0000 UTC m=+33545.301158269",
      heartbeat_counter: 33545
    }
  ]
} as const;

export const coinbaseStatusSnapshot = {
  channel: "status",
  timestamp: "2026-08-02T00:53:11.500635373Z",
  sequence_num: 2,
  events: [
    {
      type: "snapshot",
      products: [
        {
          id: "EURC-USDC",
          status: "online",
          status_message: ""
        }
      ]
    }
  ]
} as const;

export const coinbaseLevel2Update = {
  channel: "l2_data",
  timestamp: "2026-08-02T00:53:12.433337576Z",
  sequence_num: 4,
  events: [
    {
      type: "update",
      product_id: "EURC-USDC",
      updates: [
        {
          side: "bid",
          event_time: "2026-08-02T00:53:12.394041Z",
          price_level: "1.1519",
          new_quantity: "8100"
        },
        {
          side: "offer",
          event_time: "2026-08-02T00:53:12.394041Z",
          price_level: "1.1522",
          new_quantity: "0"
        }
      ]
    }
  ]
} as const;

export const coinbaseTradeUpdate = {
  channel: "market_trades",
  timestamp: "2026-08-02T00:53:13.607435877Z",
  sequence_num: 5,
  events: [
    {
      type: "update",
      trades: [
        {
          product_id: "EURC-USDC",
          trade_id: "18143645",
          price: "1.1521",
          size: "1",
          time: "2026-08-02T00:53:13.561383Z",
          side: "SELL"
        }
      ]
    }
  ]
} as const;
