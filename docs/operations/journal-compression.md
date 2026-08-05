# Verified Journal Compression and Source Reclamation

**Status:** compression implemented and verified; reclamation planning
implemented; no VPS reclamation plan has been applied

Stable Corridor creates verified gzip copies of immutable closed journals.
Compression never changes or removes a `.jsonl` source, `.jsonl.open`
file, journal metadata file, run manifest, or unrelated path.

Source reclamation is a separate manual workflow. Its default planning
mode performs no data-root deletion. Apply mode is checksum-gated and may
remove only the exact `.jsonl` sources listed in a reviewed plan.

## Stored format

For a closed part:

```text
trade-000001.jsonl
trade-000001.jsonl.meta.json
```

compression adds:

```text
trade-000001.jsonl.gz
trade-000001.jsonl.gz.meta.json
```

The compression metadata records:

- gzip algorithm and level;
- source and compressed filenames and byte counts;
- source journal, source metadata, and compressed-file SHA-256 values;
- creation time.

Before publication, the source byte count and SHA-256 must match the
immutable journal metadata. After publication, the gzip is decompressed
and checked against the same source byte count and SHA-256. Output and
metadata use exclusive atomic publication, so an existing artifact is
verified rather than overwritten.

The journal writer treats a `.jsonl.gz` part number as occupied even when
the corresponding source is absent. The audit accepts and verifies both
source-plus-gzip and gzip-only representations.

## Compression

Build and test the reviewed checkout first:

```sh
cd /opt/stable-corridor
npm run check
npm run build
```

Compress and verify one closed part at low CPU and I/O priority:

```sh
nice -n 19 ionice -c 3 \
  npm run compress:data -- \
  --data-root /var/lib/stable-corridor/data \
  --max-parts 1
```

Omit `--max-parts` only after the bounded result is reviewed. The JSON
result reports eligible, newly compressed, already verified, source, and
compressed counts. Repeating a bounded command selects an uncompressed
part before rechecking an existing gzip.

## Reclamation safety contract

Planning scans only closed `.jsonl` files below the resolved
`normalized/` data root. Every candidate must have:

- a regular, non-symlink source and source metadata file;
- no `.jsonl.open` sibling;
- a regular, non-symlink gzip and compression metadata file;
- matching filenames, byte counts, source metadata, and timestamps;
- matching SHA-256 values for the source, source metadata, gzip, and
  compression metadata;
- gzip content that decompresses to the exact source byte count and
  SHA-256.

The deterministic plan stores relative paths, byte counts, hashes, totals,
and a checksum over its canonical contents. Applying it requires the exact
checksum. Apply mode:

1. acquires an exclusive plan lock;
2. verifies the plan checksum and data root;
3. verifies every entry before deleting anything;
4. re-verifies each entry immediately before unlinking its source;
5. deletes only the listed `.jsonl` source;
6. retains `.jsonl.meta.json`, `.jsonl.gz`, and
   `.jsonl.gz.meta.json`;
7. writes an exclusive completion record.

A partial interruption is safe to resume with the same plan and checksum:
already absent sources are accepted only when all retained artifacts still
verify. A completed plan path cannot be overwritten with a new plan. The
workflow is manual and is not called by the collector, PM2, or a timer.

## Read-only VPS plan

First complete a local pull and passing audit. Then generate a plan on the
VPS at low priority:

```sh
cd /opt/stable-corridor

nice -n 19 ionice -c 3 \
  npm run reclaim:data -- \
  --data-root /var/lib/stable-corridor/data \
  --plan /var/lib/stable-corridor/state/source-reclamation-plan.json
```

Planning reads every selected source and decompresses every selected gzip,
so it is intentionally run at low priority. It writes only the plan and
temporary lock under the state root. It does not delete or alter a journal.
Use `--max-parts 1` for a bounded workflow test.

The final JSON line reports:

- `planPath`;
- `planSha256`;
- `plannedParts`;
- exact source and compressed byte totals.

Pull the state directory again and review the plan, local audit, retained
source count, and expected reclaimed bytes. Do not proceed merely because
plan generation succeeded.

## Apply boundary

Apply mode is destructive on the VPS source representation. It requires a
separate explicit approval after review. Its interface is:

```text
npm run reclaim:data -- \
  --data-root <reviewed-data-root> \
  --plan <reviewed-plan-path> \
  --apply \
  --confirm-plan-sha256 <reviewed-plan-sha256>
```

Do not substitute a checksum from an unreviewed or regenerated plan. Do
not manually delete journal sources. If a stale `.lock` remains after an
unclean process exit, inspect its host and PID record before taking any
action; a later invocation removes it automatically only when that local
PID is no longer running.

## Local and gzip-only verification

The pull-only rsync workflow copies gzip files and their metadata but does
not mirror remote deletions. After pulling:

```sh
npm run audit:data -- --compression none
```

The report's `storedCompression` section distinguishes verified
source-plus-gzip and gzip-only parts. Any compressed-content, source,
metadata, checksum, route, or filename mismatch fails the audit.

Historical analysis and replay must stream `.jsonl.gz` data rather than
loading a whole decompressed part into memory. Tools must select one
representation per logical part to avoid double counting, preserve event
ordering from journal fields rather than filesystem order, and verify
metadata before consumption. Compressed journals are for offline
analysis, replay, and incident work; they must never become a real-time
input to a future live decision process.
