# Bounded Collector Pilot

**Status:** deployed; bounded validation in progress
**Authorized process:** `stable-corridor-collector` only

This runbook installs the public, unauthenticated collector without
touching any other repository or PM2 process.

## Supervisor policy

The pilot uses one PM2 fork-mode instance and explicitly disables PM2
automatic restart. Venue transport failures are handled by the collector's
bounded reconnect loop. A process-level exit after a journal, health, or
storage failure remains stopped for operator inspection.

The collector requires no API key or exchange environment variable.

## Preflight

Run these commands from the Stable Corridor checkout:

```sh
cd /opt/stable-corridor
git status --short
node --version
which node
pm2 --version
df -h /
free -h
nproc
```

Required results:

- the checkout is clean;
- Node is in the supported 24.x line;
- `command -v node` returns an absolute path and the reported version is
  Node 24.x; that exact path is pinned in PM2;
- at least 40 GiB remains free on the filesystem holding the data root;
- no process named `stable-corridor-collector` already exists unless this
  is an intentional targeted update.

## Build

```sh
cd /opt/stable-corridor
npm ci
npm run check
npm run build
```

Do not continue if any gate fails.

`config/collector.json` is host-local and is not replaced by Git. For an
update that changes reviewed runtime defaults, apply the corresponding
approved values to that file explicitly before restarting. Never overwrite
the host configuration wholesale without reviewing the diff.

## Runtime directories and configuration

Use the identity that owns the existing deployment PM2 daemon:

```sh
SC_SERVICE_USER="$(id -un)"
SC_SERVICE_GROUP="$(id -gn)"
sudo install -d -o "$SC_SERVICE_USER" -g "$SC_SERVICE_GROUP" -m 0750 \
  /var/lib/stable-corridor \
  /var/lib/stable-corridor/data \
  /var/lib/stable-corridor/state \
  /var/lib/stable-corridor/incidents \
  /var/log/stable-corridor
umask 077
cp -n config/collector.example.json config/collector.json
chmod 0600 config/collector.json
```

Review `config/collector.json` before starting. The pilot defaults are:

- data ceiling: 10 GiB;
- filesystem free-space reserve: 40 GiB;
- journal part ceiling: 512 MiB;
- persisted book depth: 20 levels per side;
- periodic checkpoint: 60 seconds;
- health publication: 30 seconds;
- public REST request timeout: 10 seconds.

No automatic retention deletion exists. Reaching either storage limit
causes a clean collector stop.

Each collector start creates an immutable
`data/runs/<collectorRunId>/start.json` record containing the deployed
commit, canonical configuration hash, reviewed public configuration, Node
runtime, and start time. A graceful stop adds an immutable `end.json` with
the stop reason, exit code, and journal error count. A missing end record
therefore remains visible as an incomplete or ungraceful run.

## First start

```sh
cd /opt/stable-corridor
export STABLE_CORRIDOR_COMMIT_SHA="$(git rev-parse HEAD)"
export STABLE_CORRIDOR_NODE="$(command -v node)"
pm2 start ecosystem.config.cjs --only stable-corridor-collector
pm2 save
pm2 describe stable-corridor-collector
pm2 logs stable-corridor-collector --lines 100
```

After approximately 60 seconds:

```sh
cat /var/lib/stable-corridor/state/collector-health.json
du -sh /var/lib/stable-corridor/data
df -h /
```

Accept the start only if journals exist under the isolated data root, the
health file is fresh, feeds progress to healthy, and the other PM2
processes remain unchanged.

## Targeted operations

```sh
pm2 status stable-corridor-collector
pm2 logs stable-corridor-collector --lines 200
pm2 stop stable-corridor-collector
pm2 start stable-corridor-collector
```

Never use a global PM2 restart or delete command.

## Targeted update

Record the current commit before changing it. Build and test the new
checkout before replacing the named process:

```sh
cd /opt/stable-corridor
git rev-parse HEAD
npm ci
npm run check
npm run build
export STABLE_CORRIDOR_COMMIT_SHA="$(git rev-parse HEAD)"
export STABLE_CORRIDOR_NODE="$(command -v node)"
pm2 restart ecosystem.config.cjs \
  --only stable-corridor-collector \
  --update-env
pm2 save
```

## Rollback

Check out the previously recorded reviewed commit, rebuild it, then restart
only the collector:

```sh
cd /opt/stable-corridor
git checkout --detach <previous-reviewed-commit>
npm ci
npm run check
npm run build
export STABLE_CORRIDOR_COMMIT_SHA="$(git rev-parse HEAD)"
export STABLE_CORRIDOR_NODE="$(command -v node)"
pm2 restart ecosystem.config.cjs \
  --only stable-corridor-collector \
  --update-env
pm2 save
```

Do not delete collected journals during rollback. Closed parts are
immutable and include checksummed metadata.

## Measurement schedule

At approximately 24, 48, and 72 hours, record:

```sh
date -u
du -sb /var/lib/stable-corridor/data
du -sh /var/lib/stable-corridor/data
df -B1 /
pm2 describe stable-corridor-collector
cat /var/lib/stable-corridor/state/collector-health.json
```

Use the observed bytes per day to project 45- and 60-day retention before
purchasing or attaching a volume.

## Local runtime mirror

The WSL pull-only rsync workflow for normalized journals, health state,
incidents, and dedicated collector logs is documented in
`docs/operations/local-rsync.md`. It does not access the HYPE checkout,
global PM2 logs, host configuration, or secrets.
