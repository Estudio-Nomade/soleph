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
