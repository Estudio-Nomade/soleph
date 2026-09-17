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
  items.push({
    id: item.id,
    src: item.src,
    thumb: item.thumb || item.src,
    albumId: item.albumId,
    albumName: item.albumName,
    unitPrice: item.unitPrice,
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
