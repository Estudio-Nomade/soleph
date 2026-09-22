/**
 * Preview con marca de agua del logo (browser, sin backend).
 * Modo vitrina: solo se sube este JPEG liviano a la tienda.
 * El original de cámara no va a Supabase (Sole lo entrega por fuera).
 */

const LOGO_SRC = '/images/logosinfondo.png';
const LOGO_FALLBACK = '/images/logo.png';

/**
 * Presets de vitrina (la gente mira / elige; no es la entrega final).
 * `default` = lo que usa el admin al subir.
 */
export const PREVIEW_PRESETS = {
  /** Referencia vieja (pesada) */
  legacy: { maxEdge: 1600, quality: 0.82, label: 'Vieja (1600 · 82%)' },
  /** Un solo archivo de vitrina: <1280, JPEG más apretado */
  default: { maxEdge: 1024, quality: 0.62, label: 'Vitrina (1024 · 62%)' },
  /** Todavía más chica si hace falta */
  compact: { maxEdge: 900, quality: 0.58, label: 'Compacta (900 · 58%)' },
  /** Solo grilla / dual (no usar sola en lightbox) */
  thumb: { maxEdge: 640, quality: 0.6, label: 'Grilla (640 · 60%)' },
};

/** @type {HTMLImageElement | null} */
let logoCache = null;
/** @type {Promise<HTMLImageElement> | null} */
let logoPromise = null;

/**
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.decoding = 'async';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    el.src = src;
  });
}

async function getLogoImage() {
  if (logoCache) return logoCache;
  if (!logoPromise) {
    logoPromise = loadImage(LOGO_SRC).catch(() => loadImage(LOGO_FALLBACK));
  }
  logoCache = await logoPromise;
  return logoCache;
}

/**
 * @param {File|Blob} file
 * @param {{ maxEdge?: number, quality?: number, logoSrc?: string, preset?: keyof typeof PREVIEW_PRESETS }} [opts]
 * @returns {Promise<{ previewBlob: Blob, width: number, height: number, originalFile: File|Blob, maxEdge: number, quality: number }>}
 */
export async function makeWatermarkedPreview(file, opts = {}) {
  const preset = opts.preset ? PREVIEW_PRESETS[opts.preset] : null;
  const maxEdge = opts.maxEdge ?? preset?.maxEdge ?? PREVIEW_PRESETS.default.maxEdge;
  const quality = opts.quality ?? preset?.quality ?? PREVIEW_PRESETS.default.quality;

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');

  const source = bitmap._img || bitmap;
  ctx.drawImage(source, 0, 0, width, height);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const logo = await getLogoImage();
  drawLogoWatermark(ctx, logo, width, height);

  const previewBlob = await canvasToJpeg(canvas, quality);
  return { previewBlob, width, height, originalFile: file, maxEdge, quality };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} logo
 * @param {number} width
 * @param {number} height
 */
function drawLogoWatermark(ctx, logo, width, height) {
  const lw = logo.naturalWidth || logo.width || 1;
  const lh = logo.naturalHeight || logo.height || 1;
  const aspect = lw / lh;

  // Un solo logo, grande y centrado (no patrón repetido).
  // ~55% del lado corto → se ve en thumb square (object-fit: cover) y en lightbox.
  const markW = Math.max(140, Math.round(Math.min(width, height) * 0.55));
  const markH = Math.max(40, Math.round(markW / aspect));

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((-18 * Math.PI) / 180);
  // silueta negra legible sobre cielos claros
  ctx.globalAlpha = 0.38;
  ctx.filter = 'brightness(0)';
  ctx.drawImage(logo, -markW / 2, -markH / 2, markW, markH);
  // toque del logo original encima
  ctx.filter = 'none';
  ctx.globalAlpha = 0.18;
  ctx.drawImage(logo, -markW / 2, -markH / 2, markW, markH);
  ctx.restore();
}

/**
 * @param {File|Blob} file
 */
async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to HTMLImageElement */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo leer la imagen'));
      el.src = url;
    });
    return {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      _img: img,
      close() {},
    };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('No se pudo generar el preview'));
        else resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * @param {string} name
 */
export function safeFileBase(name) {
  const base = String(name || 'foto')
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'foto';
}
