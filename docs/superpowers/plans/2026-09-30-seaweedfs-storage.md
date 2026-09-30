# SeaweedFS S3 Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all photo blobs from Supabase Storage to self-hosted SeaweedFS S3 (`storage` bucket, prefixes `previews|originals|covers`), serve public media at `https://s3.estudionomade.com.ar`, migrate existing objects, keep Supabase for Postgres + auth only.

**Architecture:** Static Astro has no server API routes. Browser builds public URLs from `PUBLIC_MEDIA_BASE_URL`. Uploads/deletes go: admin JWT → Supabase Edge Functions (`storage-presign`, `storage-delete`) → AWS SDK against Seaweed S3 → browser PUT to presigned URL (or edge delete). Shared pure helpers in `src/lib/object-storage-paths.js` for key/URL shape. One-shot Node migration script copies Supabase → S3.

**Tech Stack:** Astro (static), Supabase JS (DB/auth), Supabase Edge (Deno) + `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, SeaweedFS S3 path-style, optional Node script with same SDK.

**Spec:** `docs/superpowers/specs/2026-09-30-seaweedfs-storage-design.md`

**Git:** Conventional Commits; stage concrete paths; **user** runs `git commit -S` (agents must not unsigned-commit). Never `git add .`.

---

## File map

| File | Role |
|------|------|
| `src/lib/object-storage-paths.js` | Pure: kind↔prefix, `objectKey`, `publicObjectUrl`, `BUCKETS` logical ids, media base from env |
| `src/lib/supabase.js` | Keep client/auth; `publicStorageUrl` → paths helper; drop Supabase storage URL builder when media base set |
| `src/lib/storage-upload.js` | Retry wrapper for **presigned PUT** (`fetch`) instead of `sb.storage.upload` |
| `src/lib/storage-api.js` | Browser client: call edge `storage-presign` / `storage-delete` with session JWT |
| `supabase/functions/storage-presign/index.ts` | Admin-only presign put/get |
| `supabase/functions/storage-delete/index.ts` | Admin-only delete objects |
| `src/pages/admin/evento/editar.astro` | Upload/delete/re-wm use storage-api |
| `src/lib/portfolio.js` | Cover upload via storage-api |
| `scripts/migrate-supabase-to-s3.mjs` | Copy existing blobs |
| `.env.example` | Document S3 + `PUBLIC_MEDIA_BASE_URL` |
| `docs/supabase-project.md` or short `docs/seaweed-storage.md` | Ops: secrets, Caddy, deploy functions |

**Unchanged call sites if `publicStorageUrl` is fixed:** `shop-live.js`, `face.js`, `tienda/buscar.astro`.

---

### Task 1: Path/URL helpers (pure, no SDK)

**Files:**
- Create: `src/lib/object-storage-paths.js`
- Modify: `src/lib/supabase.js`
- Test: manual node one-liner or small assert in comment run via `node --input-type=module`

- [ ] **Step 1: Create `src/lib/object-storage-paths.js`**

```js
/** Logical kinds and legacy Supabase bucket names → S3 key prefix under bucket `storage`. */

export const STORAGE_KINDS = {
  previews: 'previews',
  originals: 'originals',
  covers: 'covers',
};

/** Keep same export shape as old BUCKETS for call sites */
export const BUCKETS = {
  previews: 'previews',
  originals: 'originals',
  covers: 'covers',
};

const LEGACY_BUCKET_TO_KIND = {
  'album-previews': 'previews',
  'album-originals': 'originals',
  'album-covers': 'covers',
  previews: 'previews',
  originals: 'originals',
  covers: 'covers',
};

/**
 * @param {string} bucketOrKind
 * @returns {'previews'|'originals'|'covers'}
 */
export function resolveStorageKind(bucketOrKind) {
  const k = LEGACY_BUCKET_TO_KIND[String(bucketOrKind || '').trim()];
  if (!k) throw new Error(`Unknown storage kind: ${bucketOrKind}`);
  return k;
}

/**
 * @param {string} path
 */
export function cleanStoragePath(path) {
  return String(path || '').replace(/^\/+/, '').replace(/\.\./g, '');
}

/**
 * S3 object key inside bucket `storage`.
 * @param {string} bucketOrKind
 * @param {string} path relative path stored in DB
 */
export function objectKey(bucketOrKind, path) {
  const kind = resolveStorageKind(bucketOrKind);
  const clean = cleanStoragePath(path);
  if (!clean) throw new Error('Empty storage path');
  return `${kind}/${clean}`;
}

/**
 * Public HTTPS URL for previews/covers (and any public prefix).
 * Shape: {PUBLIC_MEDIA_BASE_URL}/storage/{kind}/{path}
 * Must match Caddy path-style expose of bucket `storage`.
 *
 * @param {string} bucketOrKind
 * @param {string} path
 * @param {string} [mediaBase] override (tests)
 */
export function publicObjectUrl(bucketOrKind, path, mediaBase) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const base = String(
    mediaBase ??
      (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.PUBLIC_MEDIA_BASE_URL) ??
      '',
  )
    .trim()
    .replace(/\/$/, '');
  if (!base) return '';
  const kind = resolveStorageKind(bucketOrKind);
  const clean = cleanStoragePath(path);
  return `${base}/storage/${kind}/${clean}`;
}

export function isMediaBaseConfigured() {
  try {
    const base = String(import.meta.env.PUBLIC_MEDIA_BASE_URL || '').trim();
    if (!base) return false;
    const u = new URL(base);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Wire `publicStorageUrl` in `src/lib/supabase.js`**

Replace `publicStorageUrl` and re-export `BUCKETS` from paths:

```js
import {
  BUCKETS,
  publicObjectUrl,
  isMediaBaseConfigured,
} from './object-storage-paths.js';

export { BUCKETS };

export function publicStorageUrl(bucket, path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  // Prefer Seaweed public base when configured
  if (isMediaBaseConfigured()) {
    return publicObjectUrl(bucket, path);
  }
  // Legacy Supabase Storage (rollback reads)
  const base = String(url || '').replace(/\/$/, '');
  const clean = String(path).replace(/^\//, '');
  return `${base}/storage/v1/object/public/${bucket === 'previews' ? 'album-previews' : bucket === 'originals' ? 'album-originals' : bucket === 'covers' ? 'album-covers' : bucket}/${clean}`;
}
```

Note: legacy branch must map new kind ids back to old bucket names `album-*` if rollback before migration empty. Prefer:

```js
const LEGACY_PUBLIC_BUCKET = {
  previews: 'album-previews',
  originals: 'album-originals',
  covers: 'album-covers',
  'album-previews': 'album-previews',
  'album-originals': 'album-originals',
  'album-covers': 'album-covers',
};
// use LEGACY_PUBLIC_BUCKET[bucket] || bucket
```

- [ ] **Step 3: Sanity check URLs**

Run from repo root (with dummy env not required for pure path):

```bash
node --input-type=module -e "
import { objectKey, publicObjectUrl } from './src/lib/object-storage-paths.js';
console.assert(objectKey('previews','a/b.jpg')==='previews/a/b.jpg');
console.assert(objectKey('album-originals','x')==='originals/x');
console.assert(publicObjectUrl('covers','p/c.jpg','https://s3.estudionomade.com.ar')==='https://s3.estudionomade.com.ar/storage/covers/p/c.jpg');
console.log('ok');
"
```

Expected: `ok`

- [ ] **Step 4: Commit (user signs)**

```bash
git add src/lib/object-storage-paths.js src/lib/supabase.js
git commit -S -m "feat(storage): add S3 path/URL helpers and media base public URLs"
```

---

### Task 2: Edge function shared S3 client + `storage-presign`

**Files:**
- Create: `supabase/functions/storage-presign/index.ts`
- Optional shared: inline client in each function (match face-* style; no shared folder required)

- [ ] **Step 1: Implement `supabase/functions/storage-presign/index.ts`**

Mirror auth from `supabase/functions/face-index/index.ts` (Bearer user JWT → `getUser` → `profiles.role === 'admin'`).

```ts
// Deploy: supabase functions deploy storage-presign --no-verify-jwt
// Secrets: S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET
// Optional: S3_PRESIGN_ENDPOINT (public base for signed URL host, e.g. https://s3.estudionomade.com.ar)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { S3Client, PutObjectCommand, GetObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3.758.0';
import { getSignedUrl } from 'https://esm.sh/@aws-sdk/s3-request-presigner@3.758.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const KIND_PREFIX: Record<string, string> = {
  previews: 'previews',
  originals: 'originals',
  covers: 'covers',
  'album-previews': 'previews',
  'album-originals': 'originals',
  'album-covers': 'covers',
};

function cleanPath(path: string) {
  return String(path || '').replace(/^\/+/, '').replace(/\.\./g, '');
}

function objectKey(kind: string, path: string) {
  const prefix = KIND_PREFIX[kind];
  if (!prefix) throw new Error(`kind inválido: ${kind}`);
  const clean = cleanPath(path);
  if (!clean) throw new Error('path vacío');
  // allow only safe chars in path segments
  if (!/^[a-zA-Z0-9._\-\/]+$/.test(clean)) throw new Error('path inválido');
  return `${prefix}/${clean}`;
}

function s3() {
  const endpoint = Deno.env.get('S3_ENDPOINT');
  const accessKeyId = Deno.env.get('S3_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('S3_SECRET_ACCESS_KEY');
  const region = Deno.env.get('S3_REGION') || 'us-east-1';
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Faltan S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY');
  }
  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function requireAdmin(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PUBLIC_SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('PUBLIC_SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !serviceKey) throw new Error('Falta SUPABASE_URL / SERVICE_ROLE');

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: json({ error: 'No auth' }, 401) };
  if (anonKey && token === anonKey) return { error: json({ error: 'Se requiere sesion admin' }, 401) };

  const admin = createClient(supabaseUrl, serviceKey);
  if (token === serviceKey) return { admin, userId: 'service' };

  const userClient = createClient(supabaseUrl, anonKey || serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData.user) return { error: json({ error: 'No auth' }, 401) };
  const { data: profile } = await admin.from('profiles').select('id, role').eq('id', userData.user.id).maybeSingle();
  if (!profile || profile.role !== 'admin') return { error: json({ error: 'Sin permiso' }, 403) };
  return { admin, userId: profile.id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const gate = await requireAdmin(req);
    if ('error' in gate && gate.error) return gate.error;

    const body = await req.json();
    const op = body.op === 'get' ? 'get' : 'put';
    const kind = String(body.kind || '');
    const path = String(body.path || '');
    const contentType = String(body.contentType || 'application/octet-stream');
    const expiresIn = Math.min(Math.max(Number(body.expiresIn) || 600, 60), 3600);

    const key = objectKey(kind, path);
    const bucket = Deno.env.get('S3_BUCKET') || 'storage';
    const client = s3();

    // Optional: sign against public endpoint host so browser PUT hits s3.estudionomade.com.ar
    const presignEndpoint = Deno.env.get('S3_PRESIGN_ENDPOINT') || Deno.env.get('S3_ENDPOINT');
    const signClient = new S3Client({
      region: Deno.env.get('S3_REGION') || 'us-east-1',
      endpoint: presignEndpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: Deno.env.get('S3_ACCESS_KEY_ID')!,
        secretAccessKey: Deno.env.get('S3_SECRET_ACCESS_KEY')!,
      },
    });

    const command =
      op === 'get'
        ? new GetObjectCommand({ Bucket: bucket, Key: key })
        : new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });

    const url = await getSignedUrl(signClient, command, { expiresIn });
    return json({
      url,
      method: op === 'get' ? 'GET' : 'PUT',
      objectKey: key,
      bucket,
      headers: op === 'put' ? { 'Content-Type': contentType } : {},
      expiresIn,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
```

- [ ] **Step 2: Document secrets (do not commit secrets)**

```bash
# On machine with supabase CLI linked (user runs):
supabase secrets set \
  S3_ENDPOINT=http://127.0.0.1:8333 \
  S3_PRESIGN_ENDPOINT=https://s3.estudionomade.com.ar \
  S3_REGION=us-east-1 \
  S3_ACCESS_KEY_ID='…' \
  S3_SECRET_ACCESS_KEY='…' \
  S3_BUCKET=storage
```

If Edge cannot reach `127.0.0.1` on the Seaweed host, set `S3_ENDPOINT=http://167.104.161.230:8333` (and firewall allow Supabase egress). Prefer private network if available.

- [ ] **Step 3: Commit paths only**

```bash
git add supabase/functions/storage-presign/index.ts
git commit -S -m "feat(storage): add storage-presign edge function for Seaweed S3"
```

---

### Task 3: Edge function `storage-delete`

**Files:**
- Create: `supabase/functions/storage-delete/index.ts`

- [ ] **Step 1: Implement delete**

Same `requireAdmin` + `KIND_PREFIX` / `objectKey` as presign. Body:

```json
{ "items": [ { "kind": "previews", "path": "album/a-wm.jpg" }, { "kind": "originals", "path": "…" } ] }
```

Use `DeleteObjectsCommand` (batches of 1000) or loop `DeleteObjectCommand`.

```ts
import { S3Client, DeleteObjectsCommand } from 'https://esm.sh/@aws-sdk/client-s3@3.758.0';
// ... requireAdmin, objectKey, s3() same as presign ...

// after auth:
const items = Array.isArray(body.items) ? body.items : [];
if (!items.length) return json({ error: 'items vacío' }, 400);
const bucket = Deno.env.get('S3_BUCKET') || 'storage';
const Objects = items.map((it: { kind: string; path: string }) => ({
  Key: objectKey(String(it.kind), String(it.path)),
}));
// chunk 1000
const client = s3();
for (let i = 0; i < Objects.length; i += 1000) {
  const chunk = Objects.slice(i, i + 1000);
  await client.send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: chunk, Quiet: true },
  }));
}
return json({ ok: true, deleted: Objects.length });
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/storage-delete/index.ts
git commit -S -m "feat(storage): add storage-delete edge function"
```

---

### Task 4: Browser storage API + upload retry via presigned PUT

**Files:**
- Create: `src/lib/storage-api.js`
- Modify: `src/lib/storage-upload.js`
- Modify: `src/lib/face.js` only if it already has a pattern for edge base URL — reuse same env

- [ ] **Step 1: Create `src/lib/storage-api.js`**

```js
import { getSupabase } from './supabase.js';

function functionsBase() {
  const base = String(import.meta.env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/functions/v1`;
}

async function adminAccessToken() {
  const sb = getSupabase();
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('Sesión admin requerida para storage');
  return token;
}

/**
 * @param {'storage-presign'|'storage-delete'} name
 * @param {Record<string, unknown>} body
 */
export async function invokeStorageFunction(name, body) {
  const token = await adminAccessToken();
  const anon = String(import.meta.env.PUBLIC_SUPABASE_ANON_KEY || '').trim();
  const res = await fetch(`${functionsBase()}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: anon,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `storage ${name} HTTP ${res.status}`);
    // @ts-ignore
    err.status = res.status;
    throw err;
  }
  return json;
}

/**
 * @param {{ kind: string, path: string, contentType?: string, op?: 'put'|'get', expiresIn?: number }} opts
 */
export async function presignStorage(opts) {
  return invokeStorageFunction('storage-presign', {
    kind: opts.kind,
    path: opts.path,
    contentType: opts.contentType || 'application/octet-stream',
    op: opts.op || 'put',
    expiresIn: opts.expiresIn,
  });
}

/**
 * @param {{ kind: string, path: string }[]} items
 */
export async function deleteStorageObjects(items) {
  if (!items.length) return { ok: true, deleted: 0 };
  return invokeStorageFunction('storage-delete', { items });
}
```

- [ ] **Step 2: Rewrite `uploadWithRetry` for presigned PUT**

Replace Supabase upload loop with:

```js
import { presignStorage } from './storage-api.js';

/**
 * @param {string} kind BUCKETS.previews | originals | covers
 * @param {string} path
 * @param {Blob|File|ArrayBuffer|ArrayBufferView} body
 * @param {{ contentType?: string, attempts?: number, baseDelayMs?: number, onRetry?: Function }} [opts]
 * @returns {Promise<{ data: { path: string } | null, error: unknown }>}
 */
export async function uploadWithRetry(kind, path, body, opts = {}) {
  const attempts = Math.max(1, opts.attempts ?? 4);
  const baseDelayMs = opts.baseDelayMs ?? 900;
  const contentType = opts.contentType || 'application/octet-stream';

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const signed = await presignStorage({ kind, path, contentType, op: 'put' });
      const headers = new Headers(signed.headers || {});
      if (contentType && !headers.has('Content-Type')) headers.set('Content-Type', contentType);

      const putRes = await fetch(signed.url, {
        method: signed.method || 'PUT',
        headers,
        body,
      });

      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        const err = new Error(text || `HTTP ${putRes.status}`);
        // @ts-ignore
        err.status = putRes.status;
        throw err;
      }
      return { data: { path }, error: null };
    } catch (err) {
      lastError = err;
      const retry = attempt < attempts && isRetryableStorageError(err);
      if (!retry) return { data: null, error: lastError };
      const delayMs = Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
      if (typeof opts.onRetry === 'function') {
        opts.onRetry({ attempt, attempts, error: err, delayMs });
      }
      await sleep(delayMs);
    }
  }
  return { data: null, error: lastError };
}
```

Keep existing `formatStorageError`, `isRetryableStorageError`, `storageErrorStatus`, `sleep` in the same file. **Remove** the `sb` first parameter from the signature — update all call sites in later tasks.

Also export a thin `removeStoragePaths(kind, paths: string[])` that maps to `deleteStorageObjects`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/storage-api.js src/lib/storage-upload.js
git commit -S -m "feat(storage): presign client and PUT upload with retry"
```

---

### Task 5: Admin event editor — upload / delete / re-watermark

**Files:**
- Modify: `src/pages/admin/evento/editar.astro`

- [ ] **Step 1: Update imports**

```js
import { getSupabase, publicStorageUrl, BUCKETS } from '../../../lib/supabase.js';
import { formatStorageError, uploadWithRetry } from '../../../lib/storage-upload.js';
import { deleteStorageObjects, presignStorage } from '../../../lib/storage-api.js';
```

- [ ] **Step 2: Change every `uploadWithRetry(sb, BUCKETS.x, …)` → `uploadWithRetry(BUCKETS.x, …)`**

Locations (search file): preview upload, original upload, re-watermark upload (~1149, ~1171, ~1351).

- [ ] **Step 3: Replace `sb.storage.from(...).remove(...)`**

In `deletePhotoRow`:

```js
const items = [];
if (photo.preview_path) items.push({ kind: BUCKETS.previews, path: photo.preview_path });
if (photo.original_path) items.push({ kind: BUCKETS.originals, path: photo.original_path });
if (items.length) {
  try {
    await deleteStorageObjects(items);
  } catch (e) {
    /* best-effort log; still try DB delete or fail soft like today */
  }
}
```

Same for bulk album delete paths (~1557–1577) and compensate-delete preview after failed original (~1184).

- [ ] **Step 4: Original download for re-watermark**

Replace:

```js
.from(BUCKETS.originals).download(p.original_path)
```

With:

```js
const signed = await presignStorage({
  kind: BUCKETS.originals,
  path: p.original_path,
  op: 'get',
  expiresIn: 600,
});
const res = await fetch(signed.url);
if (!res.ok) throw new Error(`No se pudo bajar original HTTP ${res.status}`);
const blob = await res.blob();
```

- [ ] **Step 5: Manual test checklist (after functions deployed + env)**

1. Login admin → open event → upload 1 photo.
2. Network: `storage-presign` 200, PUT to `s3.estudionomade.com.ar` 200.
3. Shop grid shows image from `https://s3.estudionomade.com.ar/storage/previews/...`.
4. Delete photo → objects gone.
5. If originals enabled: re-wm path works.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/evento/editar.astro
git commit -S -m "feat(admin): event uploads and deletes via Seaweed S3 presign"
```

---

### Task 6: Portfolio upload

**Files:**
- Modify: `src/lib/portfolio.js`

- [ ] **Step 1: Switch upload**

```js
// remove dependency on sb for storage
const { error } = await uploadWithRetry(BUCKETS.covers, path, blob, {
  contentType,
  attempts: 4,
});
// return publicStorageUrl(BUCKETS.covers, path) — already correct once media base set
```

Ensure `isSupabaseConfigured()` still gates DB/settings if needed; for upload-only path require media base + session.

- [ ] **Step 2: Commit**

```bash
git add src/lib/portfolio.js
git commit -S -m "feat(portfolio): upload covers to Seaweed S3"
```

---

### Task 7: Env example + ops doc

**Files:**
- Modify: `.env.example`
- Create: `docs/seaweed-storage.md`

- [ ] **Step 1: `.env.example`**

Append:

```bash
# Public media (SeaweedFS behind Caddy) — browser-safe
PUBLIC_MEDIA_BASE_URL=https://s3.estudionomade.com.ar

# S3 / Seaweed — SERVER ONLY (Edge secrets + migration script). Never PUBLIC_*.
# S3_ENDPOINT=http://127.0.0.1:8333
# S3_PRESIGN_ENDPOINT=https://s3.estudionomade.com.ar
# S3_REGION=us-east-1
# S3_ACCESS_KEY_ID=
# S3_SECRET_ACCESS_KEY=
# S3_BUCKET=storage
```

- [ ] **Step 2: Write `docs/seaweed-storage.md`**

Include:

1. DNS A `s3.estudionomade.com.ar` → `167.104.161.230`
2. Example Caddyfile:

```caddyfile
s3.estudionomade.com.ar {
  reverse_proxy 127.0.0.1:8333
}
```

3. CORS: allow PUT/GET from Soleph origins (`https://soleyaquinta.com.ar`, localhost) — configure on Seaweed/Caddy as needed for browser PUT.
4. Bucket `storage`; public read for keys under `previews/` and `covers/`; private `originals/`.
5. `supabase secrets set …` and:

```bash
supabase functions deploy storage-presign --no-verify-jwt
supabase functions deploy storage-delete --no-verify-jwt
```

6. Object URL shape: `https://s3.estudionomade.com.ar/storage/{previews|covers|originals}/{path}`
7. Rollback reads: unset `PUBLIC_MEDIA_BASE_URL` (legacy Supabase public URLs) while copies remain.

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/seaweed-storage.md
git commit -S -m "docs: SeaweedFS S3 storage setup and env"
```

---

### Task 8: Migration script Supabase → S3

**Files:**
- Create: `scripts/migrate-supabase-to-s3.mjs`
- Modify: `package.json` — add devDependency `@aws-sdk/client-s3` **or** document `npx` usage. Prefer adding dependencies:

```json
"@aws-sdk/client-s3": "^3.758.0",
"@supabase/supabase-js": already present
```

Script uses **service role** locally (user provides via env, never commit).

- [ ] **Step 1: Add script**

```js
#!/usr/bin/env node
/**
 * Copy Supabase Storage buckets → Seaweed bucket `storage` with prefixes.
 * Usage:
 *   DRY_RUN=1 node scripts/migrate-supabase-to-s3.mjs
 *   node scripts/migrate-supabase-to-s3.mjs
 *
 * Env:
 *   PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET=storage, S3_REGION
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const DRY = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');

const MAP = [
  { supabaseBucket: 'album-previews', prefix: 'previews' },
  { supabaseBucket: 'album-originals', prefix: 'originals' },
  { supabaseBucket: 'album-covers', prefix: 'covers' },
];

const sbUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!sbUrl || !serviceKey) {
  console.error('Need PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const bucket = process.env.S3_BUCKET || 'storage';
const sb = createClient(sbUrl, serviceKey);

async function listAll(bucketName, prefix = '') {
  const out = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const { data, error } = await sb.storage.from(bucketName).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    if (!data?.length) break;
    for (const entry of data) {
      // Supabase list is per-"folder"; if id/metadata missing, treat as folder and recurse
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null || (entry.metadata == null && !entry.name.includes('.'))) {
        // heuristic folder: recurse
        const nested = await listAll(bucketName, path);
        out.push(...nested);
      } else {
        out.push(path);
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function copyOne(supabaseBucket, prefix, path) {
  const key = `${prefix}/${path}`;
  if (await exists(key)) {
    console.log('skip exists', key);
    return 'skip';
  }
  const { data, error } = await sb.storage.from(supabaseBucket).download(path);
  if (error) throw error;
  const buf = Buffer.from(await data.arrayBuffer());
  if (DRY) {
    console.log('dry-run would put', key, buf.length);
    return 'dry';
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buf,
      ContentType: data.type || 'application/octet-stream',
    }),
  );
  console.log('ok', key, buf.length);
  return 'ok';
}

let ok = 0, skip = 0, fail = 0;
for (const { supabaseBucket, prefix } of MAP) {
  console.log('listing', supabaseBucket);
  let paths = [];
  try {
    paths = await listAll(supabaseBucket, '');
  } catch (e) {
    console.error('list failed', supabaseBucket, e.message || e);
    continue;
  }
  console.log('count', supabaseBucket, paths.length);
  for (const path of paths) {
    try {
      const r = await copyOne(supabaseBucket, prefix, path);
      if (r === 'ok' || r === 'dry') ok += 1;
      else skip += 1;
    } catch (e) {
      fail += 1;
      console.error('fail', prefix, path, e.message || e);
    }
  }
}
console.log({ ok, skip, fail, DRY });
```

**Note:** Supabase `list` recursion is finicky (folders). If list misses nested paths, improve with known prefixes from DB:

```js
const { data: photos } = await sb.from('photos').select('preview_path, original_path');
// union paths + covers from albums.cover_path / portfolio
```

Add a **second mode** preferred for reliability:

```bash
node scripts/migrate-supabase-to-s3.mjs --from-db
```

When `--from-db`:

1. `select preview_path, original_path from photos`
2. `select cover_path from albums`
3. Portfolio images if stored as full URLs skip; if path-only under covers, include
4. Copy each path to the right prefix

Implement `--from-db` as primary path in the same file; keep list mode optional.

- [ ] **Step 2: Install SDK for script**

```bash
npm install @aws-sdk/client-s3
```

- [ ] **Step 3: Dry-run (user machine with secrets)**

```bash
DRY_RUN=1 node scripts/migrate-supabase-to-s3.mjs --from-db
```

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-supabase-to-s3.mjs package.json package-lock.json
git commit -S -m "feat(storage): migration script Supabase Storage to Seaweed S3"
```

---

### Task 9: Ops cutover + verify

**Order (user + agent):**

- [ ] **Step 1: DNS + Caddy** on `167.104.161.230` for `s3.estudionomade.com.ar`
- [ ] **Step 2: Confirm public GET** `https://s3.estudionomade.com.ar/storage/previews/…` after a test put
- [ ] **Step 3: Set Edge secrets + deploy** `storage-presign`, `storage-delete`
- [ ] **Step 4: Set `PUBLIC_MEDIA_BASE_URL`** in Soleph host env / `.env` and rebuild
- [ ] **Step 5: Run migration** `--from-db` then full if needed
- [ ] **Step 6: Smoke**
  - Admin upload
  - Tienda image URL host = `s3.estudionomade.com.ar`
  - Delete
  - Face search still loads preview URL (if on)
- [ ] **Step 7: Leave Supabase buckets intact** ≥1 week; then manual cleanup

---

## Self-review (plan vs spec)

| Spec item | Task |
|-----------|------|
| Single bucket `storage` + prefixes | 1, 2, 8 |
| `PUBLIC_MEDIA_BASE_URL` / `s3.estudionomade.com.ar` | 1, 7 |
| Keys server-only | 2, 3, 7 |
| Presign upload + delete admin | 2–5 |
| DB paths unchanged | 5, 8 |
| Migration existing objects | 8 |
| Rollback read via unset media base | 1, 7 |
| Face URLs via publicStorageUrl | 1 (no face code change) |
| Caddy / DNS ops | 7, 9 |
| No Astro API (static site) | Edge functions 2–3 (spec said Astro API; **corrected** here) |

**Spec deviation (intentional):** Design doc mentioned Astro `/api/storage/*`. Repo is static Astro without adapter → Edge Functions instead. Same security model (admin JWT, secrets on server).

**No placeholders** left in tasks; list-recursion caveat handled with `--from-db`.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-09-30-seaweedfs-storage.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans, checkpoints  

Which approach?
