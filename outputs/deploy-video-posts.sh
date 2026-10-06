#!/usr/bin/env bash
set -euo pipefail
umask 077
key_location=${1:?Usage: bash deploy-video-posts.sh SSH_KEY_FILE_OR_DIRECTORY}
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
archive="$bundle_dir/video-posts-app.tar.gz"
[[ -f "$archive" ]] || { echo 'Put video-posts-app.tar.gz beside this script.' >&2; exit 1; }
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
mkdir -p "$tmp/payload/public"
tar -xzf "$archive" -C "$tmp/payload" -- server.mjs owned-video.mjs public/admin-upload.js public/youtube-embed.css
stage=$(ssh "${ssh_options[@]}" "$target" 'mktemp -d /tmp/myhiphopblog-video-XXXXXXXX')
[[ "$stage" =~ ^/tmp/myhiphopblog-video-[A-Za-z0-9]+$ ]] || { echo 'Invalid staging directory.' >&2; exit 1; }
ssh "${ssh_options[@]}" "$target" "mkdir -p '$stage/public'"
# Reuse the authenticated SSH connection; no credential is included in the payload.
scp_options=(-F /dev/null -P 22 -i "$tmp/identity" -o IdentitiesOnly=yes -o StrictHostKeyChecking=ask -o "ControlPath=$tmp/connection")
for name in server.mjs owned-video.mjs public/admin-upload.js public/youtube-embed.css; do
  scp "${scp_options[@]}" "$tmp/payload/$name" "$target:$stage/$name"
done
ssh "${ssh_options[@]}" "$target" bash -s -- "$stage" <<'REMOTE_DEPLOY'
set -euo pipefail
stage=$1
app=/opt/myhiphopblog
[[ -d "$app" ]] || { echo 'Application directory not found.' >&2; exit 1; }
check_file() {
  local name=$1 expected_old=$2 expected_new=$3 actual=MISSING
  [[ -f "$app/$name" ]] && actual=$(sha256sum "$app/$name" | cut -d ' ' -f 1)
  [[ "$actual" == "$expected_old" || "$actual" == "$expected_new" ]] || { echo "Deployment stopped: remote $name differs from the tested checkout. No production files were changed." >&2; exit 1; }
  [[ $(sha256sum "$stage/$name" | cut -d ' ' -f 1) == "$expected_new" ]] || { echo "Invalid payload: $name" >&2; exit 1; }
}
check_file "server.mjs" "d75240e363d3964b35cd6be49e630dd13cdb5a18200b3be2c7b5a1f5dfc8ef45" "4e98ad79b8a36bee8ebf64f0713ebb75d30ec3fd43888aec7336f5ae6d067c0b"
check_file "owned-video.mjs" "MISSING" "e81771a4bcb67adbb06ca8f6f7136f865453f3ad96e8043cba8e06e8fdabf6c9"
check_file "public/admin-upload.js" "310193a1e31d664cae7df8a4eeb576f29e702317dc5d421f83b7ce1682b641b4" "29e831fbc170c5378e3893118f2417668b77152c4cb8663d513eae7f1ddc2d78"
check_file "public/youtube-embed.css" "48542abcb1c20989d9eb083acc11a76b61bde596d1c0f5ac926959a04ca13828" "b6acb8e8137b882071703b0539c4b89c368ddfe5937b497d576e7ed62c9dd4df"
node --check "$stage/server.mjs"
node --check "$stage/owned-video.mjs"
node --check "$stage/public/admin-upload.js"
backup="$app/backups/$(date -u +%Y%m%dT%H%M%SZ)-video-posts-$$"
mkdir -p "$backup/public"
files=(server.mjs owned-video.mjs public/admin-upload.js public/youtube-embed.css)
for name in "${files[@]}"; do
  if [[ -f "$app/$name" ]]; then cp -p -- "$app/$name" "$backup/$name"; fi
done
changed=0
on_exit() {
  status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$changed" == 1 ]]; then
    echo 'Validation failed; restoring the backed-up application files.' >&2
    for name in "${files[@]}"; do
      if [[ -f "$backup/$name" ]]; then cp -p -- "$backup/$name" "$app/$name"; else rm -f -- "$app/$name"; fi
    done
    pm2 restart myhiphopblog || true
  fi
  rm -rf -- "$stage"
  exit "$status"
}
trap on_exit EXIT
changed=1
for name in "${files[@]}"; do install -m 644 -- "$stage/$name" "$app/$name"; done
cd "$app"
pm2 restart myhiphopblog
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const a=JSON.parse(s).find(a=>a.name==="myhiphopblog");if(a?.pm2_env?.status!=="online")process.exit(1);console.log("PM2: online")})'
healthy=0
for attempt in {1..15}; do
  if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3020/health | grep -q '"ok":true'; then healthy=1; break; fi
  sleep 1
done
[[ "$healthy" == 1 ]] || { echo 'Local health validation failed.' >&2; exit 1; }
curl --fail --silent --show-error --max-time 20 https://myhiphopblog.chkontog.com/health | grep -q '"ok":true'
if [[ -f .env ]]; then
  node --env-file=.env --input-type=module <<'LIVE_CHECK'
const base=`http://127.0.0.1:${process.env.PORT || 3020}`;
if (!process.env.ADMIN_PASSWORD) {
  console.log('Health passed. Admin form requires manual verification: ADMIN_PASSWORD is not provided by .env.');
} else {
  const login=await fetch(base+'/admin/login',{method:'POST',redirect:'manual',body:new URLSearchParams({password:process.env.ADMIN_PASSWORD})});
  if(login.status!==302 || !login.headers.get('set-cookie')) throw new Error('Admin login validation failed');
  const response=await fetch(base+'/admin',{headers:{cookie:login.headers.get('set-cookie').split(';',1)[0]}});
  const html=await response.text();
  if(!response.ok || !html.includes('name="video_file"')) throw new Error('Video upload form validation failed');
  console.log('Live video upload form: verified');
}
LIVE_CHECK
else
  echo 'Health passed. Verify the video upload field in the admin panel manually.'
fi
printf 'Deployment completed. Backup: %s\n' "$backup"
REMOTE_DEPLOY
stage=''
