# Account Access Audit

Use this file to record non-sensitive conclusions from the operator's account checks.

Do not commit screenshots, names, email addresses, account or portfolio identifiers, balances, API keys, referral data, bank details, support transcripts, session URLs, or exact personal limits. Keep sensitive evidence outside the repository. Record the conclusion, observation time, and where in the authenticated UI it was observed.

Use `unknown` until personally verified. Fees must be recorded in basis points and must distinguish a standing fee schedule from a temporary promotion.

## Audit summary

| Venue | Checked at (UTC) | Regional/account access | Relevant markets | Fee treatment | Fiat rails | Status |
|---|---|---|---|---|---|---|
| Coinbase Advanced | 2026-08-02; exact time not recorded | available | both products tradeable in buy/sell order forms | approximately 0 bp maker / 0.10 bp taker research input | USDC→EUR and SEPA withdrawal available | verified for current research role |
| Binance | 2026-08-02; exact time not recorded | existing account | `EURUSDC` tradeable; EURC unsupported | no-BNB: 9.5 bp taker, 10 bp maker | SEPA configured with operator's bank | verified for current research role |
| Bybit | 2026-08-02; exact time not recorded | existing Non-VIP account | `USDTEUR`, `USDCEUR`, and `USDCUSDT` tradeable | 10 bp maker / 10 bp taker; MNT discount unavailable | EUR rails unknown | verified for public-reference role; minima pending |
| Kraken | 2026-08-02 | Kraken Pro account available | all five planned EURC/USDC/EUR/USD products tradeable with Post Only | 20 bp maker / 20 bp taker; buy fee charged in USDC | SEPA: 2 EUR minimum, 1 EUR fee, 0-3 business days | verified for reference/backup role |

## Coinbase Advanced checklist

- [x] `EURC-USDC` is visible.
- [x] `EURC-USDC` is tradeable, not view-only.
- [x] `USDC-EUR` is visible.
- [x] `USDC-EUR` is tradeable, not view-only.
- [x] Coinbase's public product metadata and fee schedule identify both products for zero-maker stable/FX treatment.
- [ ] Exact taker fee shown for each product is recorded below.
- [x] Whether each product receives designated-stablepair treatment is confirmed.
- [x] Base increment, quote increment, status, and market-mode metadata are observed from public product data.
- [ ] EUR deposit via SEPA is available.
- [x] EUR withdrawal via SEPA is available.
- [ ] Any hold, settlement, or regional restriction relevant to rebalancing is summarized.

### Coinbase crypto transfer observations

| Observed date | Asset/route | Networks shown | Displayed Coinbase fee | Displayed estimate | Remaining verification |
|---|---|---|---|---|---|
| 2026-08-02 | USDC to a Solana wallet | Solana; Ethereum option also inspected | Solana free; Ethereum option reported as NOK 1.08 | Solana average 16 seconds | direct CASP flow |
| 2026-08-02 | EURC withdrawal | Solana, Ethereum, Base | Solana and Base free; Ethereum fee not recorded | not recorded | destination support for native EURC on each network |
| 2026-08-02 | USDC outbound from Binance | Solana route context | fixed 0.30 USDC displayed | not recorded | fee and status must be sampled at use time |

The operator verified that Binance supports native USDC deposits on Solana and does not support EURC. Current deposit status, required confirmations, and direct Coinbase-to-Binance handling should still be checked when a route is used.

## Other venue checklist

### Binance

- [x] Confirm trading access to `EURUSDC`.
- [ ] Confirm trading access to the remaining relevant products.
- [x] Record account-specific maker/taker fees.
- [x] Identify BNB payment discount separately; do not treat it as available without BNB inventory.
- [x] Confirm SEPA is configured with the operator's bank.
- [x] Native USDC deposit support on Solana confirmed by the operator.
- [x] EURC is not supported.
- [x] Approximate minimum order for `EURUSDC` confirmed as 5 EUR/USD equivalent.
- [x] Public `EURUSDC` metadata confirms `LIMIT_MAKER` support.

### Bybit

- [x] Confirm trading access to `USDTEUR`.
- [x] Confirm trading access to `USDCEUR`.
- [x] Confirm trading access to `USDCUSDT`.
- [x] Record account-specific maker/taker fees: Non-VIP, 10 bp maker / 10 bp taker.
- [x] Confirm Post Only is available; exact product context was not retained.
- [ ] Record the minimum order for each relevant product.
- [x] Record USDC withdrawal fees: 1 USDC on Solana and 0.5 USDC on Base.
- [x] Record the displayed MNT fee-payment discount separately; do not apply it without MNT inventory.
- [ ] Confirm relevant EUR rail availability and non-sensitive fee/timing facts.

### 2026-08-02 — Bybit Non-VIP fee and withdrawal observations

```text
Observed at (UTC): 2026-08-02; exact time not recorded
Venue: Bybit Spot
Account tier: Non-VIP
Maker fee: 10 bp
Taker fee: 10 bp
Post Only: available; exact product context not retained
Minimum order: unknown
MNT fee payment: 25% discount displayed, but no MNT was available and the discount is not modeled
USDC withdrawal fee on Solana: 1 USDC flat
USDC withdrawal fee on Base: 0.5 USDC flat
Transfer submitted: not reported
Tradeable products: USDTEUR, USDCEUR, USDCUSDT
Remaining checks: minimum order for each confirmed product; EUR rail details
```

### Kraken

- [x] Confirm Kraken Pro account access.
- [x] Confirm trading access to `EURC/USDC`.
- [x] Confirm Post Only is available for `EURC/USDC`.
- [x] Record account-specific `EURC/USDC` stablecoin/FX fees.
- [x] Record the public minimum order, minimum cost, tick, and quantity precision for `EURC/USDC`.
- [x] Confirm public online status and metadata for `EURC/EUR`, `EURC/USD`, `USDC/EUR`, and `USDC/USD`.
- [x] Confirm authenticated trading access and Post Only for `EURC/EUR`, `EURC/USD`, `USDC/EUR`, and `USDC/USD`.
- [x] Confirm native USDC withdrawal support on Solana: 0.7367 USDC fee and 0.1473 USDC displayed minimum.
- [ ] Confirm native USDC deposit support on Solana in the authenticated funding UI.
- [x] Record EURC withdrawal networks and fee: Ethereum only, 0.3 EURC.
- [x] Confirm SEPA availability and terms: 2 EUR minimum, 1 EUR fee, 0-3 business days.
- [ ] Test or otherwise confirm any withdrawal hold, address-whitelisting delay, or recipient-information step when naturally encountered.
- [x] Record buy-side trading fee currency: USDC.

### 2026-08-02 — Kraken EURC/USDC access and fee preview

```text
Observed at (UTC): 2026-08-02 00:20
Venue: Kraken Pro
Product: EURC/USDC
Tradeable: yes; buy/sell limit order form available
Post Only: available
Account fee display: 20 bp maker / 20 bp taker
Preview: 100 EURC at 1.15241 USDC showed 115.241 USDC notional and 0.230482 USDC estimated fee
Visible best bid/ask: 1.15224 / 1.15313 USDC
Visible spread: 0.00089 USDC, approximately 7.72 bp
Order submitted: no
Conclusion: current maker fee exceeds the entire visible spread; reject as a routine maker venue at this tier
Additional buy preview: 0.19 USDC fee displayed; preview notional was not retained
Fee currency conclusion: buying EURC pays the trading fee in quote asset USDC
Remaining checks: account-specific USDC/Solana deposit support and any naturally encountered withdrawal hold or recipient step
```

### 2026-08-02 — Kraken public product metadata

```text
Source: public Kraken AssetPairs endpoint
EURC/USDC: online; minimum 4 EURC; minimum cost 0.5 USDC; tick 0.00001; quantity precision 8 decimals
EURC/EUR: online; minimum 4 EURC; minimum cost 0.45 EUR; tick 0.0001; quantity precision 8 decimals
EURC/USD: online; minimum 4 EURC; minimum cost 0.5 USD; tick 0.00001; quantity precision 8 decimals
USDC/EUR: online; minimum 5 USDC; minimum cost 0.45 EUR; tick 0.0001; quantity precision 8 decimals
USDC/USD: online; minimum 5 USDC; minimum cost 0.5 USD; tick 0.0001; quantity precision 8 decimals
Fee metadata: entry tier 20 bp maker / 20 bp taker for all five products
Caveat: public online status does not prove account-specific regional access
```

### 2026-08-02 — Kraken funding rails

```text
USDC withdrawal, Ethereum: 0.4786 USDC fee; 0.0957 USDC displayed minimum
USDC withdrawal, Solana (native USDC): 0.7367 USDC fee; 0.1473 USDC displayed minimum
USDC withdrawal, Base: 1 USDC fee; 1.5 USDC displayed minimum
USDC withdrawal, Ink (native USDC): no fee; 0.2 USDC displayed minimum
Additional USDC networks were visible but are not required for the current route comparison
EURC withdrawal: Ethereum only; 0.3 EURC fee; minimum not recorded
EUR SEPA: available; 2 EUR minimum; 1 EUR flat fee; 0-3 business days
Transfer submitted: no
Hold or recipient-information behavior: not tested
Caveat: withdrawal-network availability and fees are directional, account-specific observations and must be rechecked before use
```

## Sanitized observations

### 2026-08-01 — Coinbase Advanced candidate products

```text
Observed at (UTC): 2026-08-01; exact time not recorded
Venue: Coinbase Advanced
Authenticated UI area: order forms
Products: USDC-EUR and EURC-USDC
Conclusion: both products expose buy and sell order forms and appear tradeable
Minimum order: approximately one quote-currency unit; exact increments remain unverified
Maker fee (bp): unknown; EURC-USDC preview had post-only available but not selected
Taker fee (bp): approximately 0.10 implied by both displayed fee estimates
Promotion involved (yes/no): no promotion observed; standing classification still to confirm
Restriction or caveat: displayed fees were approximate previews, not completed-fill evidence
Recheck date: before fee-model configuration or any later trading authorization
```

### 2026-08-02 — Coinbase public product metadata

```text
Source: public Coinbase Exchange `https://api.exchange.coinbase.com/products/<product>` endpoint
EURC-USDC: online, fx_stablecoin=true, limit_only=true
EURC-USDC increments: base 1 EURC; quote 0.0001 USDC
USDC-EUR: online, fx_stablecoin=true, limit_only=false
USDC-EUR increments: base 0.01 USDC; quote 0.0001 EUR
Interpretation: both products receive Coinbase's stable/FX product designation
Caveat: product post_only=false describes the market-wide mode, not the order-level Post Only option
```

### 2026-08-02 — Coinbase crypto withdrawal previews

```text
Observed at (UTC): 2026-08-02; exact time not recorded
Venue: Coinbase Advanced
USDC: Solana withdrawal displayed as free with a 16-second average estimate
USDC caveat: Ethereum option was reported as NOK 1.08; exact notional was not retained
EURC networks shown: Solana, Ethereum, and Base
EURC fees: Solana and Base displayed as free; Ethereum fee not recorded
Transfer submitted: no
Restriction or caveat: wallet-transfer estimate is not destination-exchange credit latency
Recheck date: before configuring or performing a rebalance route
```

### 2026-08-02 — Binance stablecoin network support

```text
Observed at (UTC): 2026-08-02; exact time not recorded
Venue: Binance
Native USDC on Solana: supported
EURC: unsupported
Measured route: Coinbase to Binance, USDC on Solana, completed in approximately 5 minutes
Operational experience: Solana exchange transfers usually credit within 5 minutes
Conservative ordinary-case planning delay: 30 minutes
Caveat: withdrawal/deposit suspension and stress-tail delays remain separate scenarios
```

### 2026-08-02 — Binance EURUSDC access and fee preview

```text
Observed at (UTC): 2026-08-02; exact time not recorded
Venue: Binance Spot
Product: EURUSDC
Tradeable: yes
Approximate minimum order: 5 EUR/USD equivalent
Fee level: Regular User
Without BNB fee payment: 9.5 bp taker; 10 bp maker
With 25% BNB fee-payment discount: 7.125 bp taker; 7.5 bp maker
BNB currently available for fee payment: no
Research fee assumption: 9.5 bp taker; 10 bp maker
Order submitted: not reported
Restriction or caveat: fees remain versioned account observations and must be rechecked before use
```

### 2026-08-02 — Binance public EURUSDC metadata

```text
Source: public Binance `https://api.binance.com/api/v3/exchangeInfo?symbol=EURUSDC` endpoint
Status: TRADING
Spot trading allowed: yes
Order types: LIMIT, LIMIT_MAKER, MARKET, STOP_LOSS, STOP_LOSS_LIMIT, TAKE_PROFIT, TAKE_PROFIT_LIMIT
Minimum notional: 5
Price tick: 0.0001
Quantity step: 0.1 EUR
Interpretation: this product supports Binance's Post Only equivalent, LIMIT_MAKER
```

### 2026-08-02 — Binance fiat off-ramp

```text
Venue: Binance
EUR SEPA: configured with the operator's bank and operationally familiar
Research role: periodic cash off-ramp and contingency fiat bridge
Routine execution role: rejected at current EURUSDC fees
Unknowns: current SEPA fee, settlement timing, limits, and maintenance status
```

### 2026-08-02 — Coinbase fiat off-ramp

```text
Venue: Coinbase Advanced
USDC-EUR trading: available
EUR SEPA withdrawal: available and linked
Research role: preferred periodic cash off-ramp
Unknowns: current SEPA fee, settlement timing, limits, and maintenance status
Reason for preference: Coinbase USDC-EUR trading cost is materially lower than Binance EURUSDC at the observed account tiers
```

### 2026-08-02 — Binance outbound USDC preview

```text
Venue: Binance
Asset/network context: USDC/Solana
Displayed network fee: 0.30 USDC
Transfer submitted: no
Sensitive screenshot data retained: no
Caveat: outbound fee is directional and may change with venue policy or network conditions
```

Add dated entries in this form:

```text
Observed at (UTC):
Venue:
Authenticated UI area:
Product or rail:
Conclusion:
Maker fee (bp):
Taker fee (bp):
Promotion involved (yes/no):
Promotion expiry:
Restriction or caveat:
Recheck date:
```

An unknown or adverse result should be preserved rather than inferred away.
