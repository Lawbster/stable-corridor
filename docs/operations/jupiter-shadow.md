# Jupiter public quote experiment

## Boundary

This experiment adds one optional public Jupiter feed to the existing
`stable-corridor-collector`. It does not add another PM2 process and contains
no wallet, secret, signing, transaction, transfer, or order path.

Leaving `jupiter` absent from the ignored runtime `collector.json` preserves
the existing 13-feed behavior. Adding the reviewed block enables a four-probe
public quote sweep and raises the expected health count to 14 feeds.

## Runtime configuration

Add this top-level member to
`/opt/stable-corridor/config/collector.json`:

```json
"jupiter": {
  "product": "EURC-USDC",
  "inputAmounts": [
    "1000",
    "10000"
  ],
  "minimumRequestIntervalMs": 2100,
  "retryDelayMs": 5000,
  "staleAfterMs": 30000,
  "maxResponseBytes": 262144
}
```

The configuration parser accepts only the reviewed product, both reviewed
sizes exactly once, and a request interval of at least 2,000 milliseconds.

## Targeted deployment

From `/opt/stable-corridor`, after reviewing the change:

```text
git pull --ff-only
npm ci
npm run check
export STABLE_CORRIDOR_COMMIT_SHA="$(git rev-parse HEAD)"
export STABLE_CORRIDOR_NODE="$(command -v node)"
pm2 restart stable-corridor-collector --update-env
pm2 status stable-corridor-collector
pm2 logs stable-corridor-collector --lines 100 --nostream
```

Operate only the named Stable Corridor process. Do not use a command that
targets every PM2 process.

Within approximately ten seconds, health should show:

```text
jupiter | EURC-USDC | healthy
```

The collector should remain credential-free. A quote response with a
transaction or taker is a schema failure, not something to execute.

## Observation gate

The first deployment already provided a 9.47-hour provisional negative
screen. After the bounded response/reconnect repair, use one clean 24-hour
confirmation. Stop this route if no gross 1 bp observation appears. Extend
only when that threshold produces enough evidence to justify more collection.

Check:

```text
pm2 status stable-corridor-collector
pm2 logs stable-corridor-collector --lines 100 --nostream
cat /var/lib/stable-corridor/state/collector-health.json
du -sb /var/lib/stable-corridor/data
df -B1 /
free -h
```

The offline scanner reads finalized journal parts. Jupiter quote journals may
remain `.open` because they grow much more slowly than book-delta journals.
At the chosen analysis boundary, perform one deliberate targeted collector
restart to finalize the current parts, wait for all 14 feeds to become
healthy again, then pull and audit the mirror.

## Offline analysis

After building locally and pulling the finalized journals:

```text
npm run analyze:cex-dex -- \
  --data-root <verified-data-root> \
  --output <absolute-report-path> \
  --run-id <collector-run-id> \
  --coinbase-fee-bps 0.1 \
  --network-fee-usdc 0.01 \
  --execution-buffer-bps 2 \
  --decision-threshold-bps 3 \
  --persistence-horizon-ms 2000
```

The scanner:

- reconstructs Coinbase depth from checkpoints and absolute deltas;
- uses only the Coinbase state available when each Jupiter response arrived;
- rejects unhealthy, missing, crossed, or insufficient Coinbase books;
- measures both `buy Jupiter / sell Coinbase` and
  `buy Coinbase / sell Jupiter`;
- reports zero-fee, 0.1 bp, and 0.45 bp Coinbase fee sensitivities;
- labels two-second evidence as sampled rather than continuous persistence.

The result remains a public-quote screen, not a profitability result. A
positive result would authorize a more realistic shadow execution model for
review, not wallet or order code.

## Stop rule

Do not expand the experiment when a sufficiently observed run has no modeled
3 bp opportunities after the selected fee, network-cost, and execution
buffer assumptions. Do not let an isolated maximum override the route-size
distribution, persistence result, or depth-rejection counts.
