# Face search Soleph — AWS Rekognition

Prod usa **AWS Rekognition** vía Supabase Edge Functions (no keys en el browser).

```
Admin sube foto → face-index → IndexFaces (collection soleph-{albumId})
Comprador selfie → face-search → SearchFacesByImage → photo_ids → carrito
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
```

## Código

- `src/lib/face.js` — client hacia Edge Functions
- Admin `evento/editar` — index al subir + “Reindexar caras”
- `/tienda/buscar` — eventos live + resultados
- `supabase/functions/face-index` / `face-search`

## Auth

- `face-index`: JWT admin (o service role)
- `face-search`: público sobre álbumes `published + search_by_face`

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
