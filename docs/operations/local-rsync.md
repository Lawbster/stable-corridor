# Local WSL Runtime Mirror

This pull-only workflow copies the Stable Corridor collector artifacts from
the VPS into Git-ignored directories in the local repository.

## Scope

| VPS source | Local destination | Behavior |
|---|---|---|
| `/var/lib/stable-corridor/data/` | `data/` | Incremental normalized-journal transfer |
| `/var/lib/stable-corridor/state/` | `state/` | Always refresh mutable snapshots |
| `/var/lib/stable-corridor/incidents/` | `incidents/` | Incremental incident transfer |
| `/var/log/stable-corridor/` | `logs/` | Incremental collector log transfer |

The script does not access `/opt/bybit-rev`, copy all PM2 logs, copy the VPS
checkout, or copy configuration, environment, credentials, or future
secrets. It never writes to or deletes from the VPS.

Stable Corridor's PM2 output and error files already live under its
dedicated `/var/log/stable-corridor/` directory. Copying
`/home/deploy/.pm2/logs/` would unnecessarily mix unrelated project logs
into this repository.

## First use

Run from WSL:

```sh
cd /mnt/c/Users/emile/dev/Venzen/venzen-finance/stable-corridor

export STABLE_CORRIDOR_REMOTE="deploy@your-vps-host"

# Cache the key in this WSL shell so its passphrase is entered once.
if ! ssh-add -l >/dev/null 2>&1; then
  eval "$(ssh-agent -s)"
  ssh-add ~/.ssh/id_ed25519
fi

bash scripts/pull-vps-data.sh --dry-run
bash scripts/pull-vps-data.sh
```

The remote is intentionally not committed. It may alternatively be passed
as the final argument:

```sh
bash scripts/pull-vps-data.sh deploy@your-vps-host
```

The default SSH key is `~/.ssh/id_ed25519`. Override it when necessary:

```sh
export STABLE_CORRIDOR_SSH_KEY="$HOME/.ssh/another_key"
```

The script uses the current SSH agent. As a fallback, it starts an agent and
adds the key for the duration of that invocation when no identity is loaded.
Running the cache block above in the interactive WSL shell preserves the
agent environment for subsequent pulls in that shell.

## Routine use

Pull everything:

```sh
bash scripts/pull-vps-data.sh
```

Pull only health, incidents, and logs:

```sh
bash scripts/pull-vps-data.sh --no-data
```

Preview a pull:

```sh
bash scripts/pull-vps-data.sh --dry-run
```

For a shared or constrained network, an optional bandwidth ceiling is
available in KiB/s:

```sh
export STABLE_CORRIDOR_RSYNC_BWLIMIT_KBPS=20000
bash scripts/pull-vps-data.sh
```

Remote rsync runs at reduced CPU scheduling priority and uses low-level
compression. Interrupted files are retained locally for an efficient
subsequent retry.

## Journal consistency

Files ending in `.jsonl.open` are live, mutable journal parts and may end
with a partial line if they change during transfer. Research and replay
should consume only closed `.jsonl` or verified `.jsonl.gz` files after
their `.jsonl.meta.json` source metadata is present and verified. A stored
gzip additionally requires matching `.jsonl.gz.meta.json` compression
metadata.

When a later pull receives a closed `.jsonl` file, the script removes only
the obsolete local `.jsonl.open` file with the exact same base name. It
does not apply broad local deletion or mirror remote retention deletions.

The data rsync deliberately does not use `--delete`. If a reviewed VPS
reclamation later removes a closed `.jsonl` source, subsequent pulls keep
the already verified local `.jsonl` copy while continuing to receive new
gzip and metadata artifacts. This behavior is intentional: reclaiming VPS
capacity does not shrink the local research mirror. Complete and audit a
local pull before approving any remote source reclamation.

The local directories are excluded by `.gitignore`. Before the initial
full pull, confirm that the Windows drive has enough free space:

```sh
df -h /mnt/c
```

This mirror is a working research copy, not an independently validated
backup policy.

## Audit the local mirror

After a pull, verify every immutable part and measure its compression
potential:

```sh
npm run audit:data
```

The command:

- reads only closed `.jsonl` or verified `.jsonl.gz` parts for analytical
  metrics;
- verifies the route, byte count, event count, timestamps, and SHA-256
  against each matching `.meta.json`;
- verifies stored gzip content and its immutable compression metadata when
  present;
- reports mutable `.jsonl.open` parts separately, including partial tails;
- reports coverage, event rates, event-type-isolated source-to-receive
  latency, feed-state and trade-continuity reasons, ingest-sequence
  observations, and run-manifest coverage;
- streams each closed part through gzip level 6 to measure a real
  compression ratio without creating or changing journal files.

The ignored report is written to `state/dataset-audit.json`. For a quicker
integrity pass without compression measurement:

```sh
npm run audit:data -- --compression none
```

An integrity failure returns a non-zero exit code. A passing audit means
the closed journal subset is ready for research tooling; it does not by
itself authorize live calibration or execution.
