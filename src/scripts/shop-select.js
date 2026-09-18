/**
 * Multi-select de fotos en tienda + lightbox + barra “Agregar al carrito”.
 * Tiles: [data-photo] con [data-open-photo] (ampliar) y [data-select] (checkbox).
 */
import { addToCart, isInCart } from './cart.js';

const selected = new Map(); // id -> item payload

function barEls() {
  const bar = document.querySelector('[data-shop-select-bar]');
  return {
    bar,
    countEl: bar?.querySelector('[data-select-count]'),
    addBtn: bar?.querySelector('[data-add-selected]'),
    clearBtn: bar?.querySelector('[data-clear-selected]'),
  };
}

function itemFromTile(tile) {
  const id = tile.getAttribute('data-id');
  const src = tile.getAttribute('data-src');
  if (!id || !src) return null;
  return {
    id,
    code: tile.getAttribute('data-code') || '',
    src,
    thumb: tile.getAttribute('data-thumb') || src,
    albumId: tile.getAttribute('data-album-id') || '',
    albumName: tile.getAttribute('data-album-name') || '',
    unitPrice: Number(tile.getAttribute('data-unit') || 0),
  };
}

function paintBar() {
  const { bar, countEl, addBtn } = barEls();
  const n = selected.size;
  if (!bar) return;
  bar.hidden = n === 0;
  bar.classList.toggle('is-on', n > 0);
  if (countEl) {
    countEl.textContent = n === 1 ? '1 foto elegida' : `${n} fotos elegidas`;
  }
  if (addBtn) {
    addBtn.textContent = n ? `Agregar al carrito (${n})` : 'Agregar al carrito';
    addBtn.disabled = n === 0;
  }
  document.body.classList.toggle('has-shop-select', n > 0);
}

function paintTile(tile) {
  const id = tile.getAttribute('data-id');
  if (!id) return;
  const on = selected.has(id);
  const inCart = isInCart(id);
  tile.classList.toggle('is-picked', on);
  tile.classList.toggle('is-in-cart', inCart);
  const check = tile.querySelector('[data-select]');
  if (check && /** @type {HTMLInputElement} */ (check).checked !== on) {
    /** @type {HTMLInputElement} */ (check).checked = on;
  }
  const mark = tile.querySelector('[data-in-cart-mark]');
  if (mark) mark.hidden = !inCart;
}

export function paintAllTiles(root = document) {
  root.querySelectorAll('[data-photo]').forEach((tile) => paintTile(tile));
  paintBar();
}

export function clearSelection() {
  selected.clear();
  paintAllTiles();
}

export function toggleSelect(tile, force) {
  const item = itemFromTile(tile);
  if (!item) return;
  const on = force != null ? !!force : !selected.has(item.id);
  if (on) selected.set(item.id, item);
  else selected.delete(item.id);
  paintTile(tile);
  paintBar();
}

function gallerySources(scope) {
  return [...scope.querySelectorAll('[data-photo]')]
    .map((t) => t.getAttribute('data-src'))
    .filter(Boolean);
}

function openLightboxFromTile(tile, scope) {
  const src = tile.getAttribute('data-src');
  if (!src) return;
  const list = gallerySources(scope);
  const start = Math.max(0, list.indexOf(src));
  // data-wm="off" = preview ya trae logo horneado (evento live)
  // default / "css" = un logo CSS encima (series estáticas)
  const wmAttr = tile.getAttribute('data-wm') || scope?.getAttribute?.('data-wm') || 'css';
  const wm = wmAttr === 'off' ? 'off' : 'css';
  const api = window.solephLightbox;
  if (api && typeof api.open === 'function') {
    api.open(list, start >= 0 ? start : 0, { wm });
  } else {
    // fallback: full image in new tab
    window.open(src, '_blank', 'noopener');
  }
}

/**
 * Bind one tile (open + checkbox). Safe to call more than once if you pass fresh nodes.
 * @param {Element} tile
 * @param {ParentNode} [scope]
 */
export function bindPhotoTile(tile, scope = document) {
  if (!(tile instanceof HTMLElement) || tile.dataset.shopBound === '1') return;
  tile.dataset.shopBound = '1';

  const openBtn = tile.querySelector('[data-open-photo]');
  const check = tile.querySelector('[data-select]');

  openBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openLightboxFromTile(tile, scope);
  });

  // click en el tile (fuera del check) también amplía
  tile.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest('[data-select], .photo-check, label.photo-check')) return;
    if (t.closest('[data-open-photo]')) return; // already handled
    openLightboxFromTile(tile, scope);
  });

  check?.addEventListener('click', (e) => e.stopPropagation());
  check?.addEventListener('change', () => {
    const on = /** @type {HTMLInputElement} */ (check).checked;
    toggleSelect(tile, on);
  });

  paintTile(tile);
}

/**
 * @param {ParentNode} root
 */
export function bindPhotoGrid(root = document) {
  root.querySelectorAll('[data-photo]').forEach((tile) => bindPhotoTile(tile, root));
  paintAllTiles(root);
}

function addSelectedAndGo() {
  if (!selected.size) return;
  for (const item of selected.values()) {
    addToCart(item);
  }
  clearSelection();
  window.location.href = '/tienda/carrito';
}

let barBound = false;
export function ensureSelectBar() {
  if (barBound) return;
  barBound = true;
  const { addBtn, clearBtn } = barEls();
  addBtn?.addEventListener('click', addSelectedAndGo);
  clearBtn?.addEventListener('click', () => clearSelection());
  window.addEventListener('soleph:cart', () => paintAllTiles());
  paintBar();
}

/** Markup helpers for dynamic grids */
export function photoTileInnerHtml({ thumb, code, alt }) {
  const label = code ? `#${code}` : alt || 'Foto';
  return `
    <button type="button" class="photo-tile-open" data-open-photo aria-label="Ver ${label} en grande">
      <img src="${thumb}" alt="${label}" loading="lazy" width="600" height="600" />
      <span class="wm-overlay" aria-hidden="true"></span>
    </button>
    <span class="photo-code-badge" title="Código de la foto">${code ? `#${code}` : ''}</span>
    <label class="photo-check" title="Elegir foto">
      <input type="checkbox" data-select aria-label="Elegir ${label}" />
      <span class="photo-check-box" aria-hidden="true"></span>
    </label>
    <span class="photo-in-cart" data-in-cart-mark hidden>En carrito</span>
  `;
}
