#!/usr/bin/env bash
# The nightly storage backup (2026-10-29): EVERY bucket in Supabase Storage (clipart, fonts,
# garment-swatches, design-exports, customer-uploads, designs, pet-photos — and any bucket added later)
# copied to one Backblaze B2 bucket with rclone, run by .github/workflows/storage-backup.yml at 3:30 AM
# Chicago and by its "Run workflow" button. Modelled on quote-builder's backup with three differences:
# several buckets (the list comes from Supabase itself, so a new bucket is covered automatically and the
# run FAILS if the list comes back empty); files are compared by size AND time, because this app
# overwrites files in place (replacing a mockup, a font, a clipart file, re-saving an order) and a
# same-size replacement would slip past a size-only compare; and the path-to-design manifest comes from
# the app (POST /api/backup/manifest, which reconciles the database's references against this script's
# own listing of the buckets). A file Supabase no longer has is moved, not deleted: to deleted/<date>/ in
# B2, kept KEEP_DAYS days. The job fails when B2 holds fewer files or bytes than Supabase for any bucket.
# healthchecks.io is pinged at the start, on success (with the summary) and on failure. Every credential
# comes from the environment (GitHub secrets): nothing is in the repo. The layout in B2:
#   files/<bucket>/<path>                  every bucket as it is, same paths as Supabase
#   deleted/<YYYY-MM-DD>/<bucket>/<path>   what Supabase no longer had on that day, kept KEEP_DAYS days
#   manifest/manifest.csv                  the newest path-to-design list (ok / orphan / missing per file)
#   manifest/history/manifest-<date>.csv   one per run, kept KEEP_DAYS days
# See BACKUP.md for the setup, the restores and the monitoring. NOT covered: Cloudinary (customer upload
# originals — Part 2, must exist before real orders), the database (Supabase Pro backs it up daily).
set -euo pipefail

# Nothing configured yet (the repo was pushed before the one-time setup in BACKUP.md): say so and stop
# cleanly, so the nightly schedule does not email a failure every day until the secrets exist. Once ANY
# secret is set, a missing one is a real misconfiguration and fails below.
if [ -z "${SUPABASE_S3_ACCESS_KEY_ID:-}${B2_KEY_ID:-}${B2_APPLICATION_KEY:-}${BACKUP_MANIFEST_SECRET:-}" ]; then
  echo "Backup not configured yet: no secrets are set. Follow BACKUP.md → One-time setup, then Run workflow again."
  exit 0
fi

: "${SUPABASE_S3_ACCESS_KEY_ID:?set the GitHub secret SUPABASE_S3_ACCESS_KEY_ID}"
: "${SUPABASE_S3_SECRET_ACCESS_KEY:?set the GitHub secret SUPABASE_S3_SECRET_ACCESS_KEY}"
: "${B2_KEY_ID:?set the GitHub secret B2_KEY_ID}"
: "${B2_APPLICATION_KEY:?set the GitHub secret B2_APPLICATION_KEY}"
: "${B2_BUCKET:?set the GitHub variable B2_BUCKET}"
: "${BACKUP_MANIFEST_SECRET:?set the GitHub secret BACKUP_MANIFEST_SECRET}"
SUPABASE_S3_ENDPOINT="${SUPABASE_S3_ENDPOINT:-https://yatiairlyensmcwbpldx.storage.supabase.co/storage/v1/s3}"
SUPABASE_S3_REGION="${SUPABASE_S3_REGION:-us-west-2}"
MANIFEST_URL="${MANIFEST_URL:-https://create.tshirtdeli.com/api/backup/manifest}"
HEALTHCHECKS_PING_URL="${HEALTHCHECKS_PING_URL:-}"
KEEP_DAYS="${KEEP_DAYS:-90}"
TODAY="$(date -u +%F)"
WORK="$(mktemp -d)"

# rclone's two remotes, from the environment only (no config file): SUPA is Supabase Storage over its S3 endpoint, B2 the backup.
export RCLONE_CONFIG_SUPA_TYPE=s3 RCLONE_CONFIG_SUPA_PROVIDER=Other RCLONE_CONFIG_SUPA_FORCE_PATH_STYLE=true
export RCLONE_CONFIG_SUPA_ACCESS_KEY_ID="$SUPABASE_S3_ACCESS_KEY_ID" RCLONE_CONFIG_SUPA_SECRET_ACCESS_KEY="$SUPABASE_S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_SUPA_ENDPOINT="$SUPABASE_S3_ENDPOINT" RCLONE_CONFIG_SUPA_REGION="$SUPABASE_S3_REGION"
# Compare by the server's own Last-Modified from the listing (no per-object HEAD, one stable stamp per
# object) rather than object metadata — quote-builder saw metadata stamps differ between runs.
export RCLONE_CONFIG_SUPA_USE_SERVER_MODTIME=true
export RCLONE_CONFIG_B2_TYPE=b2 RCLONE_CONFIG_B2_ACCOUNT="$B2_KEY_ID" RCLONE_CONFIG_B2_KEY="$B2_APPLICATION_KEY"
export RCLONE_B2_HARD_DELETE=true   # a delete in B2 is a real delete: the history lives in deleted/<date>, not in B2 file versions

ping() { if [ -n "$HEALTHCHECKS_PING_URL" ]; then curl -fsS -m 10 --retry 3 -o /dev/null "${@:2}" "$HEALTHCHECKS_PING_URL$1" || echo "healthchecks ping$1 did not go through"; fi; }
trap 'echo "BACKUP FAILED"; ping /fail' ERR
ping /start

echo "== 0. which buckets Supabase has"
# The S3 root lists the project's buckets. An empty list is treated as a failure, never as "nothing to do":
# coverage must not silently shrink to zero because a listing call changed.
mapfile -t BUCKETS < <(rclone lsjson "SUPA:" | jq -r '.[] | select(.IsDir) | .Name' | sort)
if [ "${#BUCKETS[@]}" -eq 0 ]; then echo "Supabase returned no buckets — refusing to continue"; false; fi
echo "buckets: ${BUCKETS[*]}"

echo "== 1. files: every bucket -> B2 $B2_BUCKET/files/<bucket> (deletions to deleted/$TODAY/<bucket>)"
for b in "${BUCKETS[@]}"; do
  echo "-- $b"
  rclone sync "SUPA:$b" "B2:$B2_BUCKET/files/$b" --backup-dir "B2:$B2_BUCKET/deleted/$TODAY/$b" \
    --fast-list --transfers 8 --checkers 16 --stats 30s --stats-one-line -v
done

echo "== 2. the path-to-design manifest (the app reconciles its references against this listing)"
: > "$WORK/parts.json"
for b in "${BUCKETS[@]}"; do
  rclone lsjson -R --files-only --no-mimetype "SUPA:$b" | jq -c --arg b "$b" '[.[] | {bucket: $b, path: .Path, bytes: .Size, modified: .ModTime}]' >> "$WORK/parts.json"
done
jq -s '{files: add}' "$WORK/parts.json" > "$WORK/listing.json"
LISTED="$(jq '.files | length' "$WORK/listing.json")"
echo "listed $LISTED files across ${#BUCKETS[@]} buckets"
curl -fsS -m 120 --retry 2 -X POST -H "Authorization: Bearer $BACKUP_MANIFEST_SECRET" -H "Content-Type: application/json" \
  --data-binary "@$WORK/listing.json" -D "$WORK/headers.txt" -o "$WORK/manifest.csv" "$MANIFEST_URL"
head -1 "$WORK/manifest.csv" | grep -q '^bucket,path,bytes,modified,state,' || { echo "the manifest did not come back as expected:"; head -c 300 "$WORK/manifest.csv"; echo; false; }
SUMMARY="$(grep -i '^x-backup-summary:' "$WORK/headers.txt" | tail -1 | cut -d' ' -f2- | tr -d '\r')"
echo "manifest rows: $(($(wc -l < "$WORK/manifest.csv") - 1)) · $SUMMARY"
case "$SUMMARY" in *" missing=0 "*) ;; *) echo "NOTE: some database rows point at files that are not in Supabase any more (state=missing in the manifest) — worth a look, not a backup failure";; esac
rclone copyto "$WORK/manifest.csv" "B2:$B2_BUCKET/manifest/manifest.csv"
rclone copyto "$WORK/manifest.csv" "B2:$B2_BUCKET/manifest/history/manifest-$TODAY.csv"

echo "== 3. the count check, per bucket"
TOTAL_SRC=0; TOTAL_DST=0; SHORT=0
for b in "${BUCKETS[@]}"; do
  SRC="$(rclone size --json "SUPA:$b" --fast-list)"; DST="$(rclone size --json "B2:$B2_BUCKET/files/$b" --fast-list 2>/dev/null || echo '{"count":0,"bytes":0}')"
  SRC_N="$(echo "$SRC" | jq -r .count)"; SRC_B="$(echo "$SRC" | jq -r .bytes)"
  DST_N="$(echo "$DST" | jq -r .count)"; DST_B="$(echo "$DST" | jq -r .bytes)"
  echo "$b: Supabase $SRC_N files, $SRC_B bytes · B2 $DST_N files, $DST_B bytes"
  if [ "$DST_N" -lt "$SRC_N" ] || [ "$DST_B" -lt "$SRC_B" ]; then echo "  B2 is short of Supabase for $b"; SHORT=1; fi
  TOTAL_SRC=$((TOTAL_SRC + SRC_N)); TOTAL_DST=$((TOTAL_DST + DST_N))
done
if [ "$SHORT" -ne 0 ]; then echo "the backup is not complete"; false; fi

echo "== 4. prune deleted/<date> and manifest history older than $KEEP_DAYS days"
CUT="$(python3 -c "import datetime; print((datetime.date.today() - datetime.timedelta(days=$KEEP_DAYS)).isoformat())")"
for d in $(rclone lsf "B2:$B2_BUCKET/deleted" --dirs-only 2>/dev/null | tr -d / || true); do
  if [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [[ "$d" < "$CUT" ]]; then echo "removing deleted/$d"; rclone purge "B2:$B2_BUCKET/deleted/$d"; fi
done
for f in $(rclone lsf "B2:$B2_BUCKET/manifest/history" --files-only 2>/dev/null || true); do
  if [[ "$f" =~ ^manifest-([0-9]{4}-[0-9]{2}-[0-9]{2})\.csv$ ]] && [[ "${BASH_REMATCH[1]}" < "$CUT" ]]; then echo "removing manifest/history/$f"; rclone deletefile "B2:$B2_BUCKET/manifest/history/$f"; fi
done

echo "BACKUP OK: $TOTAL_DST files in B2 (Supabase $TOTAL_SRC) across ${#BUCKETS[@]} buckets, manifest written, history kept $KEEP_DAYS days"
ping "" --data-raw "BACKUP OK: $TOTAL_DST files in B2 (Supabase $TOTAL_SRC), ${#BUCKETS[@]} buckets · $SUMMARY"
