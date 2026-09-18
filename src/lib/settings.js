import { getSupabase, isSupabaseConfigured } from './supabase.js';

const DEFAULT_TRANSFER = {
  owner: 'Sole Yaquinta',
  alias: null,
  cbu: null,
  bank: null,
};

const DEFAULT_FORMATS = {
  default: 'redes',
  options: [
    {
      id: 'redes',
      label: 'Para redes',
      hint: 'Archivo liviano, listo para subir a IG/web.',
    },
    {
      id: 'impresion',
      label: 'Para impresión',
      hint: 'Alta resolución para imprimir (hasta el tamaño que indique Sole).',
    },
  ],
};

/**
 * @param {any} raw
 * @param {typeof DEFAULT_FORMATS} fallback
 */
export function normalizeFormats(raw, fallback = DEFAULT_FORMATS) {
  const fb = fallback || DEFAULT_FORMATS;
  const optionsIn = Array.isArray(raw?.options) ? raw.options : fb.options;
  const options = optionsIn
    .map((o) => ({
      id: String(o?.id || '').trim() || 'redes',
      label: String(o?.label || '').trim() || o?.id || 'Formato',
      hint: String(o?.hint || '').trim(),
    }))
    .filter((o) => o.id);
  const def = String(raw?.default || fb.default || 'redes');
  return {
    default: options.some((o) => o.id === def) ? def : options[0]?.id || 'redes',
    options: options.length ? options : fb.options,
  };
}

/**
 * Lee datos de transferencia desde Supabase settings.
 * Si falla o no hay config, devuelve el fallback (site.json).
 * @param {{ owner?: string|null, alias?: string|null, cbu?: string|null, bank?: string|null }} fallback
 */
export async function loadTransferSettings(fallback = {}) {
  const store = await loadStorefrontSettings({ transfer: fallback });
  return store.transfer;
}

/**
 * storefront settings: transfer + formats (textos de carrito).
 * @param {{ transfer?: any, formats?: any }} fallback
 */
export async function loadStorefrontSettings(fallback = {}) {
  const baseTransfer = {
    ...DEFAULT_TRANSFER,
    ...(fallback.transfer && typeof fallback.transfer === 'object' ? fallback.transfer : {}),
  };
  const baseFormats = normalizeFormats(fallback.formats, DEFAULT_FORMATS);

  if (!isSupabaseConfigured()) {
    return { transfer: baseTransfer, formats: baseFormats };
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('settings').select('value').eq('key', 'storefront').maybeSingle();
    if (error) throw error;
    const value = data?.value && typeof data.value === 'object' ? data.value : {};
    const transferRaw = value.transfer && typeof value.transfer === 'object' ? value.transfer : {};
    return {
      transfer: {
        owner: transferRaw.owner || baseTransfer.owner || DEFAULT_TRANSFER.owner,
        alias: transferRaw.alias ?? baseTransfer.alias ?? null,
        cbu: transferRaw.cbu ?? baseTransfer.cbu ?? null,
        bank: transferRaw.bank ?? baseTransfer.bank ?? null,
      },
      formats: normalizeFormats(value.formats, baseFormats),
      raw: value,
    };
  } catch (err) {
    console.warn('loadStorefrontSettings', err?.message || err);
    return { transfer: baseTransfer, formats: baseFormats, raw: {} };
  }
}

/**
 * Precios live de álbumes por id (para carrito multi-evento).
 * @param {string[]} albumIds
 * @returns {Promise<Record<string, { unit: number, tiers: Array<{quantity:number,price:number}>, name?: string }>>}
 */
export async function loadAlbumPrices(albumIds) {
  /** @type {Record<string, { unit: number, tiers: any[], name?: string }>} */
  const map = {};
  const ids = [...new Set((albumIds || []).map(String).filter(Boolean))];
  if (!ids.length || !isSupabaseConfigured()) return map;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('albums')
      .select('id, name, photo_price_ars, price_tiers, published')
      .in('id', ids);
    if (error) throw error;
    for (const a of data || []) {
      map[a.id] = {
        unit: Number(a.photo_price_ars) || 0,
        tiers: Array.isArray(a.price_tiers) ? a.price_tiers : [],
        name: a.name,
      };
    }
  } catch (err) {
    console.warn('loadAlbumPrices', err?.message || err);
  }
  return map;
}

export { DEFAULT_TRANSFER, DEFAULT_FORMATS };
