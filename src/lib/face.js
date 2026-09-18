/**
 * Face search Soleph — AWS Rekognition via Supabase Edge Functions.
 * Fallback opcional: face-api local + pgvector (si REKOGNITION no responde).
 *
 * Index:  POST /functions/v1/face-index  { albumId, photoId, imageUrl|imageBase64 }
 * Search: POST /functions/v1/face-search { albumId, imageBase64 }
 */

import { getSupabase, isSupabaseConfigured, publicStorageUrl, BUCKETS } from './supabase.js';

export const FACE_MODEL = 'aws-rekognition';
/** Rekognition similarity 0–100 */
export const DEFAULT_MATCH_THRESHOLD = 85;

function functionsBase() {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Falta PUBLIC_SUPABASE_URL');
  return `${String(url).replace(/\/$/, '')}/functions/v1`;
}

function anonKey() {
  const k = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!k) throw new Error('Falta PUBLIC_SUPABASE_ANON_KEY');
  return k;
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} body
 * @param {{ auth?: boolean }} [opts]
 */
async function invokeFunction(name, body, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: anonKey(),
    Authorization: `Bearer ${anonKey()}`,
  };

  if (opts.auth) {
    try {
      const sb = getSupabase();
      const { data } = await sb.auth.getSession();
      if (data.session?.access_token) {
        headers.Authorization = `Bearer ${data.session.access_token}`;
      } else if (opts.requireAuth !== false) {
        throw new Error('Sesión admin vencida. Volvé a entrar a /admin/login');
      }
    } catch (err) {
      if (err?.message?.includes('Sesión admin')) throw err;
      if (opts.requireAuth !== false) {
        throw new Error(err?.message || 'No hay sesión admin para indexar caras');
      }
    }
  }

  const res = await fetch(`${functionsBase()}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = json?.error || json?.message || `Edge ${name} HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/**
 * @param {Blob|File} blob
 * @returns {Promise<string>} data URL base64
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Indexa caras de una foto ya subida (admin) con Rekognition.
 * @param {{ photoId: string, albumId: string, image: File|Blob|string }} args
 */
export async function indexPhotoFaces({ photoId, albumId, image }) {
  if (!isSupabaseConfigured()) throw new Error('Supabase no configurado');

  /** @type {Record<string, unknown>} */
  const body = { albumId, photoId };

  if (typeof image === 'string' && /^https?:\/\//i.test(image)) {
    body.imageUrl = image;
  } else if (image instanceof Blob || image instanceof File) {
    body.imageBase64 = await blobToDataUrl(image);
  } else if (typeof image === 'string') {
    // relative storage path or data url
    if (image.startsWith('data:')) body.imageBase64 = image;
    else body.imageUrl = publicStorageUrl(BUCKETS.previews, image);
  } else {
    throw new Error('Imagen no soportada para index');
  }

  const json = await invokeFunction('face-index', body, { auth: true, requireAuth: true });
  return {
    faces: Number(json.indexed || json.faceIds?.length || 0),
    faceIds: json.faceIds || [],
    collectionId: json.collectionId,
    engine: 'rekognition',
  };
}

/**
 * Index con reintentos (red / Edge / AWS transitorio).
 * @param {{ photoId: string, albumId: string, image: File|Blob|string, attempts?: number }} args
 */
export async function indexPhotoFacesWithRetry({ photoId, albumId, image, attempts = 3 }) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await indexPhotoFaces({ photoId, albumId, image });
    } catch (err) {
      lastErr = err;
      // no reintentar auth / payload inválido
      const msg = String(err?.message || '');
      if (/Sesión admin|Solo admin|No auth|albumId|photoId|Imagen no soportada|demasiado grande/i.test(msg)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr || new Error('No se pudo indexar caras');
}

/**
 * True si la foto ya tiene al menos un face id de Rekognition.
 * @param {{ rekognition_face_ids?: string[]|null }} photo
 */
export function photoHasIndexedFaces(photo) {
  const ids = photo?.rekognition_face_ids;
  return Array.isArray(ids) && ids.length > 0;
}

/**
 * Busca fotos del álbum que matchean el selfie (Rekognition).
 * @param {{ albumId: string, selfie: File|Blob|string, threshold?: number, limit?: number }} args
 */
export async function searchAlbumBySelfie({
  albumId,
  selfie,
  threshold = DEFAULT_MATCH_THRESHOLD,
  limit = 60,
}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase no configurado');

  let imageBase64;
  if (typeof selfie === 'string' && selfie.startsWith('data:')) {
    imageBase64 = selfie;
  } else if (selfie instanceof Blob || selfie instanceof File) {
    imageBase64 = await blobToDataUrl(selfie);
  } else if (typeof selfie === 'string' && /^https?:\/\//i.test(selfie)) {
    const res = await fetch(selfie);
    if (!res.ok) throw new Error('No se pudo cargar el selfie');
    imageBase64 = await blobToDataUrl(await res.blob());
  } else {
    throw new Error('Selfie no soportado');
  }

  const json = await invokeFunction('face-search', {
    albumId,
    imageBase64,
    threshold,
    maxFaces: Math.min(limit, 20),
  });

  if (json.message && /no face|InvalidParameter|no faces/i.test(String(json.message))) {
    return { photoIds: [], matches: [], noFace: true };
  }

  const matches = (json.matches || []).map((row) => ({
    photoId: row.photoId,
    code: row.code || String(row.photoId || '').replace(/-/g, '').slice(0, 8).toUpperCase(),
    distance: row.similarity != null ? 100 - Number(row.similarity) : undefined,
    similarity: row.similarity,
    previewPath: row.previewPath,
    sortOrder: row.sortOrder,
    previewUrl: publicStorageUrl(BUCKETS.previews, row.previewPath),
  }));

  const msg = String(json.message || '');
  const notIndexed = /sin caras indexadas|ResourceNotFound|no faces indexed/i.test(msg);

  // Edge may return empty matches but ok if no faces in selfie
  if (!matches.length && !json.photoIds?.length) {
    // distinguish "no face in selfie" vs "no match" when possible
    if (json.searchedFaceConfidence != null && json.searchedFaceConfidence < 70) {
      return { photoIds: [], matches: [], noFace: true, notIndexed: false };
    }
  }

  return {
    photoIds: json.photoIds || matches.map((m) => m.photoId),
    matches,
    noFace: false,
    notIndexed,
    message: msg || '',
    album: json.album,
    engine: 'rekognition',
  };
}

/**
 * Lista álbumes publicados con face search (storefront).
 */
export async function listSearchableAlbums() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('albums')
    .select('id, slug, name, date_label, kind, cover_path, search_by_face, published, photo_price_ars')
    .eq('published', true)
    .eq('search_by_face', true)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** @deprecated kept so callers that still await loadFaceApi don't break */
export async function loadFaceApi() {
  return null;
}

export async function extractFaces() {
  throw new Error('extractFaces local deshabilitado; usar Rekognition (indexPhotoFaces / searchAlbumBySelfie)');
}
