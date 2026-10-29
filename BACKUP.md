# Storage backup

Every file in Supabase Storage (all seven buckets: the Art Library, fonts, garment mockups and
swatches, order previews and exports, the few customer uploads that land in Supabase, and the Shopify
project's pet photos) is copied every night to a Backblaze B2 bucket. Supabase's daily database
backups do not include these files. Built 2026-10-29, modelled on quote-builder's backup.

## What it does not cover

- **Cloudinary.** Customer upload originals live on Cloudinary, not Supabase. Today that is test data
  only; it becomes precious the day real orders start, and reprints are kept forever. **Part 2 of this
  backup must be in place before we take real orders.** Every nightly log prints how many Cloudinary
  files the database points at (`cloudinary_refs_not_in_this_backup=…`) so the gap stays visible.
- **The database.** Supabase (Pro plan) backs it up daily: dashboard → Database → Backups.
- Vercel environment variables, GitHub secrets, anything in Shopify. Keep copies in a password manager.

## What to check, and when

After any change to the backup (workflow, script, keys, secrets):
1. Run it by hand: GitHub → Actions → Storage backup → Run workflow.
2. Wait for it to finish. It should be green and end with BACKUP OK.
3. Check healthchecks.io shows a fresh ping.
If it's red, send the error lines to Claude Code. Never send keys.

Every night (automatic, nothing to do):
- healthchecks.io emails you if a nightly run is missed or fails.
- GitHub emails you if the workflow fails or its file is invalid.
Act on either email the same day.

Once a month (calendar reminder):
1. In Backblaze, open manifest/manifest.csv and find any recent file.
2. Download that file from files/ and open it. If it opens, the backup works.

Every 60 days:
- GitHub pauses scheduled jobs in a repo with no commits for 60 days. healthchecks.io will email
  you if that happens. To restart it, GitHub → Actions → Storage backup → Enable workflow.

When a key is replaced or expires:
- Update the matching GitHub secret, then do "After any change" above.

## What runs

- `.github/workflows/storage-backup.yml`: every night at 08:30 UTC (3:30 AM Chicago in summer,
  2:30 AM in winter; GitHub schedules in UTC) and whenever someone presses **Run workflow** on the
  Actions tab. It installs a pinned rclone and runs the script below. A couple of minutes at today's
  size (about 680 MB, 1,850 files). Until the secrets exist it stops cleanly with "not configured yet".
- `scripts/storage-backup.sh`: asks Supabase which buckets exist (a new bucket is covered automatically;
  an empty answer fails the run), then `rclone sync` from Supabase Storage's S3-compatible endpoint to
  B2, bucket by bucket. Only new or changed files are copied: a file is compared by its path, size and
  modification time. (Unlike quote-builder, this app overwrites files in place when a mockup, font or
  clipart file is replaced or an order is re-saved, so size alone is not enough.) A file Supabase no
  longer has is moved, not deleted: into `deleted/<date>/` in B2, where it stays 90 days. Then it lists
  every file it saw, sends that list to the app, writes the manifest the app answers with beside the
  files, compares B2's file count and bytes with Supabase's for every bucket and fails if B2 is short,
  prunes what is older than 90 days, and pings healthchecks.io.
- `app/api/backup/manifest`: answers a CSV of every file with what owns it, as the database knows it:
  bucket, path, size, date, state, kind, label, the owning row's id, status, customer. Labels read like
  "Art · T1801 Bucktown Chicago", "Unisex Cotton T · Red · front mockup", "Order #16987 · Unisex
  Cotton T", "Saved design · Reunion 2026 · …", "Pet photo · #1001 · pet-portrait-hat". The state is
  `ok` (file present and owned), `orphan` (file present, nothing points at it; the cleanup jobs delete
  rows but never files, so these pile up and are harmless), or `missing` (a row points at a file that
  is gone; the log says NOTE when there are any). Customer names appear only on paid orders; never
  email, phone or address. Guarded by `Authorization: Bearer BACKUP_MANIFEST_SECRET`.

The layout in the B2 bucket:

```
files/<bucket>/<path>                  every bucket as it is, same paths as Supabase
deleted/2026-11-03/<bucket>/<path>     what Supabase no longer had on that day, kept 90 days
manifest/manifest.csv                  the newest path-to-design list
manifest/history/manifest-<date>.csv   one per run, kept 90 days
```

## One-time setup

Never put any of these values in the repo or in a chat. They live only in the dashboards named below.

### 1. The Supabase S3 access key

1. Supabase dashboard → project **tee-studio** → **Project Settings** (the gear) → **Storage**.
2. Under **S3 Connection**, make sure **Enable connection via S3 protocol** is on. The **Endpoint**
   should read `https://yatiairlyensmcwbpldx.storage.supabase.co/storage/v1/s3` and the **Region**
   `us-west-2`. If the dashboard shows something else, tell Claude Code; the script takes
   `SUPABASE_S3_ENDPOINT` and `SUPABASE_S3_REGION` from the environment when they differ.
3. Under **S3 access keys** → **New access key** → description `GitHub storage backup` →
   **Generate**. Copy the **Access key ID** and the **Secret access key**. The secret is shown once;
   if it is lost, delete the key there and make a new one.
4. This key reads and writes every bucket in the project (pet-photos included) and is not subject to
   the app's policies. It is for this job only; the script only ever reads from Supabase. If it is
   ever exposed, delete it on the same page and make a new one; the backup then needs the new values
   in GitHub.

### 2. The B2 bucket and key

- A new **private** bucket of its own, for example `tee-studio-storage` (not quote-builder's). In its
  **Lifecycle Settings** choose **Keep only the last version of the file**: the backup keeps its own
  90-day history under `deleted/`, so B2's file versioning is not needed and would only grow.
- A new application key **limited to that bucket** with read and write (list, read, write and delete
  files: the job moves deletions and prunes old ones). Its **keyID** and **applicationKey** go into
  GitHub below.

### 3. The healthchecks.io check

A new check of its own (not quote-builder's), period **1 day**, grace time **3 hours** (GitHub can
start a scheduled run up to an hour late). Copy its ping URL, `https://hc-ping.com/…`. The job pings
`…/start` when it begins, the URL itself on success and `…/fail` on failure.

### 4. The manifest secret

Make a random string on the Mac, in Terminal:

```
openssl rand -hex 32
```

Put the same value in two places:

- Vercel → project **tee-studio** → **Settings** → **Environment Variables** → add
  `BACKUP_MANIFEST_SECRET`, environment **Production**, tick **Sensitive** → Save, then
  **Redeploy** the latest production deployment so the app picks it up.
- GitHub, as the secret `BACKUP_MANIFEST_SECRET` (next section).

### 5. GitHub secrets and the variable

GitHub → the repo `seedlesspix/tee-studio` → **Settings** → **Secrets and variables** → **Actions**.

On the **Secrets** tab, **New repository secret**, one for each:

| Name | Value |
|---|---|
| `SUPABASE_S3_ACCESS_KEY_ID` | the Access key ID from step 1 |
| `SUPABASE_S3_SECRET_ACCESS_KEY` | the Secret access key from step 1 |
| `B2_KEY_ID` | the B2 application key's keyID |
| `B2_APPLICATION_KEY` | the B2 application key itself |
| `BACKUP_MANIFEST_SECRET` | the random string from step 4 |
| `HEALTHCHECKS_PING_URL` | the check's ping URL from step 3 |

On the **Variables** tab, **New repository variable**:

| Name | Value |
|---|---|
| `B2_BUCKET` | the B2 bucket's name |

### 6. The first run

Actions tab → **Storage backup** → **Run workflow** → branch `main` → **Run workflow**. Open the run
and watch the log: `buckets: clipart customer-uploads design-exports designs fonts garment-swatches
pet-photos`, the sync lists every file as copied the first time, then one `Supabase: N files …
B2: N files` line per bucket and `BACKUP OK`. The B2 bucket then holds `files/` and `manifest/`, and
the healthchecks.io check shows a ping. Every later run copies only what is new or changed.

Watch the second and third runs too: if they re-copy hundreds of files that did not change ("Copied
(replaced existing)" for files nobody touched), the time comparison is misbehaving and Claude Code
should switch the compare rule. quote-builder hit that once.

## Restoring one file

Find the file's path. The quickest way is `manifest/manifest.csv` in B2 (open it in Numbers or
Excel; the label column names the art item, template, order or saved design beside each path), or
the admin / the Supabase dashboard's Table Editor (the row's URL ends in the path).

Either way works:

- **In the two dashboards.** In B2, browse to `files/<bucket>/<path>` and download it. In Supabase →
  **Storage** → the bucket, open the path's folder and upload the file **under its original name**
  (rename the download first if the browser changed it). The art tile, mockup or order preview shows
  it again at once, because its row never stopped pointing at that path.
- **With rclone on the Mac** (`brew install rclone`, then once: `rclone config` with a remote `supa`
  of type `s3`, provider `Other`, the endpoint, region and an S3 key from step 1, path style on; and
  a remote `b2` with the B2 key), one command:

  ```
  rclone copyto b2:<bucket>/files/<bucket-name>/<path> supa:<bucket-name>/<path>
  ```

A file deleted on purpose is under `deleted/<date>/<bucket-name>/<path>` for 90 days; copy it from
there the same way.

## Restoring everything

1. Get the database back first: Supabase dashboard → **Database** → **Backups**, or, in a new
   project, apply every migration in `supabase/migrations/` in order. (Buckets that no migration
   creates must be made by hand in Storage first, with the same names and public setting: clipart,
   fonts, garment-swatches, design-exports, customer-uploads, designs, pet-photos.)
2. In the new project, enable S3 and make an S3 access key (step 1 above).
3. Copy every bucket back under its original paths, one command per bucket:

   ```
   rclone sync b2:<bucket>/files/clipart supa:clipart --fast-list -v
   ```

   Nothing in the database needs editing: the rows point at the same paths.
4. Check: `rclone size b2:<bucket>/files/<bucket-name>` and `rclone size supa:<bucket-name>` agree
   for each bucket, and the Art panel, a template's mockups and an order preview show their files.
5. Point the backup at the new project: new S3 key values in GitHub, and the new project's endpoint
   if the project ref changed.

## How you would know it stopped

- GitHub emails the repo's owner when the scheduled run fails.
- healthchecks.io emails when a night passes with no ping. That also catches the job not running at
  all: GitHub pauses scheduled workflows in a repo with no commits for 60 days (the Actions tab then
  shows a banner with an Enable button).
- The run itself fails when B2 holds fewer files or bytes than Supabase for any bucket, or when
  Supabase answers with no buckets.
- Once a month, restore one file as a drill, by either route above.
