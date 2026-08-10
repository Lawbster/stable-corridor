# Current Findings

**As of:** 2026-08-02
**Research state:** deterministic public fixtures and collector contract only; no forward dataset or opportunity replay result

## Working thesis

The candidate is dislocation-only, post-only EURC/USDC market making using pre-positioned finite inventory. Multi-venue EUR/USD and stablecoin markets provide fair value. Ordinary cross-exchange transfer arbitrage is not the target.

Coinbase Advanced is the initial execution candidate only if the operator verifies market access and account-specific designated-stablepair pricing. Binance, Bybit, and Kraken initially serve as public price-discovery and possible later rebalancing references.

## What is not yet known

- Exact maker treatment for the Coinbase products; the operator's previews imply approximately 0.10 bp when an order may take liquidity.
- Kraken USDC/Solana deposit support and any withdrawal hold or recipient-information workflow.
- Bybit SEPA fee and practical timing details.
- A licensed, sufficiently timestamped conventional EUR/USD reference source.
- Whether dislocations survive conservative fee, queue, latency, inventory, rebalance, peg, and venue-failure modeling.

## Verified account-level access

On 2026-08-01, the operator verified that Coinbase Advanced exposes actionable buy and sell order forms for both `USDC-EUR` and `EURC-USDC`. The displayed fee estimates imply approximately 0.10 bp on the previewed orders. `EURC-USDC` exposes a post-only option, but post-only maker treatment and completed-fill fees have not been verified.

No balances, screenshots, account identifiers, or sensitive limits are retained in the repository.

On 2026-08-02, Coinbase's public product metadata returned `fx_stablecoin=true` for both products. `EURC-USDC` was online and limit-only with a base increment of `1` and quote increment of `0.0001`; `USDC-EUR` was online with a base increment of `0.01` and quote increment of `0.0001`. Combined with Coinbase's published zero-maker stablepair treatment, this is sufficient to model a versioned `0.00 bp` maker fee in research. The account preview and first eventual approved pilot fill must still be reconciled before any live reliance.

The public `post_only=false` product field means the whole market is not restricted to post-only mode. It does not disable the order-level Post Only option. At order level, Post Only rejects an order that would immediately take liquidity, ensuring an accepted eventual fill is maker.

## Rebalancing-rail working model

A stablecoin transfer can repair a venue-location imbalance but cannot change total portfolio currency exposure. For example, moving USDC to Coinbase replenishes Coinbase USDC, but it does not offset aggregate EUR/EURC acquired elsewhere. Currency composition must eventually be repaired through opposite fills, an explicit conversion trade, or a fiat/issuer rail.

SEPA is therefore not required for each cycle or necessarily for initial profitability. It is a slow periodic funding, cash-out, and hard-unwind route. A crypto-only operating loop remains viable for research if:

- both venues support the same native asset on the same network;
- the complete transfer and any conversion cost are measured;
- crediting time, withdrawal availability, manual/regulatory steps, and stranded-capital time are modeled;
- finite inventory can remain bounded between rebalances;
- the strategy is not presented as locked arbitrage without a reliable redemption route.

Each rebalance route will be evaluated as a versioned cost and delay observation rather than assuming that a low-fee blockchain makes the exchange withdrawal free or automatic.

### Coinbase withdrawal observations

On 2026-08-02, authenticated Coinbase previews showed:

- USDC withdrawal to a Solana wallet with no displayed fee and a 16-second average transfer estimate;
- an Ethereum option reported at NOK 1.08;
- EURC withdrawal support on Solana, Ethereum, and Base;
- no displayed fee for EURC withdrawal on Solana or Base.

This makes Coinbase-side nominal transfer cost unlikely to be the limiting economic factor for infrequent batched rebalancing. It does not yet establish end-to-end exchange credit latency or availability. Before treating a route as usable, research must verify the exact native asset/network at the destination, current deposit status, confirmation requirements, direct exchange/CASP handling, and time until the deposit is tradeable.

On 2026-08-02, the operator verified that Binance supports native USDC deposits on Solana and does not support EURC. A real Coinbase-to-Binance USDC transfer over Solana completed in approximately 5 minutes. Based on this result and repeated operator experience, research will use 5 minutes as the typical delay and 30 minutes as the conservative ordinary-case rebalance delay. Longer stress scenarios and disabled deposits/withdrawals remain mandatory.

Binance's lack of EURC support does not block the primary candidate. Coinbase can own the EURC leg while `USDC-EUR` on Coinbase supplies the offsetting EUR/USDC inventory trade. Binance can remain a public fair-value source and a possible USDC/EUR inventory venue without ever receiving EURC.

The operator also verified that Binance `EURUSDC` is tradeable with an approximate 5 EUR/USD-equivalent minimum. The account is Regular User tier. Without BNB fee payment, the displayed fees are `9.5 bp` taker and `10 bp` maker. Enabling the 25% BNB payment discount displays `7.125 bp` taker and `7.5 bp` maker, but the account has no BNB available. Research must therefore use the undiscounted 9.5/10 bp rates and must not assume BNB inventory.

At these fees, Binance is rejected as a routine execution or hedge venue for sub-10-bp dislocations. A maker order is not cheaper than a taker order on this product. Binance remains useful for public fair value, USDC/Solana inventory transport, exceptional rebalance, and periodic cash off-ramp.

Binance's public `exchangeInfo` metadata independently reports `EURUSDC` as trading, with a `5` minimum notional, `0.0001` price tick, `0.1 EUR` quantity step, and `LIMIT_MAKER` support. `LIMIT_MAKER` is Binance's explicit Post Only order type.

The operator already has EUR SEPA configured with Binance and considers it an easy fiat off-ramp. This is classified as a periodic cash-out and contingency rail, not a time-sensitive strategy leg. Its current fee, settlement time, limits, and maintenance status remain account observations to capture before including it in an all-in return calculation.

On 2026-08-02, the operator confirmed that Coinbase supports both trading USDC to EUR and withdrawing EUR through an already available SEPA route. Coinbase is therefore the preferred cash off-ramp because its observed USDC-EUR trading cost is materially lower than Binance EURUSDC. Binance SEPA remains a contingency route.

The operator subsequently confirmed that Coinbase's EUR SEPA withdrawal displayed no fee and an estimated `0-3 business day` settlement window. This resolves the nominal fee/timing input but not practical settlement tails, limits, holds, or maintenance risk.

An authenticated Binance outbound USDC preview in the Solana route context displayed a fixed `0.30 USDC` network fee. Transfer routes must therefore be modeled directionally:

- Coinbase to Binance, USDC/Solana: no Coinbase fee observed; approximately 5 minutes in one completed sample;
- Binance to Coinbase/external, USDC/Solana: `0.30 USDC` outbound fee observed; credit time not measured.

The fixed Binance fee equals `30 bp` on a 100 USDC transfer, `3 bp` on 1,000 USDC, `0.30 bp` on 10,000 USDC, and `0.10 bp` on 30,000 USDC. It is negligible only when amortized over a sufficiently large, infrequent rebalance.

## Kraken account observation

On 2026-08-02, the operator confirmed Kraken Pro access and a tradeable `EURC/USDC` limit order form with Post Only available. The authenticated fee display showed `20 bp` maker and `20 bp` taker. A 100 EURC preview at `1.15241 USDC` showed `115.241 USDC` notional and an estimated `0.230482 USDC` fee, consistent with 20 bp.

At the same observation, the visible best bid and ask were `1.15224` and `1.15313`, a spread of approximately `7.72 bp`. The maker fee alone exceeded that entire displayed spread. Kraken is therefore rejected as a routine maker venue at the current tier, but remains useful as an independent public fair-value source and may qualify as a backup transfer or fiat rail after the remaining funding checks.

Kraken's public AssetPairs metadata reported all five planned reference products online. `EURC/USDC` has a minimum order of `4 EURC`, minimum cost of `0.5 USDC`, `0.00001` tick, and eight-decimal quantity precision. `EURC/EUR`, `EURC/USD`, `USDC/EUR`, and `USDC/USD` also returned online with small minimums. The operator subsequently confirmed authenticated buy/sell access and Post Only availability for all four.

An additional buy preview displayed a `0.19 USDC` fee, confirming that buying EURC on `EURC/USDC` charges the trading fee in quote asset USDC. The preview notional was not retained, so the fee amount is not used to infer a second rate.

Kraken's authenticated withdrawal UI showed native USDC on Solana with a fixed `0.7367 USDC` withdrawal fee and `0.1473 USDC` displayed minimum. Ethereum displayed `0.4786 USDC`, Base displayed `1 USDC`, and Ink native USDC displayed no withdrawal fee. Account-specific USDC deposit support on Solana remains to be explicitly confirmed before considering the route operational.

EURC withdrawal is available only on Ethereum and costs `0.3 EURC`. Kraken therefore does not supply a Solana or Base EURC bridge to Coinbase. The fixed EURC fee equals `30 bp` on 100 EURC, `3 bp` on 1,000 EURC, and `0.3 bp` on 10,000 EURC, before any destination or conversion costs.

EUR SEPA is available with a `2 EUR` minimum, `1 EUR` flat fee, and `0-3 business day` estimate. It is suitable as a periodic fiat rail rather than a time-sensitive strategy leg. Holds, address-whitelisting delay, and recipient-information behavior were not tested.

## Bybit account observation

On 2026-08-02, the operator's Bybit Spot fee display identified the account as Non-VIP with `10 bp` maker and `10 bp` taker pricing. A 25% MNT fee-payment discount was displayed, but the account had no MNT; research therefore uses the undiscounted fees. Post Only was available, although the exact product context was not retained. The operator subsequently confirmed that `USDTEUR`, `USDCEUR`, and `USDCUSDT` are all tradeable, with an approximately `1 USDC/USDT`-equivalent minimum on the checked spot order forms.

Bybit's live public instrument metadata is authoritative for pair-specific order rules and reported a `1 EUR` minimum notional for both `USDTEUR` and `USDCEUR`, but a `5 USDT` minimum for `USDCUSDT`. All three were `Trading`, with a `0.0001` tick and `0.01` base precision. The adapter records these live rules instead of applying one account observation across every pair.

The operator reported flat outbound USDC fees of `1 USDC` on Solana and `0.5 USDC` on Base. No transfer was reported. At current trading fees, Bybit remains a public price and liquidity reference rather than a routine execution venue for narrow corridor dislocations.

## Coinbase public adapter finding

On 2026-08-02, a live unauthenticated probe of Coinbase Exchange WebSocket `level2` returned a subscription error stating that `level2`, `level3`, and `full` now require authentication. No credentials were added or used. Coinbase Advanced Trade's public market-data WebSocket was then verified unauthenticated for both `EURC-USDC` and `USDC-EUR`, including `level2`, `market_trades`, `status`, and `heartbeats`.

The implemented A3 adapter treats Coinbase `level2` quantities as absolute sizes, removes zero-size levels, preserves connection and venue sequence state, reconciles overlapping repeated trade snapshots, and fails closed on an envelope sequence gap, conflicting duplicate trade details, stale or unavailable product, malformed message, oversized frame, update before snapshot, or crossed book. Non-adjacent forward trade IDs are retained with structured continuity evidence because Coinbase does not document adjacency as a delivery guarantee. Coinbase documents trade `side` as the maker side, so the normalized persisted side is inverted to represent the aggressor.

The public Advanced Trade product REST response reported a `2 USDC` quote minimum for `EURC-USDC`, while the older Exchange product response reported `1 USDC` and the operator observed an approximately `1` unit UI minimum. The live `status` channel also reported a `0.01` quote increment where public REST reported `0.0001`. The adapter therefore treats Advanced Trade public REST as the product-rules authority, uses `status` for availability rather than increments, records the discrepancies, and requires current metadata instead of silently reconciling conflicting fields.

## Binance public adapter finding

On 2026-08-02, Binance's unauthenticated market-data-only REST API returned `EURUSDC`, `EURIUSDC`, and `USDCUSD` as spot-enabled and `TRADING`, each with `LIMIT_MAKER` support and a `5` quote-unit minimum notional. `EURUSDC` and `EURIUSDC` reported a `0.0001` tick and `0.1` quantity step; `USDCUSD` reported a `0.00001` tick and `1` quantity step.

The market-data-only combined WebSocket produced diff-depth updates for all three products during a bounded live probe. Trades arrived for `EURUSDC` and `USDCUSD`; no `EURIUSDC` trade arrived during the short probe. The A4 adapter therefore requires synchronized depth and online metadata for research eligibility while collecting and continuity-checking trades independently.

Binance requires a WebSocket-first synchronization sequence: buffer diff-depth events, fetch a REST snapshot, discard obsolete updates, and require the first retained event to bridge the snapshot update ID. The adapter implements this with absolute quantities, zero removal, bounded buffering, newer-snapshot retry, and fail-closed handling for sequence/trade gaps, crossed or incomplete books, staleness, changed metadata contracts, and oversized input. No authenticated or order endpoint was introduced.

## Bybit public adapter finding

On 2026-08-02, Bybit's unauthenticated spot WebSocket accepted one subscription containing the six approved `orderbook.200` and `publicTrade` topics for `USDTEUR`, `USDCEUR`, and `USDCUSDT`. It acknowledged the subscription and application-level ping, produced 200-level snapshots for all three products, continuous order-book deltas, and observed `USDCUSDT` trades during the bounded probe.

The A4 adapter uses Bybit's update ID `u` for strict per-product order-book continuity and requires cross sequence `seq` to increase. A snapshot replaces the complete tracked book; `u=1` is treated as a service-reset recovery snapshot. Deltas are absolute quantities and zero removes a level. Trade identifiers are deduplicated, but are not assumed to be sequential; multiple trades may legitimately share one `seq`. Online public metadata, a successful subscription acknowledgement, and a valid snapshot are required for research eligibility. The adapter fails closed on gaps, out-of-order messages, duplicate trades, crossed or incomplete books, stale products, changed asset mappings, malformed/oversized input, and rejected subscriptions. No authenticated, order, transfer, or withdrawal endpoint was introduced.

## Kraken public adapter finding

On 2026-08-02, Kraken's unauthenticated `AssetPairs` endpoint returned all
five approved products online: `EURC/USDC`, `EURC/EUR`, `EURC/USD`,
`USDC/EUR`, and `USDC/USD`. A bounded WebSocket v2 probe received successful
book and trade subscription acknowledgements and checksum-valid snapshots
for all five products.

Kraken WebSocket v2 supplies an unsigned CRC32 book checksum instead of a
conventional book sequence. The adapter preserves lossless price and
quantity strings, applies each message transactionally, truncates to the
subscribed 25 levels, verifies the checksum over the top ten levels, and
records a local per-connection book-message ordinal alongside the checksum.
It fails closed on checksum mismatch, malformed or oversized input, book or
trade discontinuity, rejected subscriptions, stale data, changed metadata,
or an invalid book. No authenticated endpoint was added.

## Public collector readiness finding

The install-ready runner connects the four public adapters, assigns one
global ingest sequence across venue journals, publishes atomic health,
creates bounded 60-second book checkpoints, reconnects only the affected
venue after a recoverable feed failure, and stops on journal, health, or
storage failure. The PM2 pilot deliberately disables automatic process
restart so a process-level safety exit remains visible.

A local public-network durability smoke using the production
`syncEveryAppend=true` setting reached healthy and research-eligible on all
13 configured feeds. It reported zero journal errors, a 34 ms journal-write
age, 6 ms event-loop lag, and approximately 107 MiB RSS during the short
sample. These are functional checks, not capacity estimates. Only the
operator's 24/48/72-hour VPS measurements can establish daily storage growth
and shared-host resource impact.

The first VPS start on commit `f8b9070` opened all four venue sessions and
persisted approximately 2.7 MiB over about 100 seconds with zero journal
errors. A quiet `EURIUSDC` period then correctly triggered the configured
staleness recovery path, but Node.js rejected the application-supplied
WebSocket close code `1011` as invalid. That exception escalated the intended
Binance-only reconnect into a fail-closed collector stop. PM2 did not
automatically restart it, and the journals closed with metadata as designed.

The correction uses private application close codes `4000` and `4001` for
transport failure and feed recovery, respectively. The Binance pilot stale
threshold is also raised from 30 to 120 seconds based on the observed quiet
reference market. No captured data was deleted.

On the corrected VPS run at commit `944c66c`, the collector remained online
with zero PM2 restarts, all 13 feeds healthy and research-eligible, empty
health reason codes, and zero journal errors. The process reported about
230 MiB in PM2 and 230.3 MiB RSS in health. Kraken recovered twice because
quiet `EURC/EUR` exceeded the original 60-second threshold; both recoveries
completed without affecting the collector process. To avoid needless
session churn while retaining bounded refresh, the Kraken pilot threshold
is raised to five minutes.

After approximately 20 hours on commit `8e74d41`, all 13 feeds remained
healthy with zero journal errors and zero event-loop lag. Journal evidence
showed that Bybit's 119 reconnects were all collector-requested
`4001` recoveries led by quiet `USDCEUR`, while Binance's 24 were the same
pattern led by quiet `EURIUSDC`. Because one quiet product refreshes the
whole venue session, each trigger produced recovery transitions for every
configured product on that venue. These are not independent transport
failures. Both pilot silence thresholds are raised to five minutes.

Kraken's four recoveries used abnormal close code `1006`, not the
collector's recovery code, and are retained as genuine transport
disconnects. Coinbase's collector-requested recoveries included repeated
`market_trades` snapshots. Coinbase's public contract permits both
`snapshot` and `update` event types but does not state that a snapshot is
one-time-only. The first reconciliation correction discarded already-seen
overlap, accepted an unseen tail, and journaled a healthy diagnostic, but
still assumed adjacent numeric trade IDs. The later 77.3-hour audit showed
that assumption also caused needless reconnects. The current correction is
described below. Historical `duplicate_trade_snapshot` and
`trade_id_gap_or_out_of_order` events remain valid evidence of earlier
collector behavior.

Over the same interval, data grew from `12,101,557` to `1,680,697,090`
bytes, approximately `1.81 GiB/day` uncompressed. At that rate the 10 GiB
pilot ceiling is roughly 4.7 days from the baseline and the current
filesystem reserve remains sufficient for the 72-hour gate. Collector RSS
was approximately 233 MiB; only approximately 11 MiB of the collector
process itself was swapped despite higher host-wide swap use.

The first full local mirror audit verified all 304 closed parts against
their metadata and SHA-256: `2,803,222` events and `1,717,518,706` closed
bytes across approximately 21.3 hours. No closed-part integrity failure,
duplicate global ingest sequence, open/closed filename collision, or
unexpected file was found. Seventy-six mutable open parts totaling
`35,145,541` bytes were intentionally excluded. Streaming those immutable
parts through gzip level 6 produced `95,924,798` bytes, a measured ratio of
`5.5851%` and space saving of `94.4149%`; no source journal was changed.
This establishes compression potential, not authorization for an
on-server compression or deletion workflow.

At approximately 77.3 elapsed hours, the collector remained healthy with
zero journal errors, approximately `228 MiB` RSS, and `1 ms` event-loop
lag. The mirror held approximately `6.70 GB`; 519 of 519 immutable parts
passed route, metadata, event-count, timestamp, and SHA-256 verification.
Those parts contained `7,641,004` events and `4,638,773,335` logical
bytes. Gzip level 6 produced `257,717,238` bytes, a `5.5557%` ratio.

The deployed run recorded 58 Coinbase recoveries caused by the adapter's
exactly-adjacent `trade_id` assumption. Coinbase documents continuity for
WebSocket envelope `sequence_num`, while its `market_trades` channel
documents 250 ms aggregation but no adjacent-ID guarantee. Repeated
snapshot reconciliation separately succeeded 53 times without forcing a
reconnect. The adapter now uses envelope sequence as the delivery
integrity boundary, deduplicates overlaps, retains non-adjacent IDs, and
persists structured `trade_continuity` evidence. Conflicting duplicate
details remain fail-closed.

The final post-stop pull closed all 78 previously mutable journals and
removed their obsolete local `.open` copies. The full mirror covers
approximately `78.21` elapsed hours across the pilot runs. All 600 closed
parts passed route, metadata, event-count, timestamp, and SHA-256 checks.
They contain `11,176,976` events and `6,776,183,693` logical bytes,
including `10,086,229` book deltas and `1,024,393` trades. Every observed
run has zero duplicate ingest sequences and zero unobserved sequences
within its closed range.

The principal manifest-backed run
`f8143606-623e-49bc-a530-0841d36250cf` lasted approximately `56.13` hours
and closed intentionally with exit code zero, zero journal errors, and
`signal_sigint`. The replacement run
`7fb77d97-1c3e-4da2-9c60-0cb4627165e5` started on commit `7533605` with
the same reviewed configuration hash. Its first health observation
reported all 13 feeds healthy, no reason codes, zero gaps and reconnects,
zero journal errors, zero event-loop lag, and approximately `229 MiB` RSS.

No `trade_continuity` event appears in the immutable audit yet because
the corrected run had only new mutable open journals at pull time and no
observed anomaly had created that stream. This is expected rather than
evidence that the new rule is untested in production. The new run ID
already provides a clean logical analysis boundary, so the historical
pilot need not be wiped merely to separate corrected data.

All 600 finalized pilot parts were subsequently compressed and verified
on the VPS at low scheduling priority. Their `6,776,183,693` source bytes
produced `375,093,132` gzip bytes, a `5.5355%` ratio and `94.4645%`
space saving. The bulk pass completed in approximately `67.652` seconds.
A later local pull verified all 600 gzip artifacts against their source
metadata while retaining all 600 source journals.

This establishes both fidelity and practical shared-host cost for gzip
level 6. It does not itself delete data. A manual reclamation workflow now
creates a deterministic plan containing every exact source and companion
path, byte count, and SHA-256, and binds it with a plan checksum. Apply
mode requires that checksum, verifies the complete plan before any
deletion, re-verifies each part immediately before unlinking only its
`.jsonl` source, and leaves source metadata, gzip data, and compression
metadata intact. No plan has yet been generated or applied on the VPS.

## Maker versus taker safeguard

A market order is always a taker order. A normal limit order can also be a taker if its price immediately matches the opposite side of the book.

A Post Only order, called Limit Maker on some Binance surfaces, changes this behavior: the exchange may place it on the book as maker liquidity, but must reject it if it would execute immediately. This prevents an intended maker order from unexpectedly paying taker fees when the book changes between decision and arrival.

## Initial economic screen

On 2026-08-06, the first reproducible no-look-ahead screen processed the
clean 56.1-hour manifest-backed run from verified gzip journals. An
independent Binance/Bybit/Kraken reference composite produced 2,670
high-confidence Coinbase `EURC-USDC` checkpoint samples.

The median absolute Coinbase mid dislocation was `0.43 bp`, P95 was
`1.73 bp`, P99 was `2.60 bp`, and the maximum was `4.33 bp`. Only 70
samples, `2.62%`, reached 2 bp; 17 reached 3 bp; none reached 5 bp. The
result was stable under 1, 2, and 3 bp reference-consensus filters and
identical when reading retained source rather than gzip.

Those observations formed 62 distinct 2+ bp episodes. Within 60 seconds,
43 saw correctly sided aggressive trades at or through the hypothetical
maker price, but only 14 cleared the initially visible queue and only 13
cleared that queue plus a 100 EURC order. The 1,000 EURC sensitivity had
eight proxy full fills and approximately `1.25 USDC/day` gross
mark-to-fair, falling to approximately `0.47 USDC/day` after a simple
2 bp buffer and before exit, inventory, or rebalance costs. No 10,000
EURC order cleared in the proxy.

This is evidence of thin gross margins, not a profitability result. The
only justified next build is a focused delta-aware replay of those 62
episodes with queue evolution, markouts, exits, finite inventory, and
explicit costs. The full method and result are in
`research/initial-edge-screen-2026-08-06.md`.

## Free cross-regime historical screen

A follow-up no-auth import processed 24 free first-of-month days from
2024-09 through 2026-08. The independently audited archive contains
13,424,304 events across approximately 575 observed daily hours.

The larger sample found occasional material checkpoints: absolute
dislocation had a `0.60 bp` median, `1.93 bp` P95, `2.90 bp` P99, and
`7.32 bp` maximum. Of 8,255 strict-consensus samples, 377 reached 2 bp,
65 reached 3 bp, and seven reached 5 bp.

Those observations formed 240 episodes. Within 60 seconds, 168 saw a
correctly sided trade at or through the hypothetical maker price, but
only 22 cleared the visible queue and only 20 cleared the queue plus 100
EURC. At 1,000 EURC, nine proxy fills produced approximately
`0.15 USDC/day` gross mark-to-fair and `0.06 USDC/day` after a simple
2 bp buffer. The only 5,000/10,000 EURC clearance was one event on
2025-01-01.

This broader evidence changes the checkpoint classification but not the
economic decision. Material-looking percentage differences exist
occasionally; scalable completed-cycle proceeds do not. The current
Coinbase maker corridor is a no-go. Full details are in
`research/free-history-edge-screen-2026-08-06.md`.

## Current conclusion

No edge has been proven. The four-venue bounded public collector is
deployed and completed its bounded 72-hour validation gate. The final
immutable pilot and all 600 compressed representations pass integrity and
provenance checks, while the corrected Coinbase run is collecting under a
distinct run ID. The reviewed VPS reclamation completed and the archive
passes as 600 gzip-only parts while the local source mirror remains
available. The initial and free cross-regime screens now support an
economic no-go for the current thesis. Do not expand into general
strategy or execution infrastructure. One or two more live weeks may
confirm the current regime, but a positive decision would require
materially different fees, access, or market structure rather than more
of the same engineering.

## Coinbase/Jupiter experiment boundary

On 2026-08-06, a separate market-structure experiment was approved after the
original maker corridor was classified as an economic no-go. It tests native
Solana EURC/USDC router output against the Coinbase `EURC-USDC` book at exact
input sizes of 1,000 and 10,000 in both directions.

The implementation is public and quote-only. It sends no taker or wallet,
requires returned transaction and taker fields to remain null, and persists
request/receive latency, route, swap type, exact amounts, and fee estimates.
It remains optional in collector configuration. The first deployment enabled
it as a fourteenth feed without adding another process or any authenticated
surface.

The offline screen reconstructs Coinbase depth from checkpoints and deltas
and makes the Jupiter quote available only at local receive time. It rejects
insufficient or ineligible CEX state, models Coinbase fee plus configurable
Solana cost and execution buffer, and applies a 3 bp decision threshold. A
second qualifying quote at least two seconds later is recorded only as
sampled persistence, not proof of continuous executability.

The first deployment produced 14,529 eligible comparisons over 9.47 hours
before observed Jupiter response variants exposed parser and
reconnect-lifecycle defects. No gross comparison reached 1 bp and no modeled
comparison was non-negative. After clean shutdown, the run became fully
immutable with 2,304,010 contiguous events and both provenance manifests; its
formal replay exactly matched the provisional screen. This result rejects a
conspicuous recurring edge in that window, while the repaired 24-hour run
tests whether the same conclusion holds without collection defects. The
defects and exact result are documented in
`research/initial-jupiter-edge-screen-2026-08-07.md`. The next gate is a
single repaired 24-hour confirmation, not an automatic seven-day extension.
A positive public quote result would still require a reviewed shadow
execution model before any wallet or transaction work could be considered.

The repaired confirmation subsequently supplied 124,149 eligible comparisons
over 72.49 hours of daily finalized journals. Four isolated 1,000-size quotes
cleared the modeled 3 bp threshold, with modeled maxima of 14.09 bp buying on
Jupiter and 12.71 bp buying on Coinbase. None remained above threshold at the
next same-route observation, approximately 8.4 seconds later. Only eight
comparisons were modeled non-negative across the full sample; neither 10,000
route had a non-negative modeled result.

This changes the result from "no observed anomaly" to "rare, unconfirmed
public-quote anomaly," not to a proven edge. Passive four-route collection
has completed its information gate. The detailed evidence and bounded
follow-up boundary are in
`research/repaired-jupiter-edge-screen-2026-08-10.md`.
