import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anon = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let browserClient = null;

export function isSupabaseConfigured() {
  return Boolean(url && anon && !String(url).includes('YOUR_PROJECT'));
}

export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('Falta configurar PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY en .env');
  }
  if (typeof window === 'undefined') {
    return createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  if (!browserClient) {
    browserClient = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'soleph-admin-auth',
      },
    });
  }
  return browserClient;
}

export function publicStorageUrl(bucket, path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const base = String(url || '').replace(/\/$/, '');
  const clean = String(path).replace(/^\//, '');
  return `${base}/storage/v1/object/public/${bucket}/${clean}`;
}

export const BUCKETS = {
  previews: 'album-previews',
  originals: 'album-originals',
  covers: 'album-covers',
};
