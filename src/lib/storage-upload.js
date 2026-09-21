/**
 * Uploads a Storage con reintentos para fallos de red / edge (520, 502, 503, 504).
 * El mensaje "HTTP 520 error" de Supabase NO es de la foto: es Cloudflare/proxy
 * entre el browser y el storage de Supabase (transitorio o timeout con archivos grandes).
 */

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

/**
 * @param {unknown} err
 * @returns {number | null}
 */
export function storageErrorStatus(err) {
  if (!err || typeof err !== 'object') return null;
  const e = /** @type {Record<string, unknown>} */ (err);
  const candidates = [e.status, e.statusCode, e.code];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string' && /^\d{3}$/.test(c.trim())) return Number(c.trim());
  }
  const msg = String(e.message || '');
  const m = msg.match(/\bHTTP\s+(\d{3})\b/i) || msg.match(/\b(520|502|503|504|429)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * @param {unknown} err
 */
export function isRetryableStorageError(err) {
  const status = storageErrorStatus(err);
  if (status != null && RETRYABLE_STATUS.has(status)) return true;
  const msg = String(/** @type {any} */ (err)?.message || err || '').toLowerCase();
  if (!msg) return false;
  if (/failed to fetch|networkerror|network request failed|load failed|timeout|timed out|econnreset|socket/.test(msg)) {
    return true;
  }
  if (/\b(520|502|503|504|429)\b/.test(msg)) return true;
  if (/http\s+5\d\d/.test(msg)) return true;
  return false;
}

/**
 * Mensaje legible para Sole (sin jerga de edge).
 * @param {unknown} err
 * @param {{ fileName?: string, kind?: 'preview' | 'original' | 'cover' }} [ctx]
 */
export function formatStorageError(err, ctx = {}) {
  const status = storageErrorStatus(err);
  const raw = String(/** @type {any} */ (err)?.message || err || 'error al subir');
  const name = ctx.fileName ? `${ctx.fileName}: ` : '';
  const kind =
    ctx.kind === 'original' ? 'el original' : ctx.kind === 'cover' ? 'la tapa' : 'el preview';

  if (status === 413 || /payload too large|entity too large|maximum allowed size|file size/i.test(raw)) {
    return `${name}el archivo pesa de más (límite ~50 MB en originales, ~10 MB en preview). Bajá tamaño o calidad y reintentá.`;
  }
  if (status === 401 || status === 403 || /jwt|not authorized|row-level security|unauthorized/i.test(raw)) {
    return `${name}sesión admin vencida o sin permiso de storage. Cerrá sesión, entrá de nuevo y reintentá.`;
  }
  if (status === 409 || /already exists|duplicate|resource already/i.test(raw)) {
    return `${name}ya existe un archivo con ese nombre en storage. Reintentá (se genera otro path).`;
  }
  if (status != null && RETRYABLE_STATUS.has(status)) {
    return `${name}falló la conexión con el servidor al subir ${kind} (código ${status}). Suele ser temporal: reintentá Subir evento; si se repite, subí de a menos fotos o con mejor red.`;
  }
  if (isRetryableStorageError(err)) {
    return `${name}falló la red al subir ${kind}. Reintentá; si se repite, subí de a tandas más chicas.`;
  }
  return `${name}${raw}`;
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} bucket
 * @param {string} path
 * @param {File|Blob|ArrayBuffer|ArrayBufferView|string} body
 * @param {{
 *   contentType?: string,
 *   upsert?: boolean,
 *   cacheControl?: string,
 *   attempts?: number,
 *   baseDelayMs?: number,
 *   label?: string,
 *   onRetry?: (info: { attempt: number, attempts: number, error: unknown, delayMs: number }) => void,
 * }} [opts]
 */
export async function uploadWithRetry(sb, bucket, path, body, opts = {}) {
  const attempts = Math.max(1, opts.attempts ?? 4);
  const baseDelayMs = opts.baseDelayMs ?? 900;
  const fileOptions = {
    contentType: opts.contentType,
    upsert: opts.upsert ?? false,
    cacheControl: opts.cacheControl,
  };

  /** @type {unknown} */
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await sb.storage.from(bucket).upload(path, body, fileOptions);
    if (!res.error) {
      return res;
    }
    lastError = res.error;
    const retry = attempt < attempts && isRetryableStorageError(res.error);
    if (!retry) {
      return res;
    }
    // jitter + backoff exponencial (1×, 2×, 4× …)
    const delayMs = Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
    if (typeof opts.onRetry === 'function') {
      opts.onRetry({ attempt, attempts, error: res.error, delayMs });
    }
    await sleep(delayMs);
  }

  return { data: null, error: lastError };
}
