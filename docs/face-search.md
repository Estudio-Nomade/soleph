# Face search Soleph — AWS Rekognition

Prod usa **AWS Rekognition** vía Supabase Edge Functions (no keys en el browser).

```
Admin sube foto → face-index → IndexFaces (collection soleph-{albumId})
Comprador selfie → face-search → SearchFacesByImage → photo_ids → carrito
Álbum: abrir foto → face-detect (boxes) → click cara → crop → face-search → ?cara= filtro
```

## Setup

Ver `docs/aws-rekognition-setup.md`.

Secrets (Supabase Edge + `.env` local, nunca `PUBLIC_*`):

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `REKOGNITION_COLLECTION_PREFIX=soleph-`

Deploy:

```bash
supabase functions deploy face-index --no-verify-jwt
supabase functions deploy face-search --no-verify-jwt
supabase functions deploy face-detect --no-verify-jwt
```

## Código

- `src/lib/face.js` — client hacia Edge Functions (index, search, detect, token `cara`)
- Admin `evento/editar` — index al subir + “Reindexar caras”
- `/tienda/buscar` — eventos live + resultados
- `/tienda/evento` — click cara en lightbox → filtro grid + `?cara=`
- `supabase/functions/face-index` / `face-search` / `face-detect`

## Auth

- `face-index`: JWT admin (o service role)
- `face-search` / `face-detect`: público sobre álbumes `published + search_by_face`

## Click cara (álbum)

1. Lightbox open → `DetectFaces` (no guarda boxes en DB)
2. Overlay en caras → crop → `SearchFacesByImage`
3. Grid solo matches; URL `?id={album}&cara={token}` (token = photoId + box, base64url)
4. Spec: `docs/superpowers/specs/2026-09-22-face-click-filter-design.md`

## Cómo probar

1. `/admin/login` → Sole
2. Crear evento, **publicar**, buscar por cara on
3. Subir fotos (indexa con Rekognition)
4. `/tienda/buscar` → evento “en vivo” → selfie → matches

Threshold default similarity: **85** (`DEFAULT_MATCH_THRESHOLD` en `face.js`).

## Costo

~USD 0,001 / Index o Search. Budget alarm recomendado: **USD 5/mes**.

## Legacy

`supabase/face.sql` (pgvector + face-api) queda como experimento local; el path activo de tienda/admin es Rekognition.
