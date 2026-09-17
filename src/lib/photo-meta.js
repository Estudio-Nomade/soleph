/**
 * Código de foto = número de la tarjeta/cámara cuando se puede.
 * Ejemplos de filename:
 *   DSC_1234.JPG, IMG_0042.CR2, _MG_9876.JPG, P1010234.JPG, 100CANON/IMG_7788.JPG
 * → code "1234", "0042", "9876", "0234", "7788"
 */

/**
 * @param {string} filename
 * @returns {string} code uppercase, digits preferred
 */
export function cameraCodeFromFilename(filename) {
  const base = String(filename || '')
    .split(/[/\\]/)
    .pop() || '';
  const noExt = base.replace(/\.[^.]+$/, '');

  // Common camera patterns: PREFIX + digits
  const patterns = [
    /(?:DSC|IMG|PIC|P|DSCF|SAM|DXO|_MG|MG|CRW|CR2|NEF|ARW)[_-]?0*(\d{3,6})$/i,
    /[_-]?(\d{3,6})$/,
    /(\d{3,6})/,
  ];

  for (const re of patterns) {
    const m = noExt.match(re);
    if (m?.[1]) {
      // keep meaningful zeros only if short? prefer stripped leading zeros but leave at least 3–4 digits feel
      const raw = m[1];
      const stripped = raw.replace(/^0+(?=\d)/, '');
      // keep original if stripping leaves too short
      const code = (stripped.length >= 3 ? stripped : raw).toUpperCase();
      if (code) return code;
    }
  }

  // fallback: sanitized basename
  const safe = noExt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase()
    .slice(-8);
  return safe || '';
}

/**
 * @param {string} name
 */
export function slugifyCategory(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `cat-${Date.now().toString(36)}`;
}

export const DEFAULT_CATEGORY_NAMES = ['Mansos', 'Potros', 'Damas'];
