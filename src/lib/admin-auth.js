import { getSupabase } from './supabase.js';

/**
 * @returns {Promise<{ session: import('@supabase/supabase-js').Session | null, profile: { id: string, role: string, full_name?: string } | null, error?: string }>}
 */
export async function getAdminSession() {
  const sb = getSupabase();
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError) {
    return { session: null, profile: null, error: sessionError.message };
  }
  const session = sessionData.session;
  if (!session?.user) {
    return { session: null, profile: null };
  }

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', session.user.id)
    .maybeSingle();

  if (profileError) {
    return { session, profile: null, error: profileError.message };
  }
  if (!profile || profile.role !== 'admin') {
    return { session, profile: profile || null, error: 'Sin permiso de admin' };
  }
  return { session, profile };
}

export async function requireAdminOrRedirect() {
  try {
    const result = await getAdminSession();
    if (!result.session || result.profile?.role !== 'admin') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/admin/login?next=${next}`);
      return null;
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error de auth';
    window.location.replace(`/admin/login?error=${encodeURIComponent(msg)}`);
    return null;
  }
}

export async function signOutAdmin() {
  const sb = getSupabase();
  await sb.auth.signOut();
  window.location.replace('/admin/login');
}

export function slugify(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `evento-${Date.now().toString(36)}`;
}

export function formatArs(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(v);
}
