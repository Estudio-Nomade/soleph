/**
 * Contenido de portafolio / Sobre mí editable desde admin.
 * Vive en settings.portfolio (jsonb). site.json es fallback estático.
 */

import { getSupabase, isSupabaseConfigured, publicStorageUrl, BUCKETS } from './supabase.js';

export const PORTFOLIO_SETTINGS_KEY = 'portfolio';

/**
 * @typedef {{
 *   slug: string,
 *   title: string,
 *   year: number|string,
 *   cover: string,
 *   images: string[],
 *   href?: string,
 * }} PortfolioProject
 *
 * @typedef {{
 *   title?: string,
 *   body?: string,
 *   image?: string,
 * }} PortfolioAbout
 *
 * @typedef {{
 *   about: PortfolioAbout,
 *   projects: PortfolioProject[],
 *   trabajos_intro?: string,
 * }} PortfolioContent
 */

/**
 * Año del proyecto. Vacío permitido (Sole puede borrar 2026).
 * No rellenar con el año actual si mandaron '' / null.
 * @param {any} raw
 * @param {{ defaultIfMissing?: boolean }} [opts]
 * @returns {string|number}
 */
export function normalizeProjectYear(raw, opts = {}) {
  if (raw === null || raw === undefined) {
    return opts.defaultIfMissing ? new Date().getFullYear() : '';
  }
  if (typeof raw === 'string' && raw.trim() === '') return '';
  if (typeof raw === 'number' && !Number.isFinite(raw)) return '';
  const s = String(raw).trim();
  if (!s) return '';
  // "2026" o 2026 → number si es entero; si no, texto libre
  if (/^\d{1,4}$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  }
  return s;
}

/**
 * @param {Partial<PortfolioContent>|null|undefined} raw
 * @param {PortfolioContent} fallback
 * @returns {PortfolioContent}
 */
export function normalizePortfolio(raw, fallback) {
  const fb = fallback || { about: {}, projects: [] };
  const aboutIn = raw?.about && typeof raw.about === 'object' ? raw.about : {};
  // array vacío es válido (no volver al seed)
  const hasProjectsKey = raw && Object.prototype.hasOwnProperty.call(raw, 'projects');
  const projectsIn = Array.isArray(raw?.projects) ? raw.projects : null;

  const about = {
    title: String(aboutIn.title || fb.about?.title || 'Sobre mí'),
    body: String(aboutIn.body || fb.about?.body || ''),
    image: String(aboutIn.image || fb.about?.image || '/images/sobre-mi.jpg'),
  };

  /** @type {PortfolioProject[]} */
  let projects;
  if (hasProjectsKey && projectsIn) {
    projects = projectsIn
      .map((p) => normalizeProject(p))
      .filter((p) => p.slug && p.title);
  } else {
    projects = (fb.projects || []).map((p) => normalizeProject(p));
  }

  return {
    about,
    projects,
    trabajos_intro: String(
      raw?.trabajos_intro != null && String(raw.trabajos_intro).trim() !== ''
        ? raw.trabajos_intro
        : fb.trabajos_intro || 'Selección de proyectos y series.',
    ),
  };
}

/**
 * @param {any} p
 * @returns {PortfolioProject}
 */
export function normalizeProject(p) {
  const slug = String(p?.slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const images = Array.isArray(p?.images)
    ? p.images.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const title = String(p?.title || '').trim() || slug;
  // año vacío se respeta (no forzar getFullYear)
  const year = normalizeProjectYear(p?.year, { defaultIfMissing: false });
  const cover = String(p?.cover || images[0] || '/images/logo.png').trim();
  return {
    slug,
    title,
    year,
    cover,
    images: images.length ? images : cover ? [cover] : [],
    href: `/proyecto/${slug}`,
  };
}

/**
 * @param {PortfolioContent} fallback from site.json shape
 */
export async function loadPortfolioContent(fallback) {
  const base = normalizePortfolio(null, fallback);
  if (!isSupabaseConfigured()) return base;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('settings')
      .select('value')
      .eq('key', PORTFOLIO_SETTINGS_KEY)
      .maybeSingle();
    if (error) throw error;
    if (!data?.value) return base;
    return normalizePortfolio(data.value, base);
  } catch (err) {
    console.warn('loadPortfolioContent', err?.message || err);
    return base;
  }
}

/**
 * Sube imagen de portafolio al bucket público de covers.
 * @param {File} file
 * @param {string} folder e.g. about | paisajes
 */
export async function uploadPortfolioImage(file, folder = 'misc') {
  if (!isSupabaseConfigured()) throw new Error('Supabase no configurado');
  const sb = getSupabase();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const safeFolder = String(folder || 'misc')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .slice(0, 40);
  const path = `portfolio/${safeFolder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(BUCKETS.covers).upload(path, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return publicStorageUrl(BUCKETS.covers, path);
}

/**
 * @param {any} site
 * @returns {PortfolioContent}
 */
export function portfolioFallbackFromSite(site) {
  return {
    about: {
      title: site?.about?.title || 'Sobre mí',
      body: site?.about?.body || '',
      image: site?.about?.image || '/images/sobre-mi.jpg',
    },
    projects: (site?.projects || []).map((p) => normalizeProject(p)),
    trabajos_intro: 'Selección de proyectos y series.',
  };
}
