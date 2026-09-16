# Soleph — portfolio + tienda de fotos (Sole Yaquinta)

Sitio Astro para Sole Yaquinta: portfolio fotográfico (contenido real migrado de Adobe Portfolio) y tienda de venta de fotos de eventos con flujo tipo FullFoto (álbumes, carrito, packs, checkout demo MP/transferencia).

## Stack

- Astro 7 (static)
- CSS propio (tokens de marca Sole: navy `#012B55`)
- Carrito en `localStorage` (sin backend todavía)
- Imágenes en `public/images` (descargadas del portfolio original)

## Scripts

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Rutas

| Ruta | Qué es |
|------|--------|
| `/` | Work — grilla de proyectos |
| `/proyecto/[slug]` | Galería de proyecto + lightbox |
| `/sobre-mi` | Bio real |
| `/contacto` | Formulario |
| `/tienda` | Listado de álbumes/eventos |
| `/tienda/buscar` | Entrada dorsal / selfie |
| `/tienda/[albumId]` | Grid de fotos, watermark, carrito |
| `/tienda/carrito` | Checkout demo |

## Datos

Fuente de verdad de contenido: `src/data/site.json`.

## Estado

- Portfolio: contenido real de Sole (proyectos, textos, logo, fotos).
- Tienda: UX de compra lista; pago Mercado Pago queda cableable (preferencia server-side). Reconocimiento facial = demo local hasta conectar proveedor.
- Contacto: submit muestra gracias + `mailto` fallback.

## Repo

Estudio Nómade · privado por defecto.
