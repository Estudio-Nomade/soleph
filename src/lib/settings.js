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

/** Texto que sale arriba del grilla en /tienda/{álbum} (portafolio estático y fallback). */
const DEFAULT_ALBUM_MESSAGE =
  'Alta resolución. Cuando confirmamos la transferencia por WhatsApp, te la mando por ahí.';

/** Precios canónicos (mismos para eventos y portafolio seed). */
const DEFAULT_PRICING = {
  photo_price: 3500,
  price_tiers: [
    { quantity: 1, price: 3500 },
    { quantity: 3, price: 9000 },
    { quantity: 5, price: 13000 },
    { quantity: 10, price: 23000 },
  ],
};

/**
 * @param {any} raw
 * @param {typeof DEFAULT_PRICING} fallback
 */
export function normalizePricing(raw, fallback = DEFAULT_PRICING) {
  const fb = fallback || DEFAULT_PRICING;
  const tiersIn = Array.isArray(raw?.price_tiers)
    ? raw.price_tiers
    : Array.isArray(raw?.tiers)
      ? raw.tiers
      : fb.price_tiers;
  const tiers = tiersIn
    .map((t) => ({
      quantity: Math.max(0, Math.floor(Number(t?.quantity) || 0)),
      price: Math.max(0, Number(t?.price) || 0),
    }))
    .filter((t) => t.quantity > 0);
  let unit = Math.max(0, Number(raw?.photo_price ?? raw?.photo_price_ars ?? fb.photo_price) || 0);
  const one = tiers.find((t) => t.quantity === 1);
  if (one && one.price > 0) unit = one.price;
  if (!unit && fb.photo_price) unit = fb.photo_price;
  const price_tiers =
    tiers.length > 0
      ? tiers
      : [
          ...(unit ? [{ quantity: 1, price: unit }] : []),
          ...fb.price_tiers.filter((t) => t.quantity !== 1),
        ];
  // ensure qty=1 present
  if (!price_tiers.some((t) => t.quantity === 1) && unit > 0) {
    price_tiers.unshift({ quantity: 1, price: unit });
  }
  price_tiers.sort((a, b) => a.quantity - b.quantity);
  return { photo_price: unit, price_tiers };
}

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
 * Mensajes de álbum en tienda: default + overrides por id/slug.
 * @param {any} raw
 * @param {{ default?: string, by_id?: Record<string, string> }} fallback
 */
export function normalizeAlbumMessages(raw, fallback = {}) {
  const baseDefault =
    String(fallback?.default || '').trim() || DEFAULT_ALBUM_MESSAGE;
  const byIdIn =
    raw?.by_id && typeof raw.by_id === 'object' && !Array.isArray(raw.by_id)
      ? raw.by_id
      : fallback?.by_id && typeof fallback.by_id === 'object'
        ? fallback.by_id
        : {};
  /** @type {Record<string, string>} */
  const by_id = {};
  for (const [k, v] of Object.entries(byIdIn || {})) {
    const id = String(k || '').trim();
    const msg = String(v || '').trim();
    if (id && msg) by_id[id] = msg;
  }
  return {
    default: String(raw?.default ?? baseDefault).trim() || baseDefault,
    by_id,
  };
}

/**
 * Resuelve el mensaje a mostrar para un álbum de tienda.
 * - by_id[id|slug|…] siempre gana (texto propio desde admin Portafolio)
 * - preferOwn=true (eventos live): message del álbum en SB → default storefront
 * - preferOwn=false (series estáticas site.json): default storefront → message seed
 * @param {string|string[]} albumId id o lista de claves a probar (id, slug, …)
 * @param {{ default?: string, by_id?: Record<string, string> }|null|undefined} albumMessages
 * @param {string|null|undefined} albumOwnMessage
 * @param {string} [fallback]
 * @param {{ preferOwn?: boolean }} [opts]
 */
export function resolveAlbumMessage(
  albumId,
  albumMessages,
  albumOwnMessage,
  fallback = DEFAULT_ALBUM_MESSAGE,
  opts = {},
) {
  const preferOwn = !!opts.preferOwn;
  const keys = (Array.isArray(albumId) ? albumId : [albumId])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  const map = albumMessages?.by_id && typeof albumMessages.by_id === 'object' ? albumMessages.by_id : {};
  for (const id of keys) {
    const hit = map[id];
    if (hit != null && String(hit).trim()) return String(hit).trim();
  }

  const own = String(albumOwnMessage || '').trim();
  const def = String(albumMessages?.default || '').trim();

  if (preferOwn) {
    if (own) return own;
    if (def) return def;
    return fallback;
  }

  // series estáticas: el texto del admin (default) pisa el seed de site.json
  if (def) return def;
  if (own) return own;
  return fallback;
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
 * storefront settings: transfer + formats + album_messages + pricing.
 * @param {{ transfer?: any, formats?: any, album_messages?: any, pricing?: any }} fallback
 */
export async function loadStorefrontSettings(fallback = {}) {
  const baseTransfer = {
    ...DEFAULT_TRANSFER,
    ...(fallback.transfer && typeof fallback.transfer === 'object' ? fallback.transfer : {}),
  };
  const baseFormats = normalizeFormats(fallback.formats, DEFAULT_FORMATS);
  const baseAlbumMessages = normalizeAlbumMessages(fallback.album_messages, {
    default: DEFAULT_ALBUM_MESSAGE,
  });
  const basePricing = normalizePricing(fallback.pricing, DEFAULT_PRICING);

  if (!isSupabaseConfigured()) {
    return {
      transfer: baseTransfer,
      formats: baseFormats,
      album_messages: baseAlbumMessages,
      pricing: basePricing,
    };
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('settings').select('value').eq('key', 'storefront').maybeSingle();
    if (error) throw error;
    const value = data?.value && typeof data.value === 'object' ? data.value : {};
    const transferRaw = value.transfer && typeof value.transfer === 'object' ? value.transfer : {};

    // pricing: storefront.pricing si existe; si no, primer álbum publicado live
    let pricing = normalizePricing(value.pricing, basePricing);
    if (!value.pricing) {
      try {
        const { data: albums } = await sb
          .from('albums')
          .select('photo_price_ars, price_tiers, published, updated_at')
          .eq('published', true)
          .order('updated_at', { ascending: false })
          .limit(5);
        const live = (albums || []).find((a) => Number(a.photo_price_ars) > 0);
        if (live) {
          pricing = normalizePricing(
            {
              photo_price: live.photo_price_ars,
              price_tiers: live.price_tiers,
            },
            basePricing,
          );
        }
      } catch {
        /* keep base */
      }
    }

    return {
      transfer: {
        owner: transferRaw.owner || baseTransfer.owner || DEFAULT_TRANSFER.owner,
        alias: transferRaw.alias ?? baseTransfer.alias ?? null,
        cbu: transferRaw.cbu ?? baseTransfer.cbu ?? null,
        bank: transferRaw.bank ?? baseTransfer.bank ?? null,
      },
      formats: normalizeFormats(value.formats, baseFormats),
      album_messages: normalizeAlbumMessages(value.album_messages, baseAlbumMessages),
      pricing,
      raw: value,
    };
  } catch (err) {
    console.warn('loadStorefrontSettings', err?.message || err);
    return {
      transfer: baseTransfer,
      formats: baseFormats,
      album_messages: baseAlbumMessages,
      pricing: basePricing,
      raw: {},
    };
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
  if (!ids.length) return map;

  // seed estático (portafolio site.json)
  const seedAlbums =
    typeof window !== 'undefined' && Array.isArray(window.__SOLEPH_SHOP_ALBUMS__)
      ? window.__SOLEPH_SHOP_ALBUMS__
      : [];
  const seedPricing =
    typeof window !== 'undefined' && window.__SOLEPH_SEED_PRICING__
      ? window.__SOLEPH_SEED_PRICING__
      : null;

  for (const id of ids) {
    const seed = seedAlbums.find((a) => String(a?.id) === id);
    if (seed) {
      map[id] = {
        unit: Number(seed.photo_price ?? seed.photo_price_ars) || Number(seedPricing?.photo_price) || 0,
        tiers: Array.isArray(seed.price_tiers)
          ? seed.price_tiers
          : Array.isArray(seedPricing?.price_tiers)
            ? seedPricing.price_tiers
            : [],
        name: seed.name,
      };
    } else if (seedPricing?.photo_price) {
      // ids desconocidos (o seed sin match): usar pricing canónico compartido
      map[id] = {
        unit: Number(seedPricing.photo_price) || 0,
        tiers: Array.isArray(seedPricing.price_tiers) ? seedPricing.price_tiers : [],
      };
    }
  }

  if (!isSupabaseConfigured()) return map;
  try {
    const sb = getSupabase();
    // live albums by uuid
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

    // if still missing unit for static ids, pull shared live pricing once
    const missing = ids.filter((id) => !map[id]?.unit);
    if (missing.length) {
      const store = await loadStorefrontSettings({
        pricing: seedPricing || DEFAULT_PRICING,
      });
      const p = store.pricing;
      for (const id of missing) {
        map[id] = {
          unit: Number(p.photo_price) || map[id]?.unit || 0,
          tiers: Array.isArray(p.price_tiers) ? p.price_tiers : map[id]?.tiers || [],
          name: map[id]?.name,
        };
      }
    }
  } catch (err) {
    console.warn('loadAlbumPrices', err?.message || err);
  }
  return map;
}

export { DEFAULT_TRANSFER, DEFAULT_FORMATS, DEFAULT_ALBUM_MESSAGE, DEFAULT_PRICING };
