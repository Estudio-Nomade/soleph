/**
 * Álbumes publicados en Supabase (storefront live).
 * site.json sigue como portafolio/demo estático.
 */

import { getSupabase, isSupabaseConfigured, publicStorageUrl, BUCKETS } from './supabase.js';

/**
 * @param {string|null|undefined} coverPath
 */
export function albumCoverUrl(coverPath) {
  if (!coverPath) return '/images/logo.png';
  if (/^https?:\/\//i.test(coverPath) || String(coverPath).startsWith('/')) return coverPath;
  return publicStorageUrl(BUCKETS.previews, coverPath) || publicStorageUrl(BUCKETS.covers, coverPath);
}

/**
 * @returns {Promise<Array<{
 *   id: string,
 *   slug: string,
 *   name: string,
 *   kind: string,
 *   date_label: string|null,
 *   message: string|null,
 *   photo_price_ars: number,
 *   price_tiers: Array<{quantity:number, price:number}>,
 *   cover_path: string|null,
 *   cover: string,
 *   search_by_face: boolean,
 *   photo_count: number,
 * }>>}
 */
export async function listPublishedAlbums({ kind } = {}) {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  let q = sb
    .from('albums')
    .select(
      'id, slug, name, kind, date_label, message, photo_price_ars, price_tiers, cover_path, search_by_face, published, updated_at, photos(count)',
    )
    .eq('published', true)
    .order('updated_at', { ascending: false });
  if (kind === 'event' || kind === 'portfolio') {
    q = q.eq('kind', kind);
  }
  const { data, error } = await q;
  if (error) {
    // fallback sin aggregate si el embed falla
    const { data: plain, error: e2 } = await sb
      .from('albums')
      .select(
        'id, slug, name, kind, date_label, message, photo_price_ars, price_tiers, cover_path, search_by_face, published, updated_at',
      )
      .eq('published', true)
      .order('updated_at', { ascending: false });
    if (e2) throw e2;
    return (plain || [])
      .filter((a) => !kind || a.kind === kind || (!a.kind && kind === 'event'))
      .map((a) => normalizeAlbum(a, 0));
  }
  return (data || [])
    .filter((a) => {
      const k = a.kind || 'event';
      return !kind || k === kind;
    })
    .map((a) => {
      const count = Array.isArray(a.photos) && a.photos[0]?.count != null ? Number(a.photos[0].count) : 0;
      return normalizeAlbum(a, count);
    });
}

function normalizeAlbum(a, photoCount) {
  const tiers = Array.isArray(a.price_tiers) ? a.price_tiers : [];
  const unit = Number(a.photo_price_ars) || 0;
  return {
    id: a.id,
    slug: a.slug,
    name: a.name,
    kind: a.kind || 'event',
    date_label: a.date_label || null,
    message: a.message || null,
    photo_price_ars: unit,
    photo_price: unit,
    price_tiers: tiers,
    cover_path: a.cover_path || null,
    cover: albumCoverUrl(a.cover_path),
    search_by_face: a.search_by_face !== false,
    photo_count: photoCount,
    published: true,
  };
}

/**
 * @param {string} albumId
 */
export async function getPublishedAlbum(albumId) {
  if (!isSupabaseConfigured() || !albumId) return null;
  const sb = getSupabase();
  const { data: album, error } = await sb
    .from('albums')
    .select(
      'id, slug, name, kind, date_label, message, photo_price_ars, price_tiers, cover_path, search_by_face, published, updated_at',
    )
    .eq('id', albumId)
    .eq('published', true)
    .maybeSingle();
  if (error) throw error;
  if (!album) return null;

  const [{ data: photos, error: pErr }, { data: categories, error: cErr }] = await Promise.all([
    sb
      .from('photos')
      .select('id, code, preview_path, sort_order, source_filename')
      .eq('album_id', albumId)
      .order('sort_order', { ascending: true }),
    sb
      .from('categories')
      .select('id, name, slug, sort_order')
      .eq('album_id', albumId)
      .order('sort_order', { ascending: true }),
  ]);
  if (pErr) throw pErr;
  if (cErr) console.warn('categories', cErr.message);

  const photoIds = (photos || []).map((p) => p.id);
  /** @type {Record<string, string[]>} */
  const photoCatMap = {};
  if (photoIds.length) {
    const { data: links, error: lErr } = await sb
      .from('photo_categories')
      .select('photo_id, category_id')
      .in('photo_id', photoIds);
    if (lErr) console.warn('photo_categories', lErr.message);
    for (const row of links || []) {
      if (!photoCatMap[row.photo_id]) photoCatMap[row.photo_id] = [];
      photoCatMap[row.photo_id].push(row.category_id);
    }
  }

  const catList = categories || [];
  // bust preview CDN/browser cache when album meta changes (re-bake watermark)
  const albumBust = album.updated_at
    ? `?v=${encodeURIComponent(String(album.updated_at))}`
    : '';
  const list = (photos || []).map((p) => {
    const base = publicStorageUrl(BUCKETS.previews, p.preview_path);
    const src = base ? `${base}${albumBust}` : '';
    const categoryIds = photoCatMap[p.id] || [];
    return {
      id: p.id,
      code: p.code || String(p.id).replace(/-/g, '').slice(0, 8).toUpperCase(),
      src,
      thumb: src,
      preview_path: p.preview_path,
      categoryIds,
      // primary cat for simple grouping
      categoryId: categoryIds[0] || '',
    };
  });

  return {
    ...normalizeAlbum(album, list.length),
    categories: catList,
    photos: list,
  };
}
