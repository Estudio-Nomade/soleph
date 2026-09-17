/**
 * Genera preview con marca de agua en el browser (sin backend).
 * Original se sube aparte al bucket privado.
 */

const DEFAULT_MARK = 'SOLE YAQUINTA';

/**
 * @param {File|Blob} file
 * @param {{ maxEdge?: number, quality?: number, mark?: string }} [opts]
 * @returns {Promise<{ previewBlob: Blob, width: number, height: number, originalFile: File|Blob }>}
 */
export async function makeWatermarkedPreview(file, opts = {}) {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.82;
  const mark = opts.mark ?? DEFAULT_MARK;

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

  // diagonal soft watermark
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((-28 * Math.PI) / 180);
  const fontSize = Math.max(18, Math.round(Math.min(width, height) * 0.045));
  ctx.font = `600 ${fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1, fontSize * 0.04);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.fillStyle = 'rgba(1, 43, 85, 0.38)';
  const stepY = fontSize * 3.2;
  const stepX = Math.max(width, height);
  for (let y = -height; y <= height; y += stepY) {
    ctx.strokeText(mark, 0, y);
    ctx.fillText(mark, 0, y);
  }
  // corner mark
  ctx.restore();
  ctx.font = `600 ${Math.max(12, Math.round(fontSize * 0.55))}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeStyle = 'rgba(1,43,85,0.55)';
  ctx.lineWidth = 2;
  const pad = Math.round(Math.min(width, height) * 0.03);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.strokeText(mark, width - pad, height - pad);
  ctx.fillText(mark, width - pad, height - pad);

  const previewBlob = await canvasToJpeg(canvas, quality);
  return { previewBlob, width, height, originalFile: file };
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
      // canvas drawImage accepts HTMLImageElement
      _img: img,
      close() {},
    };
  } finally {
    // keep object URL until draw; revoke after drawImage via caller close no-op
    // actual revoke:
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
