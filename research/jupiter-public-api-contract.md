# Jupiter public quote contract

Date reviewed: 2026-08-06

## Purpose

This contract authorizes one bounded, unauthenticated observation feed for
testing whether native Solana EURC/USDC quotes differ materially from the
contemporaneous Coinbase `EURC-USDC` order book.

It does not authorize wallet connection, signing, transaction construction,
simulation, submission, account access, token transfer, or trading.

## Approved endpoint

```text
GET https://api.jup.ag/swap/v2/order
```

The request may contain exactly:

```text
inputMint
outputMint
amount
```

It must not contain `taker`, `payer`, referral, platform-fee, transaction,
wallet, or account parameters. The response is accepted only when both
`transaction` and `taker` are null.

The current endpoint and response fields are documented in the official
[Jupiter Swap V2 order reference](https://dev.jup.ag/api-reference/swap/order).

## Approved assets and probes

The experiment uses Circle-issued native Solana tokens:

| Asset | Mint | Decimals |
| --- | --- | ---: |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 |
| EURC | `HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr` | 6 |

The mint identities are published by
[Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses).

Only four exact-input probes are approved:

| Input | Output | Input size |
| --- | --- | ---: |
| USDC | EURC | 1,000 |
| EURC | USDC | 1,000 |
| USDC | EURC | 10,000 |
| EURC | USDC | 10,000 |

The transport spaces requests by at least 2,000 milliseconds. The reviewed
example uses 2,100 milliseconds, producing one complete four-quote sweep in
approximately 8.4 seconds.

## Persisted evidence

Every accepted quote preserves:

- local request-start and receive timestamps;
- exact atomic and human-readable input/output amounts;
- minimum output, fee, price-impact, router, and route-plan fields;
- provider processing time and local end-to-end latency;
- signature, priority, and rent fee estimates;
- request and quote identifiers;
- whether the provider labels the quote gasless or guaranteed.

Amounts remain decimal strings in normalized journals. No private account or
wallet identifier is collected.

Jupiter may express `priceImpactPct` in plain or scientific decimal notation.
Bounded scientific strings are expanded exactly into canonical plain decimal
strings before persistence. Split routes may express `percent` fractionally;
the journal retains the corresponding integer `bps` allocation used by the
economic record.

Jupiter does not provide an authoritative market timestamp for this response.
`sourceTimestampMs` is therefore null. The quote becomes available to replay
only at its local `receivedTimestampMs`.

## Fail-closed conditions

A response is rejected when:

- it is not exact-input;
- its mints or input amount differ from the scheduled probe;
- `transaction` or `taker` is non-null;
- a required economic field is absent or invalid;
- the response exceeds the configured byte bound;
- JSON parsing or schema validation fails.

Failures mark the feed ineligible. Prolonged absence of a successful quote
causes normal collector recovery. No failure path falls back to a private or
transaction-bearing endpoint.

## Economic interpretation

A Jupiter quote is router output, not a standalone order book. Its result may
come from an AMM, RFQ market maker, or another routed source. The route and
swap type must therefore remain attached to each observation.

The first decision gate is deliberately severe:

- compare against the Coinbase book known when the quote was received;
- require sufficient known Coinbase depth for the entire simulated size;
- model the observed Coinbase fee, a configurable network cost, and a 2 bp
  execution buffer;
- count modeled edges at 1, 2, 3, 5, and 10 bp;
- require a 3 bp observation to survive to the next same-route quote at least
  two seconds later before it is even considered for deeper study.

Next-quote confirmation is sampled persistence. It does not prove that an
opportunity remained continuously executable.
