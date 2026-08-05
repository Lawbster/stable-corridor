#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/pull-vps-data.sh [--dry-run] [--no-data] [user@host]

The remote may instead be supplied through STABLE_CORRIDOR_REMOTE.

Options:
  --dry-run  Show what rsync would transfer without transferring files.
  --no-data  Pull only state, incidents, and logs.
  --help     Show this help.

Optional environment:
  STABLE_CORRIDOR_SSH_KEY             SSH private key path.
  STABLE_CORRIDOR_SSH_PORT            SSH port.
  STABLE_CORRIDOR_RSYNC_BWLIMIT_KBPS  Rsync bandwidth limit in KiB/s.
EOF
}

fail() {
  printf 'Stable Corridor sync error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    fail "required command is unavailable: $1"
}

dry_run=0
pull_data=1
remote="${STABLE_CORRIDOR_REMOTE:-}"

while (($# > 0)); do
  case "$1" in
    --dry-run)
      dry_run=1
      ;;
    --no-data)
      pull_data=0
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    -*)
      fail "unknown option: $1"
      ;;
    *)
      [[ -z "$remote" ]] ||
        fail "remote was supplied more than once"
      remote="$1"
      ;;
  esac
  shift
done

[[ -n "$remote" ]] || {
  usage >&2
  exit 2
}

if [[ ! "$remote" =~ ^[A-Za-z0-9._-]+@([A-Za-z0-9._-]+|\[[0-9A-Fa-f:]+\])$ ]]; then
  fail "remote must use the form user@host"
fi

for command_name in date find grep mkdir rsync ssh ssh-add; do
  require_command "$command_name"
done

script_directory="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd -P
)"
repository_root="$(
  cd -- "${script_directory}/.." >/dev/null 2>&1
  pwd -P
)"

[[ -f "${repository_root}/package.json" ]] ||
  fail "repository package.json was not found"
grep -Eq '"name"[[:space:]]*:[[:space:]]*"stable-corridor"' \
  "${repository_root}/package.json" ||
  fail "resolved directory is not the Stable Corridor repository"

data_directory="${repository_root}/data"
state_directory="${repository_root}/state"
incidents_directory="${repository_root}/incidents"
logs_directory="${repository_root}/logs"

mkdir -p \
  "$data_directory" \
  "$state_directory" \
  "$incidents_directory" \
  "$logs_directory"

ssh_key="${STABLE_CORRIDOR_SSH_KEY:-${HOME}/.ssh/id_ed25519}"
[[ -f "$ssh_key" ]] || fail "SSH key was not found: $ssh_key"

if [[ -z "${SSH_AUTH_SOCK:-}" ]] || ! ssh-add -l >/dev/null 2>&1; then
  eval "$(ssh-agent -s)" >/dev/null
  ssh-add "$ssh_key"
fi

ssh_arguments=(-i "$ssh_key" -o IdentitiesOnly=yes)
rsync_ssh="ssh -i ${ssh_key} -o IdentitiesOnly=yes"

if [[ -n "${STABLE_CORRIDOR_SSH_PORT:-}" ]]; then
  [[ "$STABLE_CORRIDOR_SSH_PORT" =~ ^[0-9]+$ ]] ||
    fail "STABLE_CORRIDOR_SSH_PORT must be numeric"
  ssh_arguments+=(-p "$STABLE_CORRIDOR_SSH_PORT")
  rsync_ssh+=" -p ${STABLE_CORRIDOR_SSH_PORT}"
fi

rsync_arguments=(
  -r
  -z
  --compress-level=1
  --no-times
  --partial
  --human-readable
  --info=progress2
  --protect-args
  --rsync-path="nice -n 10 rsync"
  -e "$rsync_ssh"
)

if [[ -n "${STABLE_CORRIDOR_RSYNC_BWLIMIT_KBPS:-}" ]]; then
  [[ "$STABLE_CORRIDOR_RSYNC_BWLIMIT_KBPS" =~ ^[1-9][0-9]*$ ]] ||
    fail "STABLE_CORRIDOR_RSYNC_BWLIMIT_KBPS must be a positive integer"
  rsync_arguments+=(
    "--bwlimit=${STABLE_CORRIDOR_RSYNC_BWLIMIT_KBPS}"
  )
fi

if ((dry_run == 1)); then
  rsync_arguments+=(--dry-run)
fi

printf 'Stable Corridor pull-only sync\n'
printf 'Remote: %s\n' "$remote"
printf 'Local:  %s\n\n' "$repository_root"

ssh "${ssh_arguments[@]}" "$remote" \
  "command -v nice >/dev/null &&
   command -v rsync >/dev/null &&
   test -r /var/lib/stable-corridor/data &&
   test -r /var/lib/stable-corridor/state &&
   test -r /var/lib/stable-corridor/incidents &&
   test -r /var/log/stable-corridor" ||
  fail "one or more reviewed remote paths are unavailable"

printf 'Syncing mutable state...\n'
rsync "${rsync_arguments[@]}" --ignore-times \
  "${remote}:/var/lib/stable-corridor/state/" \
  "${state_directory}/"

printf '\nSyncing incidents...\n'
rsync "${rsync_arguments[@]}" --ignore-times \
  "${remote}:/var/lib/stable-corridor/incidents/" \
  "${incidents_directory}/"

printf '\nSyncing Stable Corridor application logs...\n'
rsync "${rsync_arguments[@]}" --ignore-times \
  "${remote}:/var/log/stable-corridor/" \
  "${logs_directory}/"

if ((pull_data == 1)); then
  printf '\nSyncing normalized journals...\n'
  rsync "${rsync_arguments[@]}" --size-only \
    "${remote}:/var/lib/stable-corridor/data/" \
    "${data_directory}/"
fi

removed_open_files=0
if ((dry_run == 0 && pull_data == 1)); then
  while IFS= read -r -d '' open_file; do
    closed_file="${open_file%.open}"
    if [[ -f "$closed_file" || -f "${closed_file}.gz" ]]; then
      rm -- "$open_file"
      ((removed_open_files += 1))
    fi
  done < <(
    find "$data_directory" -type f -name '*.jsonl.open' -print0
  )
fi

printf '\nSync complete: '
date -u
if ((removed_open_files > 0)); then
  printf 'Removed %d obsolete local .open duplicate(s).\n' \
    "$removed_open_files"
fi
