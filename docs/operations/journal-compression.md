# Verified Journal Compression

**Status:** implemented as a non-destructive operator command

Stable Corridor can create verified gzip copies of immutable closed
journals. The command never changes or removes a `.jsonl` source,
`.jsonl.open` file, journal metadata file, run manifest, or unrelated path.

## Format

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

## Bounded trial

Build and test the reviewed checkout first. Then compress and verify one
closed part at low CPU and I/O priority:

```sh
cd /opt/stable-corridor
npm run build

nice -n 19 ionice -c 3 \
  npm run compress:data -- \
  --data-root /var/lib/stable-corridor/data \
  --max-parts 1
```

The JSON result reports eligible, newly compressed, already verified,
source, and compressed counts. Repeating the command selects an
uncompressed part before rechecking an existing gzip.

No source-pruning command exists. Do not manually delete `.jsonl` files.
Space reclamation requires a separate operator decision after a complete
pull, local audit, CPU-impact observation, and rollback review.

## Local verification

The pull-only rsync workflow copies gzip files and their metadata. After
pulling:

```sh
npm run audit:data -- --compression none
```

The report's `storedCompression` section distinguishes verified
source-plus-gzip and gzip-only parts. Any compressed-content, source,
metadata, checksum, route, or filename mismatch fails the audit.
