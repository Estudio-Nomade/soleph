# Handoff — Protecciones de vitrina (clic derecho, drag, indexación IA)

**Repo:** `~/Documentos/Estudio Nomade/Soleph` · GH privado `martiyaquinta/soleph`  
**Base:** `origin/main` (traer lo último; si #30 vitrina no está mergeado, basate en main actual + no pelear con upload).  
**Branch sugerida:** `agent/shop-image-protections`  
**Idioma UI:** español argentino, corto.  
**Auth GH si 404:** `gh auth switch --user martiyaquinta && gh auth setup-git`

## Objetivo de producto

En la **tienda / vitrina** (fotos con marca de agua que la gente mira y elige):

1. **Desactivar clic derecho** sobre fotos de álbum / lightbox (menú “Guardar imagen como…” más incómodo).
2. **Desactivar arrastrar** fotos al escritorio (`dragstart` / `draggable="false"`).
3. **Señales anti-indexación por scrapers / IA** (meta + `robots.txt` + headers si aplica) para que bots “bien educados” no usen las fotos de vitrina como training.

**No es DRM.** Un usuario técnico igual puede capturar pantalla, DevTools, o bajar la URL pública del storage. La protección real sigue siendo:

- preview con **marca de agua**
- **sin originals** en la nube (modo vitrina)
- URLs de storage públicas pero de archivos ya “sucios” con logo

Estas medidas son **fricción + política**, no candado absoluto. Copy interno/docs puede decirlo; **no** asustar a Sole con “imposible de copiar”.

## Alcance (sí / no)

### SÍ aplicar (storefront)

- Grillas de fotos de compra: `/tienda/evento`, `/tienda/[albumId]`, resultados face en `/tienda/buscar`, tiles `.photo-tile`, lightbox `[data-lightbox]`.
- Opcional suave: covers de álbum en home si son fotos vendibles (no logo ni iconos UI).

### NO aplicar (o con cuidado)

- **Admin** (`/admin/*`): Sole necesita clic derecho / inspeccionar a veces. No romper el panel.
- Formularios, inputs, textos seleccionables del carrito (nombre, alias CBU): el user **debe** poder copiar datos de transferencia.
- Logo del header, favicon, links normales.
- No bloquear **todo** el `contextmenu` del `document` si eso impide pegar en inputs del checkout — mejor scoped a contenedores de imagen / `img` de vitrina.
- No inventar canvas offscreen ni ofuscación pesada (overkill, rompe perf y face).

## Implementación sugerida (KISS)

### A. CSS (barato, siempre on en tienda)

En `src/styles/global.css` (o bloque scoped), algo en esta línea:

```css
/* Vitrina: menos “guardar arrastrando” */
.photo-tile img,
.photo-tile-open img,
[data-lightbox-img],
.lightbox img,
.wm-overlay {
  -webkit-user-drag: none;
  user-select: none;
  -webkit-user-select: none;
}
```

Opcional en tiles: `pointer-events` no hace falta tocar (rompe clicks).

### B. Atributos en markup / tiles dinámicos

Donde se crean `<img>` de fotos de álbum (`shop-select.js` helpers, `evento.astro` `makeTile`, `[albumId].astro`, face results):

- `draggable="false"`
- `decoding="async"` ya si está
- No hace falta `oncontextmenu="return false"` inline si hay listener central

Lightbox: el `<img data-lightbox-img>` en `Lightbox.astro` → `draggable="false"`.

### C. JS ligero (un solo módulo)

Crear p.ej. `src/scripts/image-guard.js` y cargarlo **una vez** desde `BaseLayout.astro` (solo hace falta en páginas públicas; si BaseLayout es compartido con admin, **gated**:

```js
// no correr en /admin
if (location.pathname.startsWith('/admin')) return;
```

Comportamiento:

1. `contextmenu` en capture/bubble sobre:
   - `img` dentro de `.photo-tile`, `[data-photo]`, `[data-lightbox]`, `.lightbox`
   - el stage del lightbox
   - opcional: `background-image` covers si hay selector claro
2. `preventDefault()` solo ahí.
3. `dragstart` preventDefault en los mismos targets + `draggable=false` al vuelo para imgs que se inyectan tarde (MutationObserver **no** salvo que sea necesario; mejor re-aplicar en `bindPhotoTile` / al pintar grilla).
4. **No** bloquear `contextmenu` en `input`, `textarea`, `[contenteditable]`.

Integración mínima:

- Import/side-effect desde `BaseLayout` con path check admin, **o**
- Llamar `enableImageGuard(root)` desde `bindPhotoGrid` / al montar lightbox.

Preferí **una** inicialización global + selectores CSS, para no olvidar face search / live event.

### D. Anti-indexación IA / bots

#### 1. `public/robots.txt` (crear si no existe)

```txt
User-agent: *
Allow: /

# Señal a scrapers de training (cumplimiento voluntario)
User-agent: GPTBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: FacebookBot
Disallow: /
```

Ajustar lista a lo razonable 2026; no hace falta bloquear Googlebot normal si Sole quiere SEO de portfolio (`/trabajos`, `/sobre-mi`).  
**Decisión de producto default en este handoff:**

- Bloquear bots de **training** conocidos.
- Dejar **Googlebot / Bingbot** con Allow para SEO de marca (no es tienda de stock foto libre).
- Si el usuario pide “que Google no indexe nada”, cambiar a `Disallow: /` global — **preguntar solo si no está claro**; default = SEO on + AI training off.

#### 2. Meta en `BaseLayout.astro` `<head>`

```html
<meta name="robots" content="index,follow,max-image-preview:large" />
<!-- Señales no estándar, bots que las respetan -->
<meta name="robots" content="noai, noimageai" />
```

Cuidado: dos meta robots se mergean mal en algunos parsers. Mejor **una** línea si se puede:

```html
<meta name="robots" content="index, follow, noai, noimageai" />
```

O para páginas de **álbum live** más agresivo (opcional, solo `/tienda/evento` y tal vez buscar):

```html
<meta name="robots" content="noindex, nofollow, noai, noimageai" />
```

**Recomendación:**

| Ruta | robots |
|------|--------|
| `/`, `/trabajos`, `/sobre-mi`, `/contacto` | `index,follow` + `noai,noimageai` |
| `/tienda/evento`, `/tienda/buscar`, carrito | `noindex,nofollow,noai,noimageai` (eventos privados / no SEO) |
| Admin | ya noindex implícito o `noindex` |

Implementar con prop opcional en `BaseLayout`: `robots?: string`.

#### 3. Headers (si Vercel lo permite sin drama)

`public/_headers` o `vercel.json` headers para `/images/*` y/o paths de storage no aplican a Supabase (CDN ajeno).  
Para assets en `public/images` (portfolio estático):

```
X-Robots-Tag: noai, noimageai
```

Para HTML de tienda, meta alcanza.  
**No** prometáis que Supabase Storage mande `X-Robots-Tag` sin CDN/Cloudflare delante del bucket.

#### 4. Atributos en `<img>` de vitrina (opcional)

```html
<img ... referrerpolicy="no-referrer-when-downgrade" />
```

No hay `noai` HTML estándar en img. No inventar atributos falsos que rompan validadores.

## UX / accesibilidad

- No desactivar selección de texto en todo el `body`.
- No romper zoom, teclado, lightbox Esc/flechas.
- Screen readers: no sacar `alt` útiles (`#código` OK).
- En mobile, “clic derecho” no existe igual; drag igual ayuda poco — no pasa nada.
- **No** mostrar toast molesto “Prohibido copiar” en cada right-click (opcional 1 línea silenciosa o nada).

## Tests manuales

1. `/lab/demo-vitrina` o `/tienda/la-makeka` o evento live: clic derecho sobre foto → no menú guardar (o preventido).
2. Arrastrar foto al escritorio → no suelta archivo útil.
3. Clic derecho en párrafo / input carrito → **sí** menú normal.
4. `/admin/evento/editar` → sin guard agresivo (o no estorba).
5. Lightbox open → mismo comportamiento en la imagen grande.
6. `curl -sI` o view-source: meta robots + `public/robots.txt` servido en `/robots.txt`.
7. `npm run build` OK.

## Git

```bash
git fetch origin main
git checkout -b agent/shop-image-protections origin/main
# ... cambios ...
npm run build
git add src/layouts/BaseLayout.astro src/styles/global.css src/scripts/image-guard.js \
  src/components/Lightbox.astro src/scripts/shop-select.js \
  src/pages/tienda/evento.astro public/robots.txt   # solo paths reales tocados
# no git add .
git commit -m "feat(shop): fricción anti-guardar + señales noai en vitrina"
git push -u origin HEAD
gh pr create --base main --title "feat(shop): protecciones vitrina (contextmenu, drag, noai)" --body "..."
```

Conventional commit. `Co-Authored-By` si agente co-escribe.

## Fuera de alcance (no hacer en este PR)

- Watermark más fuerte / tiled (ya hay decisión de un logo).
- Firmar URLs de Supabase / bucket privado de previews (cambio de arquitectura).
- Deshabilitar screenshots (imposible en web seria).
- Service worker que bloquee range requests.
- Ofuscar URLs de storage.
- Cambiar política de retención / vitrina 1024 (otro PR #30).

## Criterios de aceptación

- [ ] Right-click en foto de álbum / lightbox no abre “guardar imagen” (desktop).
- [ ] Drag de foto no descarga el archivo.
- [ ] Checkout / admin no quedan rotos para copiar texto.
- [ ] `robots.txt` en prod/dev con bloques a bots de training.
- [ ] Meta `noai` / `noimageai` (y noindex en rutas de evento si se eligió).
- [ ] `npm run build` pasa.
- [ ] PR abierta a `main`.

## Nota para el agente ejecutor

Si algo del DOM de tiles cambió, buscar selectores actuales con `photo-tile`, `data-lightbox-img`, `bindPhotoTile`. No asumas IDs viejos.  
Honestidad en el PR body: “fricción + good bots; no reemplaza WM ni originals off-site.”
