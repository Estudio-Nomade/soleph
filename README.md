# Soleph — portfolio + tienda de fotos (Sole Yaquinta)

Sitio Astro para Sole Yaquinta: portfolio fotográfico (contenido real migrado de Adobe Portfolio) y tienda de venta de fotos de eventos (álbumes, carrito, packs, transferencia + WhatsApp).

## Stack

- Astro 7 (static)
- CSS propio (navy `#012B55`)
- Carrito en `localStorage`
- Supabase (Auth + DB + Storage) para el **admin**
- Imágenes portfolio en `public/images`

## Scripts

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Rutas públicas

| Ruta | Qué es |
|------|--------|
| `/` | Tienda (home) |
| `/trabajos` | Portfolio |
| `/proyecto/[slug]` | Galería proyecto |
| `/sobre-mi` | Bio |
| `/contacto` | Contacto |
| `/tienda/buscar` | Buscar mis fotos (UX lista; motor face = fase 2) |
| `/tienda/[albumId]` | Grid álbum + carrito |
| `/tienda/carrito` | Checkout transferencia + WA |

## Admin (Sole)

| Ruta | Qué es |
|------|--------|
| `/admin/login` | Login Supabase |
| `/admin` | Lista de eventos |
| `/admin/evento` | Crear evento |
| `/admin/evento/editar?id=` | Editar, precios, packs, upload, publish |

Setup: correr `supabase/schema.sql`, crear user, `profiles.role = 'admin'`, keys en `.env`. Detalle en `docs/admin-plan.md`.

## Datos

- Contenido portfolio / demo tienda: `src/data/site.json`
- Eventos reales (admin): tablas Supabase `albums` / `photos`

## Estado

- Portfolio: contenido real de Sole
- Tienda pública: UX de compra lista (transferencia + WA)
- Admin MVP: código listo (login, CRUD, watermark client, storage)
- Face match: embeddings locales face-api + pgvector (estilo FullFoto). Ver `docs/face-search.md`.
- Tienda JSON demo convive; eventos “en vivo” salen de Supabase en `/tienda/buscar`.

## Repo

Estudio Nómade · privado por defecto.
