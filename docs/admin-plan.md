# Admin Soleph

Panel para Sole. Storefront ya vende; el admin carga eventos, precios y fotos.

## Qué puede hacer Sole (MVP listo en código)

1. Login en `/admin/login` (Supabase Auth + `profiles.role = admin`)
2. Listar eventos en `/admin`
3. Crear evento en `/admin/evento`
4. Editar en `/admin/evento/editar?id=…`:
   - nombre, slug, fecha, tipo (event|portfolio), mensaje
   - precio unitario + packs (tiers)
   - publish / despublicar
   - upload lote: original privado + preview con marca de agua en browser
   - elegir cover
   - borrar foto / borrar evento

## Stack

- Mismo monorepo Astro → rutas `/admin/*` (client-side auth gate)
- `@supabase/supabase-js`
- Watermark client-side (`src/lib/watermark.js`) — sin Edge Function todavía
- Precios en tabla `albums`

## Supabase

- Ref: `xfjukxgkqgwmghteooht`
- URL: `https://xfjukxgkqgwmghteooht.supabase.co`
- Keys en `.env` (`PUBLIC_SUPABASE_*`; service role solo server)
- Correr: `supabase/schema.sql` + `supabase/categories.sql` en SQL Editor

### Bootstrap admin user

1. Auth → add user (email de Sole + password)
2. En SQL:

```sql
update public.profiles
set role = 'admin', full_name = 'Sole Yaquinta'
where id = '<uuid-del-user>';
-- si el trigger no corrió:
-- insert into public.profiles (id, full_name, role) values ('<uuid>', 'Sole Yaquinta', 'admin');
```

3. Entrar a `/admin/login`

## Compra (storefront actual)

- Solo **transferencia**
- Pedido + comprobante por **WhatsApp**
- Formato por foto: `redes` (default) | `impresion`
- Catálogo tienda todavía lee `src/data/site.json` hasta cablear select de álbumes publicados

## Face recognition

- **Default actual en código browser:** face-api + pgvector (`docs/face-search.md`)
- **Objetivo prod (elegido):** **AWS Rekognition** vía Edge Functions
  - Setup paso a paso: `docs/aws-rekognition-setup.md`
  - Functions: `supabase/functions/face-index`, `face-search`
  - Budget alarm: **USD 5/mes**
  - Keys solo en secrets (nunca `PUBLIC_*`)

Hasta pegar keys AWS, el path live de buscar puede usar embeddings locales.