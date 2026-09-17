import { createClient } from '@supabase/supabase-js';

const url = String(import.meta.env.PUBLIC_SUPABASE_URL || '').trim();
const anon = String(import.meta.env.PUBLIC_SUPABASE_ANON_KEY || '').trim();

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let browserClient = null;

export function isSupabaseConfigured() {
  if (!url || !anon) return false;
  if (url.includes('YOUR_PROJECT')) return false;
  if (anon === 'your-anon-key' || anon.length < 20) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

/** Host only — safe to show in UI */
export function supabaseHost() {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Falta configurar PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY en .env (y reiniciar npm run dev)',
    );
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
