export const STORAGE_KINDS = {
  previews: 'previews',
  originals: 'originals',
  covers: 'covers',
};

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

export function resolveStorageKind(bucketOrKind) {
  const k = LEGACY_BUCKET_TO_KIND[String(bucketOrKind || '').trim()];
  if (!k) throw new Error(`Unknown storage kind: ${bucketOrKind}`);
  return k;
}

export function cleanStoragePath(path) {
  return String(path || '').replace(/^\/+/, '').replace(/\.\./g, '');
}

export function objectKey(bucketOrKind, path) {
  const kind = resolveStorageKind(bucketOrKind);
  const clean = cleanStoragePath(path);
  if (!clean) throw new Error('Empty storage path');
  return `${kind}/${clean}`;
}

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
