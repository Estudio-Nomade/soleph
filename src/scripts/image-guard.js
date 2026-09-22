/**
 * Fricción anti-guardar en vitrina (no DRM).
 * Bloquea contextmenu / drag solo sobre fotos de álbum y lightbox.
 * No corre en /admin. No toca inputs ni textos del carrito.
 */

const GUARD_SEL =
  '.photo-tile, [data-photo], [data-lightbox], .lightbox, .lightbox-stage, [data-lightbox-stage]';

function isEditable(el) {
  if (!(el instanceof Element)) return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

/**
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isVitrinaTarget(target) {
  if (!(target instanceof Element)) return false;
  if (isEditable(target)) return false;
  const zone = target.closest(GUARD_SEL);
  if (!zone) return false;
  // img de foto, stage del lightbox, o el tile entero (img suele tener pointer-events:none)
  if (target.tagName === 'IMG') return true;
  if (target.matches('.lightbox-stage, [data-lightbox-stage], [data-lightbox-img]')) return true;
  if (target.closest('.photo-tile-open, .lightbox-stage, [data-lightbox-stage]')) return true;
  return false;
}

function hardenImg(img) {
  if (!(img instanceof HTMLImageElement)) return;
  if (img.getAttribute('draggable') !== 'false') img.setAttribute('draggable', 'false');
}

function hardenRoot(root = document) {
  root.querySelectorAll?.('.photo-tile img, [data-photo] img, [data-lightbox-img], .lightbox img').forEach(hardenImg);
}

export function enableImageGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (location.pathname.startsWith('/admin')) return;
  if (document.documentElement.dataset.imageGuard === '1') return;
  document.documentElement.dataset.imageGuard = '1';

  hardenRoot(document);

  document.addEventListener(
    'contextmenu',
    (e) => {
      if (isVitrinaTarget(e.target)) e.preventDefault();
    },
    true,
  );

  document.addEventListener(
    'dragstart',
    (e) => {
      if (isVitrinaTarget(e.target)) {
        e.preventDefault();
        return;
      }
      // img dentro de tile aunque el drag arranque en el button
      const t = e.target;
      if (t instanceof Element) {
        const img = t.closest('.photo-tile, [data-photo], [data-lightbox], .lightbox')?.querySelector('img');
        if (img && !isEditable(t)) {
          hardenImg(img);
          if (t.closest('.photo-tile-open, .lightbox-stage, [data-lightbox-stage], [data-lightbox]')) {
            e.preventDefault();
          }
        }
      }
    },
    true,
  );
}

enableImageGuard();
