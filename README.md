# Soleph — portfolio + tienda de fotos (Sole Yaquinta)

Sitio Astro para Sole Yaquinta (Tandil): portfolio fotográfico (contenido real de Adobe Portfolio) y tienda de venta de fotos de eventos (álbumes, packs, carrito, transferencia + WhatsApp).

## Stack

| Pieza | Rol |
|-------|-----|
| **Astro** (static) + CSS propio | Front / tienda / admin UI · navy `#012B55` |
| **Vercel** | Hosting del sitio |
| **Supabase** | Auth admin + Postgres (álbumes, precios, settings, pedidos) + Edge Functions |
| **SeaweedFS S3** (`s3.estudionomade.com.ar`) | Blobs de fotos (previews WM, covers; originals solo si aplica) |
| **Carrito** | `localStorage` + checkout transferencia / WhatsApp |
| **Estáticos** | `public/images` (logo, portada, sobre mí, proyectos seed) |

Supabase **no** es el disco de la vitrina a largo plazo: las fotos van al bucket S3 `storage`. Ver `docs/seaweed-storage.md`.

## Scripts

```bash
npm install
npm run dev      # http://localhost:4321
npm run build
npm run preview
```

## Env

Copiar `.env.example` → `.env` (nunca commitear `.env`).

| Variable | Dónde | Notas |
|----------|--------|--------|
| `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` | Front + Vercel | Proyecto activo (ver abajo) |
| `PUBLIC_MEDIA_BASE_URL` | Front + Vercel | `https://s3.estudionomade.com.ar` (sin `/` final) · rebuild tras cambiar |
| `PUBLIC_SITE_URL` | Front + Vercel | Prod: URL del sitio |
| `S3_*` | **Solo** Edge secrets + script migrate · **nunca** `PUBLIC_*` | Ver handoff env |
| AWS Rekognition | Solo Edge (face) · opcional | `docs/aws-rekognition-setup.md` |

Handoff env cutover: `docs/handoffs/ENV-seaweed-storage.md`.  
Secrets locales ops (keys, temp pass): `.ops-local/` (gitignored).

## Supabase (proyecto activo)

| | |
|--|--|
| **Ref** | `kmdxrjbofkfrzodjjmwj` |
| **URL** | `https://kmdxrjbofkfrzodjjmwj.supabase.co` |
| **Uso** | Admin, tienda live, DB/auth. Media → Seaweed |

Detalle setup SQL + admin user + deploy functions: `docs/supabase-project.md`.

```bash
# Orden SQL
# 1) supabase/schema.sql
# 2) supabase/categories.sql
# 3) opcional face: supabase/face.sql

supabase link --project-ref kmdxrjbofkfrzodjjmwj
supabase secrets set \
  S3_ENDPOINT=https://s3.estudionomade.com.ar \
  S3_PRESIGN_ENDPOINT=https://s3.estudionomade.com.ar \
  S3_REGION=us-east-1 \
  S3_ACCESS_KEY_ID=... \
  S3_SECRET_ACCESS_KEY=... \
  S3_BUCKET=storage
supabase functions deploy storage-presign --no-verify-jwt
supabase functions deploy storage-delete --no-verify-jwt
```

**Endpoint S3:** siempre el reverse proxy HTTPS `s3.estudionomade.com.ar`. No usar IP ni puerto `8333` desde Edge/cloud.

### Proyecto anterior (legacy)

`xfjukxgkqgwmghteooht` quedó con restricción de cuota Free (`402 exceed_storage_size_quota`) y previews legacy (~Tapalqué). No reusar como SoT salvo migración explícita. Docs/ops viejos pueden mencionarlo.

## Media (Seaweed)

| Prefijo en bucket `storage` | Uso |
|-------------------------------|-----|
| `previews/` | Vitrina tienda (WM) · público |
| `covers/` | Tapas álbum + portafolio · público |
| `originals/` | Solo si el producto lo pide · no público |

- Admin sube con **presign** (`storage-presign`) → PUT al S3.
- Modo vitrina: por defecto **solo preview WM** (sin originales de cámara en cloud).
- URL pública: `https://s3.estudionomade.com.ar/storage/{previews\|covers\|originals}/{path}`
- Migración one-shot desde buckets SB viejos:  
  `DRY_RUN=1 node scripts/migrate-supabase-to-s3.mjs --from-db`  
  luego sin `DRY_RUN`.
- Rollback lecturas: quitar `PUBLIC_MEDIA_BASE_URL` + rebuild (vuelve a URLs SB Storage si los objetos siguen ahí).

Doc: `docs/seaweed-storage.md`.

## Rutas públicas

| Ruta | Qué es |
|------|--------|
| `/` | Tienda (home) |
| `/trabajos` | Portfolio / trabajos |
| `/proyecto/ver?slug=` · `/proyecto/[slug]` | Galería proyecto |
| `/sobre-mi` | Bio |
| `/contacto` | Contacto |
| `/tienda/buscar` | Buscar mis fotos (face) |
| `/tienda/evento?id=` | Álbum live (Supabase) |
| `/tienda/[albumId]` | Álbum seed / estático |
| `/tienda/carrito` | Checkout transferencia + WA |

## Admin (Sole)

| Ruta | Qué es |
|------|--------|
| `/admin/login` | Login Supabase · debe mostrar host del proyecto activo |
| `/admin` | Lista de eventos |
| `/admin/evento` · `/admin/evento/editar?id=` | Alta/edición, precios, packs, categorías, cola de fotos, publicar |
| `/admin/portafolio` | Sobre mí, trabajos, textos de tienda |
| `/admin/transferencia` | CBU / alias / titular (carrito) |

Sin Supabase sano (Auth/REST OK) el admin **no** puede loguear ni subir; el S3 solo se usa **después** del presign vía Edge.

## Datos

| Fuente | Qué guarda |
|--------|------------|
| `src/data/site.json` | Seed portfolio / series estáticas / precios demo |
| Supabase `albums` / `photos` / `settings` | Eventos live, packs, mensajes, transferencia, CMS portafolio |
| Seaweed `storage` | Archivos de foto |
| `public/images` | Marca y estáticos del sitio |

## Face search

- Live: Edge `face-index` / `face-search` (+ AWS Rekognition si está configurado).
- UI tienda: sin jerga AWS. Doc: `docs/face-search.md`.

## Estado del producto

- Portfolio + tienda pública (transferencia + WA).
- Admin: eventos, packs, categorías, watermark client, publish, portafolio CMS.
- Storage cutover a Seaweed: código + env documentados; secrets/functions según handoff.
- Face: opcional según secrets AWS deployados.
- Labs vitrina (dev): `/lab/demo-vitrina`, etc.

## Docs útiles

| Doc | Tema |
|-----|------|
| `docs/supabase-project.md` | Proyecto SB, SQL, admin, functions |
| `docs/seaweed-storage.md` | S3 / Caddy / migrate / cutover |
| `docs/handoffs/ENV-seaweed-storage.md` | Qué setear en Vercel + Supabase |
| `docs/face-search.md` | Buscar mis fotos |
| `docs/aws-rekognition-setup.md` | IAM / secrets face |
| `AGENTS.md` | Convenciones para agentes |

## Repo

Estudio Nómade · `martiyaquinta/soleph` · privado.  
Branches `agent/…` · Conventional Commits · no `git add .` de secretos/PDFs locales.
