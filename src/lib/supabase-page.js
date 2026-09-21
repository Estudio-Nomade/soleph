/**
 * PostgREST / Supabase default max-rows is 1000.
 * Huge `.in(uuid, …)` filters also 400 — prefer filter by category_id + range.
 */

export const SUPABASE_PAGE = 1000;
/** Safe chunk for `.in('id', ids)` URL length */
export const IN_CHUNK = 80;

/**
 * @template T
 * @param {(from: number, to: number) => PromiseLike<{ data: T[] | null, error: { message?: string } | null }>} query
 * @returns {Promise<T[]>}
 */
export async function fetchAllPages(query) {
  /** @type {T[]} */
  const all = [];
  let from = 0;
  for (;;) {
    const to = from + SUPABASE_PAGE - 1;
    const { data, error } = await query(from, to);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < SUPABASE_PAGE) break;
    from += SUPABASE_PAGE;
  }
  return all;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} albumId
 * @param {string} [select]
 */
export async function fetchAlbumPhotos(sb, albumId, select = '*') {
  return fetchAllPages((from, to) =>
    sb
      .from('photos')
      .select(select)
      .eq('album_id', albumId)
      .order('sort_order', { ascending: true })
      .range(from, to),
  );
}

/**
 * Links photo_id → category_id for an album.
 * Prefer category_id IN (album cats) + pages; fallback chunk photo ids.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {{ categoryIds?: string[], photoIds?: string[] }} opts
 * @returns {Promise<Array<{ photo_id: string, category_id: string }>>}
 */
export async function fetchPhotoCategoryLinks(sb, { categoryIds = [], photoIds = [] } = {}) {
  if (categoryIds.length) {
    return fetchAllPages((from, to) =>
      sb
        .from('photo_categories')
        .select('photo_id, category_id')
        .in('category_id', categoryIds)
        .order('photo_id', { ascending: true })
        .range(from, to),
    );
  }
  if (!photoIds.length) return [];
  /** @type {Array<{ photo_id: string, category_id: string }>} */
  const links = [];
  for (let i = 0; i < photoIds.length; i += IN_CHUNK) {
    const chunk = photoIds.slice(i, i + IN_CHUNK);
    const { data, error } = await sb
      .from('photo_categories')
      .select('photo_id, category_id')
      .in('photo_id', chunk);
    if (error) throw error;
    links.push(...(data || []));
  }
  return links;
}

/**
 * @param {Array<{ photo_id: string, category_id: string }>} links
 * @returns {Record<string, string[]>}
 */
export function linksToPhotoCatMap(links) {
  /** @type {Record<string, string[]>} */
  const map = {};
  for (const row of links || []) {
    if (!map[row.photo_id]) map[row.photo_id] = [];
    map[row.photo_id].push(row.category_id);
  }
  return map;
}
