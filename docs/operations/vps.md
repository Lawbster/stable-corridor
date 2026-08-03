# VPS Boundaries

**Status:** Bounded public collector deployed; validation in progress.

## Isolation

Stable Corridor must remain independent of the live HYPE deployment.

```text
/opt/bybit-rev          existing HYPE code; out of scope
/opt/stable-corridor    Stable Corridor collector checkout
```

No Stable Corridor process, script, deployment, environment file, or state path may import from, write to, rebuild, clean, restart, or otherwise depend on `/opt/bybit-rev`.

## Planned durable paths

```text
/var/lib/stable-corridor/
  data/
  state/
  incidents/
```

Repository-local `data/` and `state/` are acceptable only for ignored prototype data. Production data must be outside the Git lifecycle.

## Capacity observation

Sanitized filesystem observation from 2026-08-02:

```text
Root filesystem: 75 GB total
Used:            15 GB
Available:       57 GB
Utilization:     21%
```

The root filesystem is shared with HYPE and must not be treated as Stable Corridor data capacity.

Sanitized compute observation from 2026-08-02:

```text
Logical CPUs:        2
Memory:              3.7 GiB total
Memory available:    1.5 GiB
Swap:                2.0 GiB total, effectively unused
Load average:        0.11 / 0.15 / 0.16
Existing PM2 memory: approximately 1.1 GiB across online processes
Node.js:             24.18.1
PM2:                 6.0.14
```

No CPU or RAM upgrade is currently justified. Stage B begins with one bounded collector instance and measures RSS, CPU, event-loop lag, compression load, and impact on available memory.

On 2026-08-02, the operator upgraded the VPS system runtime from Node.js 20.20.2 to Node.js 24.18.1 and confirmed the existing workloads continued running normally. This satisfies Stable Corridor's Node.js 24 LTS target. The deployed PM2 definition pins `/usr/bin/node`, and PM2 reported Node.js 24.18.1 for the process.

### Storage measurement before expansion

The existing workloads reportedly grow by approximately 1 GB every 14 days, or about 0.07 GB/day, before any Stable Corridor collection. With 57 GB free at the observed baseline, no volume purchase is currently justified.

The first bounded collection pilot may use `/var/lib/stable-corridor/data` on the root filesystem only with:

- a 10 GiB collector-data ceiling;
- a 40 GiB minimum filesystem free-space reserve;
- measurements at startup and after approximately 24, 48, and 72 hours;
- separate reporting of open/uncompressed and closed/compressed journal growth;
- a clean ingestion stop when either storage limit is reached;
- deletion and rotation restricted to the resolved Stable Corridor data root.

These pilot limits protect the existing workload while producing the evidence needed to size retention. The 45-60 day target is not accepted until measured daily collector growth is available.

After the first few days, project the required capacity from measured collector growth plus the existing approximately 0.07 GB/day baseline. Attach a dedicated volume only if the desired retention window cannot fit while preserving the root reserve and operational headroom.

Hetzner Cloud Volumes are replicated storage but are not included in server backups or snapshots. After the pilot, explicitly decide whether closed, checksummed daily journals are:

1. reproducible and accepted as unbacked research data; or
2. copied to separate object/archive storage to prevent loss of the 45–60-day observation window.

No volume should be purchased or attached before the measured pilot demonstrates the need.

The deployed pilot currently retains normalized journals uncompressed.
It records checksummed metadata when a part closes and stops at the storage
gate. The first 72-hour measurement must therefore report uncompressed
growth; compression remains a separately reviewed optimization after the
observed event rate and CPU budget are known.

The first approximately 20-hour sample measured `1.81 GiB/day` of
uncompressed Stable Corridor data. Collector RSS was approximately
`233 MiB`, event-loop lag was zero in the sampled health record, and the
collector accounted for approximately `11 MiB` of swap. Root free space
remained above the configured 40 GiB reserve. These are interim
measurements; the 72-hour result remains the capacity gate.

## Reserved PM2 names

```text
stable-corridor-collector
stable-corridor-shadow
stable-corridor-watchdog
```

The deployed `stable-corridor-collector` is the only Stable Corridor PM2
process. The reviewed `ecosystem.config.cjs` defines it in fork mode with
one instance and automatic restart disabled. Venue sessions reconnect
internally. A fatal journal, health, or storage exit remains stopped for
inspection. `stable-corridor-live` is intentionally not defined.

The exact install, targeted operations, rollback, and measurement commands
are in `docs/operations/collector-pilot.md`.

All future commands must target one named process. Never use `pm2 restart all`. The watchdog remains read-only and alert-only; it cannot restart PM2 or write a control signal.

## Secrets

Stage A/B public collection needs no exchange credentials.

If a much later approved phase needs secrets, they belong only in:

```text
/opt/stable-corridor/.env
```

The file must be excluded from Git, separated from the HYPE environment, and mode `0600`. Trading keys must have withdrawals disabled. These notes are a future boundary, not authorization to create keys.

## Deployment inventory

The Stage B deployment records and continues to verify:

- filesystem capacity, mount layout, and minimum free-space reserve;
- CPU, memory, Node.js, PM2, and service-manager versions;
- service identity and directory ownership;
- isolated log and health paths;
- data growth under a measured collection sample;
- exact targeted build, start, stop, status, log, rollback, and deploy commands;
- deployed Git commit;
- proof that Stable Corridor permissions and commands cannot access or restart HYPE.

Do not put hostnames, IP addresses, usernames, tokens, account identifiers, or private service details in this document.
