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

  // Prefer explicit camera prefixes (avoid matching years in photo_2026-09-18…)
  const cameraPrefixed = [
    /(?:DSC|DSCF|IMG|PIC|SAM|DXO|_MG|MG|CRW|CR2|NEF|ARW|DJI)[_-]?0*(\d{3,6})\b/i,
    /\bP\d{0,3}[_-]?0*(\d{3,6})\b/i,
  ];
  for (const re of cameraPrefixed) {
    const m = noExt.match(re);
    if (m?.[1]) return normalizeCode(m[1]);
  }

  // Strip ISO dates / clock so we don't pick 2026 from photo_2026-09-18_08-36-27
  // (underscore is a word char — can't rely on \b before the year)
  const withoutDates = noExt
    .replace(/(?:^|[^0-9])(20\d{2}[-_]\d{2}[-_]\d{2})(?=[^0-9]|$)/g, ' ')
    .replace(/(?:^|[^0-9])(\d{1,2}[-_:]\d{2}[-_:]\d{2})(?=[^0-9]|$)/g, ' ')
    .replace(/(?:^|[^0-9])(20\d{2})(?=[^0-9]|$)/g, ' ')
    .replace(/photo|img|pic|dsc|file|image/gi, ' ')
    .replace(/[_-]+/g, ' ');

  // Prefer standalone 3–6 digit tokens that look like camera frame numbers
  const tokens = [...withoutDates.matchAll(/(?:^|[^0-9])(\d{3,6})(?=[^0-9]|$)/g)].map((m) => m[1]);
  // drop pure years leftover
  const good = tokens.filter((t) => !/^20\d{2}$/.test(t) && !/^19\d{2}$/.test(t));
  if (good.length) {
    // last meaningful token usually is the shot number
    return normalizeCode(good[good.length - 1]);
  }

  const trailing = withoutDates.match(/(\d{3,6})\s*$/);
  if (trailing?.[1] && !/^20\d{2}$/.test(trailing[1])) return normalizeCode(trailing[1]);

  // fallback: sanitized basename (no date noise)
  const safe = withoutDates
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase()
    .slice(-8);
  return safe || 'FOTO';
}

/**
 * @param {string} raw
 */
function normalizeCode(raw) {
  const stripped = String(raw).replace(/^0+(?=\d)/, '');
  const code = (stripped.length >= 3 ? stripped : String(raw)).toUpperCase();
  return code;
}

/**
 * Display form for clients: #345
 * @param {string|null|undefined} code
 * @param {string|null|undefined} fallbackId
 */
export function formatPhotoCode(code, fallbackId) {
  const c =
    String(code || '').trim() ||
    String(fallbackId || '')
      .replace(/-/g, '')
      .slice(0, 8)
      .toUpperCase();
  return c ? `#${c}` : '';
}

/**
 * @param {string} name
 */
export function slugifyCategory(name) {
  return (
    String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `cat-${Date.now().toString(36)}`
  );
}

export const DEFAULT_CATEGORY_NAMES = ['Mansos', 'Potros', 'Damas'];
