#!/usr/bin/env node
/**
 * Copy Supabase Storage buckets → Seaweed bucket `storage` with prefixes.
 *
 * Primary (reliable):
 *   DRY_RUN=1 node scripts/migrate-supabase-to-s3.mjs --from-db
 *   node scripts/migrate-supabase-to-s3.mjs --from-db
 *
 * Optional list mode (no --from-db): walks album-* buckets via storage.list.
 *
 * Env:
 *   PUBLIC_SUPABASE_URL or SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   S3_BUCKET=storage, S3_REGION=us-east-1
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const DRY = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');
const FROM_DB = process.argv.includes('--from-db');

const MAP = [
  { supabaseBucket: 'album-previews', prefix: 'previews', field: 'preview' },
  { supabaseBucket: 'album-originals', prefix: 'originals', field: 'original' },
  { supabaseBucket: 'album-covers', prefix: 'covers', field: 'cover' },
];

const sbUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!sbUrl || !serviceKey) {
  console.error('Need PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const endpoint = process.env.S3_ENDPOINT;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
if (!endpoint || !accessKeyId || !secretAccessKey) {
  console.error('Need S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const bucket = process.env.S3_BUCKET || 'storage';
const sb = createClient(sbUrl, serviceKey);

/**
 * @param {string} path
 */
function cleanPath(path) {
  return String(path || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\.\./g, '');
}

/**
 * Skip full URLs already on media host or external; only relative storage paths.
 * @param {string} raw
 */
function isRelativeStoragePath(raw) {
  const p = String(raw || '').trim();
  if (!p) return false;
  if (/^https?:\/\//i.test(p)) return false;
  if (p.startsWith('/images/') || p.startsWith('images/')) return false;
  return true;
}

/**
 * @param {string} key
 */
async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} supabaseBucket
 * @param {string} prefix
 * @param {string} path
 * @returns {Promise<'ok'|'dry'|'skip'>}
 */
async function copyOne(supabaseBucket, prefix, path) {
  const clean = cleanPath(path);
  if (!clean) return 'skip';
  const key = `${prefix}/${clean}`;

  if (await exists(key)) {
    console.log('skip exists', key);
    return 'skip';
  }

  const { data, error } = await sb.storage.from(supabaseBucket).download(clean);
  if (error) throw error;
  if (!data) throw new Error('empty download');

  const buf = Buffer.from(await data.arrayBuffer());
  const contentType =
    (typeof data.type === 'string' && data.type) || guessContentType(clean) || 'application/octet-stream';

  if (DRY) {
    console.log('dry-run would put', key, buf.length, contentType);
    return 'dry';
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buf,
      ContentType: contentType,
    }),
  );
  console.log('ok', key, buf.length);
  return 'ok';
}

/**
 * @param {string} path
 */
function guessContentType(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return null;
}

/**
 * Paginate Supabase select until empty.
 * @param {string} table
 * @param {string} columns
 * @param {(row: Record<string, unknown>) => void} onRow
 */
async function forEachRow(table, columns, onRow) {
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await sb.from(table).select(columns).range(from, to);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) onRow(row);
    if (data.length < pageSize) break;
    from += pageSize;
  }
}

/**
 * @returns {Promise<Map<string, Set<string>>>} prefix → paths
 */
async function collectPathsFromDb() {
  /** @type {Map<string, Set<string>>} */
  const byPrefix = new Map([
    ['previews', new Set()],
    ['originals', new Set()],
    ['covers', new Set()],
  ]);

  await forEachRow('photos', 'preview_path, original_path', (row) => {
    const preview = cleanPath(/** @type {string} */ (row.preview_path));
    const original = cleanPath(/** @type {string} */ (row.original_path));
    if (isRelativeStoragePath(preview)) byPrefix.get('previews').add(preview);
    if (isRelativeStoragePath(original)) byPrefix.get('originals').add(original);
  });

  await forEachRow('albums', 'cover_path', (row) => {
    const cover = cleanPath(/** @type {string} */ (row.cover_path));
    if (isRelativeStoragePath(cover)) byPrefix.get('covers').add(cover);
  });

  // Portfolio covers live in settings JSON as full public URLs or paths — try path-only under covers
  try {
    const { data, error } = await sb.from('settings').select('value').eq('key', 'portfolio').maybeSingle();
    if (!error && data?.value && typeof data.value === 'object') {
      const val = /** @type {Record<string, unknown>} */ (data.value);
      const about = val.about && typeof val.about === 'object' ? /** @type {Record<string, unknown>} */ (val.about) : {};
      const image = about.image;
      if (typeof image === 'string' && isRelativeStoragePath(image)) {
        byPrefix.get('covers').add(cleanPath(image));
      }
      const projects = Array.isArray(val.projects) ? val.projects : [];
      for (const p of projects) {
        if (!p || typeof p !== 'object') continue;
        const proj = /** @type {Record<string, unknown>} */ (p);
        for (const key of ['cover', 'images']) {
          const v = proj[key];
          if (typeof v === 'string' && isRelativeStoragePath(v)) {
            byPrefix.get('covers').add(cleanPath(v));
          } else if (Array.isArray(v)) {
            for (const item of v) {
              if (typeof item === 'string' && isRelativeStoragePath(item)) {
                byPrefix.get('covers').add(cleanPath(item));
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('portfolio settings skipped', /** @type {Error} */ (e)?.message || e);
  }

  return byPrefix;
}

/**
 * Recursive list of files in a Supabase storage bucket (best-effort).
 * @param {string} bucketName
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
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
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const looksFolder =
        entry.id == null ||
        (entry.metadata == null && !String(entry.name || '').includes('.'));
      if (looksFolder) {
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

/**
 * @param {string} prefix
 */
function supabaseBucketForPrefix(prefix) {
  const row = MAP.find((m) => m.prefix === prefix);
  if (!row) throw new Error(`unknown prefix ${prefix}`);
  return row.supabaseBucket;
}

async function runFromDb() {
  console.log('mode=from-db', DRY ? 'DRY_RUN' : 'LIVE');
  const byPrefix = await collectPathsFromDb();
  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const [prefix, paths] of byPrefix) {
    const supabaseBucket = supabaseBucketForPrefix(prefix);
    const list = [...paths].sort();
    console.log('from-db', prefix, 'count', list.length, '←', supabaseBucket);
    for (const path of list) {
      try {
        const r = await copyOne(supabaseBucket, prefix, path);
        if (r === 'ok' || r === 'dry') ok += 1;
        else skip += 1;
      } catch (e) {
        fail += 1;
        console.error('fail', prefix, path, /** @type {Error} */ (e)?.message || e);
      }
    }
  }

  console.log({ ok, skip, fail, DRY, mode: 'from-db' });
  if (fail > 0) process.exitCode = 1;
}

async function runListMode() {
  console.log('mode=list', DRY ? 'DRY_RUN' : 'LIVE');
  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const { supabaseBucket, prefix } of MAP) {
    console.log('listing', supabaseBucket);
    let paths = [];
    try {
      paths = await listAll(supabaseBucket, '');
    } catch (e) {
      console.error('list failed', supabaseBucket, /** @type {Error} */ (e)?.message || e);
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
        console.error('fail', prefix, path, /** @type {Error} */ (e)?.message || e);
      }
    }
  }

  console.log({ ok, skip, fail, DRY, mode: 'list' });
  if (fail > 0) process.exitCode = 1;
}

async function main() {
  if (FROM_DB) await runFromDb();
  else await runListMode();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
