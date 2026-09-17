import { getSupabase, isSupabaseConfigured } from './supabase.js';

const DEFAULT_TRANSFER = {
  owner: 'Sole Yaquinta',
  alias: null,
  cbu: null,
  bank: null,
};

/**
 * Lee datos de transferencia desde Supabase settings.
 * Si falla o no hay config, devuelve el fallback (site.json).
 * @param {{ owner?: string|null, alias?: string|null, cbu?: string|null, bank?: string|null }} fallback
 */
export async function loadTransferSettings(fallback = {}) {
  const base = {
    ...DEFAULT_TRANSFER,
    ...(fallback && typeof fallback === 'object' ? fallback : {}),
  };

  if (!isSupabaseConfigured()) return base;

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('settings').select('value').eq('key', 'storefront').maybeSingle();
    if (error) throw error;
    const transfer = data?.value?.transfer;
    if (!transfer || typeof transfer !== 'object') return base;
    return {
      owner: transfer.owner || base.owner || DEFAULT_TRANSFER.owner,
      alias: transfer.alias ?? base.alias ?? null,
      cbu: transfer.cbu ?? base.cbu ?? null,
      bank: transfer.bank ?? base.bank ?? null,
    };
  } catch (err) {
    console.warn('loadTransferSettings', err?.message || err);
    return base;
  }
}

export { DEFAULT_TRANSFER };
