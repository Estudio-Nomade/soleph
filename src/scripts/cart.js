const STORAGE_KEY = 'soleph-cart-v1';
export const DEFAULT_FORMAT = 'redes';

function readCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({
      ...item,
      format: item.format === 'impresion' ? 'impresion' : DEFAULT_FORMAT,
      code:
        item.code ||
        (item.id && String(item.id).replace(/-/g, '').slice(0, 8).toUpperCase()) ||
        '',
      unitPrice: Number(item.unitPrice) || 0,
    }));
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('soleph:cart', { detail: items }));
}

export function getCart() {
  return readCart();
}

export function cartCount() {
  return readCart().length;
}

export function addToCart(item) {
  const items = readCart();
  if (items.some((x) => x.id === item.id)) return items;
  const code =
    item.code ||
    (item.id && String(item.id).replace(/-/g, '').slice(0, 8).toUpperCase()) ||
    '';
  items.push({
    id: item.id,
    code,
    src: item.src,
    thumb: item.thumb || item.src,
    albumId: item.albumId,
    albumName: item.albumName,
    unitPrice: Number(item.unitPrice) || 0,
    format: item.format === 'impresion' ? 'impresion' : DEFAULT_FORMAT,
  });
  writeCart(items);
  return items;
}

export function removeFromCart(id) {
  const items = readCart().filter((x) => x.id !== id);
  writeCart(items);
  return items;
}

export function setItemFormat(id, format) {
  const next = format === 'impresion' ? 'impresion' : DEFAULT_FORMAT;
  const items = readCart().map((item) => (item.id === id ? { ...item, format: next } : item));
  writeCart(items);
  return items;
}

/**
 * Actualiza unitPrice (y opcional nombre) de ítems de un álbum cuando llega el precio live.
 * @param {string} albumId
 * @param {{ unitPrice?: number, albumName?: string }} patch
 */
export function patchCartAlbumPricing(albumId, patch = {}) {
  if (!albumId) return readCart();
  const unit = Number(patch.unitPrice);
  const items = readCart().map((item) => {
    if (item.albumId !== albumId) return item;
    return {
      ...item,
      unitPrice: Number.isFinite(unit) && unit > 0 ? unit : item.unitPrice,
      albumName: patch.albumName || item.albumName,
    };
  });
  writeCart(items);
  return items;
}

export function clearCart() {
  writeCart([]);
}

export function isInCart(id) {
  return readCart().some((x) => x.id === id);
}

export function formatLabel(format) {
  return format === 'impresion' ? 'Impresión' : 'Redes';
}

/**
 * Normaliza packs y precio unitario.
 * Si hay pack qty=1, ese precio gana como unitario (coincide con admin).
 * @param {Array<{quantity?: number, price?: number}>} tiers
 * @param {number} unitPrice
 */
export function normalizePriceTiers(tiers = [], unitPrice = 0) {
  const packs = (Array.isArray(tiers) ? tiers : [])
    .map((t) => ({
      quantity: Math.max(0, Math.floor(Number(t?.quantity) || 0)),
      price: Math.max(0, Number(t?.price) || 0),
    }))
    .filter((t) => t.quantity > 0);

  let unit = Math.max(0, Number(unitPrice) || 0);
  const one = packs.find((t) => t.quantity === 1);
  if (one && one.price > 0) unit = one.price;

  return { unit, packs };
}

/**
 * Precio total por cantidad (packs FullFoto-style).
 * Elige la combinación de packs + unitarios de menor costo.
 * Ej.: unit 3500, pack 3→9000 → 4 fotos = 9000 + 3500 = 12500 (no se queda en 9000).
 *
 * @param {number} qty
 * @param {number} unitPrice
 * @param {Array<{quantity?: number, price?: number}>} tiers
 */
export function priceForQuantity(qty, unitPrice, tiers = []) {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  if (!n) return 0;

  const { unit, packs } = normalizePriceTiers(tiers, unitPrice);
  /** @type {Array<{ quantity: number, price: number }>} */
  const options = [];
  if (unit > 0) options.push({ quantity: 1, price: unit });
  for (const p of packs) {
    if (p.quantity === 1) continue; // ya cubierto por unit
    if (p.price <= 0) continue;
    options.push(p);
  }
  if (!options.length) return 0;

  // DP: menor costo para exactamente k fotos
  const INF = Number.POSITIVE_INFINITY;
  const dp = Array(n + 1).fill(INF);
  dp[0] = 0;
  for (let k = 1; k <= n; k++) {
    for (const opt of options) {
      if (k < opt.quantity) continue;
      const prev = dp[k - opt.quantity];
      if (!Number.isFinite(prev)) continue;
      const cand = prev + opt.price;
      if (cand < dp[k]) dp[k] = cand;
    }
  }
  if (Number.isFinite(dp[n])) return dp[n];
  // fallback: solo unitario si quedó algo raro
  return unit > 0 ? n * unit : 0;
}

/** Seed de precios de series estáticas (site.json) por id de álbum. */
function seedAlbumPricesFromSite() {
  /** @type {Record<string, { unit: number, tiers: any[], name?: string }>} */
  const map = {};
  try {
    // lazy: evita ciclo si no hay site en algún bundle
    const albums = typeof window !== 'undefined' && window.__SOLEPH_SHOP_ALBUMS__;
    const list = Array.isArray(albums) ? albums : [];
    for (const a of list) {
      if (!a?.id) continue;
      map[String(a.id)] = {
        unit: Number(a.photo_price ?? a.photo_price_ars) || 0,
        tiers: Array.isArray(a.price_tiers) ? a.price_tiers : [],
        name: a.name,
      };
    }
  } catch {
    /* ignore */
  }
  return map;
}

/**
 * Total del carrito agrupando por álbum (cada uno con su unit + packs).
 * @param {Array<{albumId?: string, unitPrice?: number}>} [items]
 * @param {Record<string, { unit: number, tiers: any[] }>} [albumPrices]
 */
export function cartTotalByAlbums(items, albumPrices = {}) {
  const list = items || readCart();
  const seed = seedAlbumPricesFromSite();
  /** @type {Record<string, { qty: number, unit: number, tiers: any[], name?: string }>} */
  const groups = {};
  for (const item of list) {
    const key = item.albumId || '__none__';
    const live = albumPrices[key] || seed[key] || null;
    const rawTiers = Array.isArray(live?.tiers) ? live.tiers : [];
    const { unit: resolvedUnit, packs } = normalizePriceTiers(
      rawTiers,
      Number(live?.unit) || Number(item.unitPrice) || 0,
    );
    // packs + qty1 para priceForQuantity
    const tiers =
      packs.length || rawTiers.length
        ? [
            ...(resolvedUnit > 0 ? [{ quantity: 1, price: resolvedUnit }] : []),
            ...packs.filter((p) => p.quantity !== 1),
          ]
        : [];
    if (!groups[key]) {
      groups[key] = {
        qty: 0,
        unit: resolvedUnit,
        tiers: tiers.length ? tiers : rawTiers,
        name: live?.name,
      };
    }
    groups[key].qty += 1;
    if (live) {
      groups[key].unit = resolvedUnit || groups[key].unit;
      groups[key].tiers = tiers.length ? tiers : groups[key].tiers;
      if (live.name) groups[key].name = live.name;
    } else if (resolvedUnit && !groups[key].unit) {
      groups[key].unit = resolvedUnit;
    }
  }
  let total = 0;
  for (const g of Object.values(groups)) {
    total += priceForQuantity(g.qty, g.unit, g.tiers);
  }
  return { total, qty: list.length, groups };
}

export function formatARS(n) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);
}

export function cartTotals(unitPrice, tiers) {
  const items = readCart();
  const qty = items.length;
  const total = priceForQuantity(qty, unitPrice, tiers);
  return { qty, total, items };
}
