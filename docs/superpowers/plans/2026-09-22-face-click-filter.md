# Face click filter — Implementation Plan

> **For agentic workers:** Use executing-plans or implement task-by-task. Steps use checkbox syntax.

**Goal:** En `/tienda/evento`, al abrir una foto con face search on, mostrar recuadros de caras; al tocar uno, filtrar el álbum a solo matches (juntas) con URL `?cara=`.

**Architecture:** Edge `face-detect` (DetectFaces) on lightbox open; client crops face → existing `face-search`; evento.astro hides non-matches and keeps `?cara` token (photoId + box).

**Tech Stack:** Astro, Supabase Edge (Deno), AWS Rekognition DetectFaces + SearchFacesByImage.

## Global Constraints

- No keys in browser; no boxes in Postgres
- Copy UI en español argentino, corto
- Navy `#012B55`; no tocar `public/images` bulk
- Solo álbumes `published && search_by_face`
- Conventional commits; stage paths concretos

---

### Task 1: Edge Function `face-detect`

**Files:**
- Create: `supabase/functions/face-detect/index.ts`
- Modify: `docs/face-search.md` (mention detect)
- Modify: `docs/aws-rekognition-setup.md` if DetectFaces already listed (confirm only)

- [ ] **Step 1:** Implement `face-detect` mirroring `face-search` auth/album gate; call `DetectFacesCommand`; return ratio boxes.
- [ ] **Step 2:** Deploy note in docs (user deploys when ready).

### Task 2: Client face helpers

**Files:**
- Modify: `src/lib/face.js`

- [ ] **Step 1:** Add `detectPhotoFaces`, `encodeCaraToken`, `decodeCaraToken`, `cropFaceFromImage`, raise search maxFaces for click path.

### Task 3: Lightbox face overlays

**Files:**
- Modify: `src/components/Lightbox.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1:** Face layer + hits; API open opts for faces/loading; scale boxes to rendered img.

### Task 4: Evento page filter + deep link

**Files:**
- Modify: `src/pages/tienda/evento.astro`
- Modify: `src/scripts/shop-select.js` if needed for lightbox meta (photoId)

- [ ] **Step 1:** Pass photoId on open; detect on open when search_by_face; on face click → search → filter grid + chip + URL; hydrate `?cara=`.

### Task 5: Verify + docs

- [ ] Manual: open live event, boxes, filter, share URL, clear.
- [ ] Update `docs/face-search.md`.
