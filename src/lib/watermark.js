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

  // tile diagonal (marca repetida)
  const tileW = Math.max(90, Math.round(Math.min(width, height) * 0.22));
  const tileH = Math.max(28, Math.round(tileW / aspect));
  const gapY = tileH * 2.4;
  const gapX = tileW * 1.35;

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((-28 * Math.PI) / 180);
  ctx.globalAlpha = 0.16;
  const extent = Math.max(width, height) * 1.35;
  for (let y = -extent; y <= extent; y += gapY) {
    for (let x = -extent; x <= extent; x += gapX) {
      ctx.drawImage(logo, x - tileW / 2, y - tileH / 2, tileW, tileH);
    }
  }
  ctx.restore();

  // logo esquina inferior derecha
  const cornerW = Math.max(72, Math.round(Math.min(width, height) * 0.16));
  const cornerH = Math.max(22, Math.round(cornerW / aspect));
  const pad = Math.round(Math.min(width, height) * 0.03);
  ctx.save();
  ctx.globalAlpha = 0.55;
  // soft shadow plate
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.drawImage(logo, width - pad - cornerW, height - pad - cornerH, cornerW, cornerH);
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
