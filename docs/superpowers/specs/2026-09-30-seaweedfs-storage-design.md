# Design: SeaweedFS (S3) storage for Soleph photos

**Date:** 2026-09-30  
**Status:** approved (conversation) — pending user review of this file  
**Goal:** Replace Supabase Storage with self-hosted SeaweedFS S3 for all photo blobs (previews, originals, covers), including migration of existing objects. Supabase remains the source of truth for Postgres + admin auth.

## Context (current)

- Uploads go through `@supabase/supabase-js` (`sb.storage.from(bucket).upload`) via `src/lib/storage-upload.js`.
- Logical buckets: `album-previews`, `album-originals`, `album-covers` (`BUCKETS` in `src/lib/supabase.js`).
- Public URLs: `{PUBLIC_SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}`.
- DB columns keep **relative paths** (`preview_path`, `original_path`, `cover_path`); the app builds absolute URLs.
- Call sites: admin event editor, portfolio upload, shop/face URL helpers, delete/remove on storage.

## Target infrastructure

| Piece | Value |
|-------|--------|
| S3 API | SeaweedFS on host `167.104.161.230:8333` (path-style) |
| Public media host | `https://s3.estudionomade.com.ar` |
| DNS | A record `s3` → `167.104.161.230` (apex `estudionomade.com.ar` stays on Vercel) |
| TLS + reverse proxy | Caddy (or nginx) on the Seaweed host → localhost S3 gateway |
| Single bucket | `storage` |
| Key prefixes | `previews/`, `originals/`, `covers/` |
| Credentials | Existing S3 access key + secret; **server-only** (never `PUBLIC_*`) |

### Why HTTPS subdomain (not bare `http://IP:8333` in the browser)

- Soleph is served over HTTPS; HTTP media URLs cause mixed content.
- S3 keys must not ship to the browser.
- `:8333` should not be the public surface; Caddy terminates TLS on `s3.estudionomade.com.ar`.

## Architecture

```
Browser (shop)     --HTTPS--> s3.estudionomade.com.ar --Caddy--> SeaweedFS S3 (:8333)
Browser (admin)    --HTTPS--> Soleph app --presign/API--> S3 API (keys on server)
Edge / face jobs   --HTTPS--> public preview URLs on s3.estudionomade.com.ar
Soleph app / admin --HTTPS--> Supabase (Postgres + Auth only)
```

### Object key layout

DB keeps the same relative path as today (e.g. `{albumId}/{timestamp}-file.jpg`).

| Kind | S3 object key | Public? |
|------|---------------|---------|
| preview | `previews/{path}` | yes |
| original | `originals/{path}` | no (presigned GET or admin API only) |
| cover / portfolio | `covers/{path}` | yes |

Public URL shape (single helper):

```text
{PUBLIC_MEDIA_BASE_URL}/storage/{prefix}/{path}
→ https://s3.estudionomade.com.ar/storage/previews/...
```

Exact path after the host must match how Caddy exposes the bucket (path-style ` /{bucket}/{key}`). One helper owns this; no scattered string concat.

If Caddy strips `/storage` or rewrites, adjust **only** `publicObjectUrl` + env docs — not every call site.

## Application components

### New: `src/lib/object-storage.js`

- AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`).
- Config from env: endpoint, region (dummy `us-east-1` OK), keys, bucket `storage`, `forcePathStyle: true`.
- API:
  - `objectKey(kind, path)` → `previews|originals|covers/{cleanPath}`
  - `publicObjectUrl(kind, path)` → absolute HTTPS URL for public kinds
  - `presignPut({ kind, path, contentType, expiresIn })`
  - `presignGet({ kind, path, expiresIn })` for originals
  - `putObject` / `deleteObject` / `deleteObjects` (server-side)
  - `isObjectStorageConfigured()`

### Change: `src/lib/storage-upload.js`

- Stop taking Supabase client + `sb.storage.from().upload`.
- Upload via presigned PUT (browser) or server `putObject`, keep retry/backoff + `formatStorageError`.

### Change: `src/lib/supabase.js` (or thin re-exports)

- `publicStorageUrl(bucketOrKind, path)` delegates to object-storage using kind map:
  - `album-previews` / `previews` → `previews`
  - `album-originals` / `originals` → `originals`
  - `album-covers` / `covers` → `covers`
- `BUCKETS` constants remain as **logical kind ids** for call-site compatibility, or rename to kinds in the same PR if touch set is small.
- Supabase client stays for DB/auth only.

### New API routes (Astro)

- `POST /api/storage/presign` — body `{ kind, path, contentType, op: 'put'|'get' }`; requires admin session; returns `{ url, method, headers?, objectKey }`.
- `POST /api/storage/delete` (or DELETE) — admin session; deletes one or many keys by kind+path.
- Optional: server-side multipart proxy only if presigned PUT to public host fails CORS; prefer fixing CORS on Caddy/S3 first.

### Call sites to update

- `src/pages/admin/evento/editar.astro` — upload preview/original, remove, re-watermark download original.
- `src/lib/portfolio.js` — cover/portfolio upload.
- `src/lib/shop-live.js`, `src/lib/face.js`, `src/pages/tienda/buscar.astro` — only URL helper (should keep working if `publicStorageUrl` is fixed).

### Migration script

- `scripts/migrate-supabase-to-s3.mjs` (or `.ts`):
  1. List Supabase Storage objects in `album-previews`, `album-originals`, `album-covers`.
  2. GET each object; PUT to `storage` under `previews|originals|covers/{same relative path}`.
  3. Dry-run flag; progress log; retry on transient errors; skip existing if same size/etag optional.
  4. No DB rewrites if paths are unchanged.
  5. Sample verify: HEAD/GET via `PUBLIC_MEDIA_BASE_URL`.

### Env

```bash
# Server only
S3_ENDPOINT=http://127.0.0.1:8333
# From Soleph host if not co-located:
# S3_ENDPOINT=http://167.104.161.230:8333
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=storage
S3_FORCE_PATH_STYLE=true

# Public (browser-safe)
PUBLIC_MEDIA_BASE_URL=https://s3.estudionomade.com.ar
```

Update `.env.example`. Do not put S3 secrets in `PUBLIC_*`.

Supabase URL/anon key remain for DB/auth.

## Data flows

### Upload (admin)

1. Client builds relative `path` (same naming as today).
2. `POST /api/storage/presign` with admin cookie/JWT.
3. Server checks admin role → `presignPut` for `previews/{path}` or `originals/{path}` / `covers/{path}`.
4. Client PUT body to presigned URL (retries on retryable network/5xx).
5. On success, insert/update Postgres rows (`preview_path` / `original_path` unchanged shape).
6. On original failure after preview success: delete preview object (same compensation as today).

### Read (shop / face)

- `publicStorageUrl` → `https://s3.estudionomade.com.ar/storage/previews/...`
- Rekognition/face edge functions consume those public HTTPS URLs (must be reachable from AWS).

### Read original (admin only)

- Presigned GET short TTL, or authenticated download API that streams from S3.

### Delete

- Admin API → `DeleteObject` for preview and/or original keys; then DB row delete (order: prefer storage then DB or best-effort storage cleanup like today).

## Error handling

- Reuse humanized messages in `formatStorageError` (413, auth, conflict, retryable 5xx/network).
- Map S3/SDK errors into the same helper where possible.
- Expired presign → one re-presign + retry.
- Misconfigured storage → clear error at admin entry (`isObjectStorageConfigured`).

## Cutover plan

1. Ops: DNS `s3.estudionomade.com.ar`, Caddy TLS, bucket `storage`, public read for `previews/*` and `covers/*`, deny anonymous `originals/*`.
2. Deploy app with object-storage + env (writes still dual or feature-flag if needed; default: S3 only once script ready).
3. Run migration script until counts match.
4. Spot-check shop + admin + face index URL fetch.
5. Point all reads to `PUBLIC_MEDIA_BASE_URL`.
6. Keep Supabase buckets until confidence window; delete later manually.
7. Rollback reads: restore old `publicStorageUrl` behavior via env flag `STORAGE_BACKEND=supabase|s3` **optional** — only if cheap; otherwise revert deploy. Prefer short confidence window + keeping Supabase copies.

**Recommendation:** implement `STORAGE_BACKEND` or simply `PUBLIC_MEDIA_BASE_URL` empty → fall back Supabase public URL builder for emergency rollback of **reads**. Writes go S3-only after cutover to avoid split brain.

## Out of scope

- Moving Postgres or Auth off Supabase.
- Changing watermark/face product behavior.
- Deleting Supabase storage buckets automatically.
- CDN in front of Caddy (can add later).

## Testing (manual minimum)

- [ ] Presign put preview + original from admin; rows in DB; image visible in shop via `s3.estudionomade.com.ar`.
- [ ] Portfolio/cover upload URL loads over HTTPS.
- [ ] Delete photo removes S3 objects.
- [ ] Original not world-readable without signature.
- [ ] Migration dry-run + one real album; URLs resolve.
- [ ] Face index/search still receives reachable preview URL (if enabled).

## Ops checklist (Seaweed host)

- [ ] A record `s3.estudionomade.com.ar` → `167.104.161.230`
- [ ] Caddy site block: reverse_proxy to S3 gateway; TLS
- [ ] CORS for PUT from Soleph admin origin if browser uploads direct
- [ ] Bucket `storage`; policies: public GET prefix `previews/`, `covers/`; private `originals/`
- [ ] Firewall: 8333 not required publicly if Caddy proxies both API and public GET

## Success criteria

- New uploads never touch Supabase Storage.
- Existing photos served from Seaweed after migration.
- No S3 secrets in client bundle.
- Shop and admin work over HTTPS with `s3.estudionomade.com.ar`.
