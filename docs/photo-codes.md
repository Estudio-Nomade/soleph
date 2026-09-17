# Identificar fotos del cliente (post-compra)

## Problema

Sole recibe por WhatsApp un pedido con N fotos y tiene que encontrar
el **original** correcto en el álbum para mandarlo.

## Qué usamos

Cada foto tiene:

| Campo | Uso |
|-------|-----|
| `photos.id` (UUID) | Interno DB / Rekognition ExternalImageId |
| `photos.code` | **Código público** = nro de cámara si se pudo (DSC_1234 → `#1234`) |
| `photos.source_filename` | Nombre original al subir |
| `preview_path` / `original_path` | Archivos en Storage |

Ejemplo: `#1234` o `#0042`

### Mensaje de WhatsApp (checkout)

```
Pedido: ORD-…
Fotos:
1. Miramar 13/9 — #1234 — Redes
2. Miramar 13/9 — #0042 — Impresión
```

Sole busca por `#1234` en el admin del evento y baja el original.

## Flujo

1. Upload carpeta/archivos → `code` desde filename de cámara
2. Tienda / carrito guardan `id` + `code`
3. Checkout WA lista `#CODE` + formato + álbum
4. (Futuro) Admin “Pedidos” con links al original

## Categorías

Tabla `categories` + `photo_categories` (Mansos / Potros / Damas, etc.).
SQL: `supabase/categories.sql`.

## Transferencia (alias)

Admin → **Transferencia** (`/admin/transferencia`) guarda
`settings.storefront.transfer` (titular, alias, CBU).
El carrito lo lee en build + refresh en cliente.

## SQL

```bash
# en SQL editor de Supabase, o:
# supabase db query --linked -f supabase/categories.sql
```

`categories.sql` también agrega `photos.code`, `source_filename` y el
índice único por álbum.
