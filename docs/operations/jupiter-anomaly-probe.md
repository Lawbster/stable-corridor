# Coinbase/Jupiter anomaly persistence probe

## Decision boundary

The original multi-CEX maker thesis and the passive four-route
Coinbase/Jupiter screen have completed their information gates. This
follow-up answers one narrower question: do rare modeled 3 bp Jupiter
quotes remain available when the same route and size are requested again
at the next keyless API intervals?

The deployed process remains the public-only
`stable-corridor-collector`. The probe contains no API key, wallet, taker,
transaction construction, signing, submission, order, transfer, or
withdrawal path.

## Reviewed feed set

The probe continuously collects only:

- Coinbase `EURC-USDC` public level 2, trades, status, and heartbeats;
- Jupiter public quote-only `EURC-USDC` requests for 1,000 and 10,000
  units in both directions.

Binance, Bybit, Kraken, and Coinbase `USDC-EUR` are omitted from the
runtime configuration. Their adapters remain available for reproducible
historical work, but no disabled venue is instantiated, connected,
checkpointed, or included in collector health.

The reviewed configuration is `config/collector.example.json`. The
Jupiter `anomalyProbe` model uses:

- 0.1 bp Coinbase fee;
- 0.01 USDC modeled Solana cost;
- 2 bp execution buffer;
- 3 bp decision threshold;
- three follow-up requests.

## Trigger behavior

The collector reconstructs only the Coinbase book known when each
Jupiter response arrives. A baseline quote schedules a probe only when:

- Coinbase is healthy and research-eligible;
- a valid non-crossed Coinbase book is available;
- the configured size is executable through the retained depth;
- the modeled net edge reaches at least 3 bp.

The triggering quote is followed by the same direction and size at the
next three request slots, approximately 2.1, 4.2, and 6.3 seconds later.
Those requests temporarily take priority over the round-robin sweep and
cannot recursively schedule another probe.

Every scheduling decision is persisted as a `cex_dex_probe` journal
event. Follow-up `dex_quote` events contain the trigger request ID and
one-based follow-up index. This preserves the model, trigger edge, exact
timing, and linkage required for deterministic replay.

## Deployment gate

Keep the existing gzip-only archive. A new collector run ID and start
manifest provide the analysis boundary; do not wipe the data root.

On the VPS, after pulling the reviewed commit:

```sh
cd /opt/stable-corridor
git status --short
git pull --ff-only
npm ci
npm run check
```

Back up and review the host-local configuration before replacing it with
the narrowed public example:

```sh
cp -p config/collector.json config/collector.before-anomaly-probe.json
diff -u config/collector.json config/collector.example.json || true
install -m 0600 config/collector.example.json config/collector.json
```

Start only the named collector:

```sh
export STABLE_CORRIDOR_COMMIT_SHA="$(git rev-parse HEAD)"
export STABLE_CORRIDOR_NODE="$(command -v node)"
pm2 restart ecosystem.config.cjs \
  --only stable-corridor-collector \
  --update-env
pm2 save
pm2 status stable-corridor-collector
pm2 logs stable-corridor-collector --lines 100 --nostream
```

Within approximately 30 seconds, health must contain exactly two healthy
feeds: Coinbase `EURC-USDC` and Jupiter `EURC-USDC`. No connection log for
Binance, Bybit, or Kraken should appear.

## Observation and stop gate

Run for no more than seven days. Pull and audit the data daily. Analyze a
finalized run with:

```sh
npm run analyze:cex-dex -- \
  --data-root data \
  --output backtests/jupiter-anomaly-probe.json \
  --run-id <collector-run-id> \
  --coinbase-fee-bps 0.1 \
  --network-fee-usdc 0.01 \
  --execution-buffer-bps 2 \
  --decision-threshold-bps 3 \
  --persistence-horizon-ms 2000
```

The `triggeredRequotes` report section separates baseline distributions
from deliberately sampled follow-ups. Stop early after five completed
probes when none remains above threshold at the first follow-up. Proceed
to a separately reviewed unsigned-transaction-construction gate only if
at least two independent probes remain above 3 bp at the first follow-up.

Public requote persistence is not a profitability or transaction-landing
result. A passing probe still does not authorize a wallet, signature,
submission, or authenticated exchange client.

## Daily verified compression timer

The repository supplies a user-level systemd service and timer. Install
them as the same operating-system user that owns the PM2 process and data
root:

```sh
mkdir -p "$HOME/.config/systemd/user"
install -m 0644 deploy/systemd/stable-corridor-compress.service \
  "$HOME/.config/systemd/user/"
install -m 0644 deploy/systemd/stable-corridor-compress.timer \
  "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user start stable-corridor-compress.service
journalctl --user -u stable-corridor-compress.service -n 50 --no-pager
systemctl --user enable --now stable-corridor-compress.timer
systemctl --user list-timers stable-corridor-compress.timer
```

The first manual service start is a bounded production-path check. It
compresses or verifies at most 100 source-present closed parts at idle I/O
priority and low CPU priority.

Confirm that the user manager persists across logout and reboot:

```sh
loginctl show-user "$(id -un)" -p Linger
```

If it reports `Linger=no`, enable lingering explicitly for that service
identity before relying on the timer.

The timer creates and verifies gzip representations only. It never
deletes source journals. Continue to pull and audit locally before using
the separate checksum-gated reclamation workflow.
