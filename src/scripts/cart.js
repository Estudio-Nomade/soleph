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

/** FullFoto-style tiers: base unit price, or pack total when qty hits a tier. */
export function priceForQuantity(qty, unitPrice, tiers = []) {
  if (!qty) return 0;
  const sorted = [...tiers].sort((a, b) => b.quantity - a.quantity);
  for (const tier of sorted) {
    if (qty >= tier.quantity) return tier.price;
  }
  return qty * unitPrice;
}

/**
 * Total del carrito agrupando por álbum (cada uno con su unit + packs).
 * @param {Array<{albumId?: string, unitPrice?: number}>} [items]
 * @param {Record<string, { unit: number, tiers: any[] }>} [albumPrices]
 */
export function cartTotalByAlbums(items, albumPrices = {}) {
  const list = items || readCart();
  /** @type {Record<string, { qty: number, unit: number, tiers: any[] }>} */
  const groups = {};
  for (const item of list) {
    const key = item.albumId || '__none__';
    const live = albumPrices[key];
    const unit = Number(live?.unit) || Number(item.unitPrice) || 0;
    const tiers = Array.isArray(live?.tiers) ? live.tiers : [];
    if (!groups[key]) groups[key] = { qty: 0, unit, tiers };
    groups[key].qty += 1;
    // prefer live unit if present
    if (live?.unit) {
      groups[key].unit = Number(live.unit) || groups[key].unit;
      groups[key].tiers = tiers;
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
