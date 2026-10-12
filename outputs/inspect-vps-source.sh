#!/usr/bin/env bash
set -euo pipefail
umask 077
key_location=${1:?Usage: bash inspect-vps-source.sh SSH_KEY_FILE_OR_DIRECTORY}
key_file="$key_location"
if [[ -d "$key_location" ]]; then
  key_file=''
  for name in id_ed25519 id_rsa id_ecdsa; do
    if [[ -f "$key_location/$name" ]]; then key_file="$key_location/$name"; break; fi
  done
fi
[[ -f "$key_file" ]] || { echo 'No standard private-key filename found. Run again with the full path to the private-key file.' >&2; exit 1; }
tmp=$(mktemp -d)
target=root@89.167.23.230
stage=''
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$stage" ]]; then ssh "${ssh_options[@]}" "$target" "rm -rf -- '$stage'" >/dev/null 2>&1 || true; fi
  ssh "${ssh_options[@]}" -O exit "$target" >/dev/null 2>&1 || true
  rm -rf -- "$tmp"
  exit "$status"
}
# Copy privately to a POSIX filesystem in case the original is on an NTFS disk.
cp -- "$key_file" "$tmp/identity"
chmod 600 "$tmp/identity"
ssh_options=(-F /dev/null -p 22 -i "$tmp/identity" -o IdentitiesOnly=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=ask -o ControlMaster=auto -o ControlPersist=60 -o "ControlPath=$tmp/connection")
if [[ -d "$key_location" && -f "$key_location/known_hosts" ]]; then
  cp -- "$key_location/known_hosts" "$tmp/known_hosts"
  ssh_options+=(-o "UserKnownHostsFile=$tmp/known_hosts")
fi
trap cleanup EXIT
archive="$PWD/vps-current-code.tar.gz"
ssh "${ssh_options[@]}" "$target" bash -s > "$archive" <<'READ_ONLY_SOURCE'
set -euo pipefail
cd /opt/myhiphopblog
files=(server.mjs public/admin-upload.js public/youtube-embed.css package.json)
for name in owned-video.mjs package-lock.json; do
  if [[ -f "$name" ]]; then files+=("$name"); fi
done
tar -czf - -- "${files[@]}"
READ_ONLY_SOURCE
tar -tzf "$archive"
printf 'Source archive created: %s\nNo application files were modified.\n' "$archive"
