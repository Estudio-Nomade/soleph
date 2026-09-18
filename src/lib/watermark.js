/**
 * Preview con marca de agua del logo (browser, sin backend).
 * Original se sube aparte al bucket privado.
 */

const LOGO_SRC = '/images/logosinfondo.png';
const LOGO_FALLBACK = '/images/logo.png';

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
 * @param {{ maxEdge?: number, quality?: number, logoSrc?: string }} [opts]
 * @returns {Promise<{ previewBlob: Blob, width: number, height: number, originalFile: File|Blob }>}
 */
export async function makeWatermarkedPreview(file, opts = {}) {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.82;

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
  return { previewBlob, width, height, originalFile: file };
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

  // tile diagonal — logo en negro (más oscuro / legible sobre cielos claros)
  const tileW = Math.max(100, Math.round(Math.min(width, height) * 0.24));
  const tileH = Math.max(30, Math.round(tileW / aspect));
  const gapY = tileH * 2.15;
  const gapX = tileW * 1.25;

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((-28 * Math.PI) / 180);
  const extent = Math.max(width, height) * 1.4;
  for (let y = -extent; y <= extent; y += gapY) {
    for (let x = -extent; x <= extent; x += gapX) {
      const dx = x - tileW / 2;
      const dy = y - tileH / 2;
      // silueta negra
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.filter = 'brightness(0)';
      ctx.drawImage(logo, dx, dy, tileW, tileH);
      ctx.restore();
      // toque del logo original encima (más bajo)
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.filter = 'none';
      ctx.drawImage(logo, dx, dy, tileW, tileH);
      ctx.restore();
    }
  }
  ctx.restore();

  // logo esquina inferior derecha — más presente
  const cornerW = Math.max(88, Math.round(Math.min(width, height) * 0.18));
  const cornerH = Math.max(26, Math.round(cornerW / aspect));
  const pad = Math.round(Math.min(width, height) * 0.03);
  const cx = width - pad - cornerW;
  const cy = height - pad - cornerH;

  ctx.save();
  // plato oscuro detrás para contraste
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(cx - 8, cy - 6, cornerW + 16, cornerH + 12);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  // negro fuerte
  ctx.globalAlpha = 0.72;
  ctx.filter = 'brightness(0)';
  ctx.drawImage(logo, cx, cy, cornerW, cornerH);
  ctx.filter = 'none';
  ctx.globalAlpha = 0.35;
  ctx.drawImage(logo, cx, cy, cornerW, cornerH);
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
