# SeaweedFS S3 — storage de fotos (Soleph)

Media pública y uploads admin van a SeaweedFS (API S3) detrás de Caddy. Supabase queda para Postgres + auth; los blobs viven en el bucket `storage`.

## 1. DNS

Registro **A**:

```
s3.estudionomade.com.ar  →  167.104.161.230
```

## 2. Caddy

En el host de Seaweed:

```caddyfile
s3.estudionomade.com.ar {
  reverse_proxy 127.0.0.1:8333
}
```

Puerto `8333` = S3 gateway de Seaweed en localhost. TLS lo resuelve Caddy.

## 3. CORS (PUT desde el browser)

El admin hace **PUT** al URL firmado desde orígenes de Soleph. Hay que permitir en Seaweed o en Caddy:

- Orígenes: `https://soleyaquinta.com.ar`, `http://localhost:4321` (y preview si hace falta)
- Métodos: `GET`, `PUT`, `HEAD`, `OPTIONS`
- Headers: `Content-Type`, `Authorization` (si el firmado los manda)

Sin CORS el upload falla en el browser aunque el presign esté bien.

## 4. Bucket y prefijos

| Prefijo | Uso | Lectura pública |
|---------|-----|-----------------|
| `previews/` | Vitrina tienda (WM) | Sí |
| `covers/` | Tapas álbum + portafolio | Sí |
| `originals/` | Originales de venta | No (solo GET firmado admin) |

Bucket único: **`storage`**.

La DB sigue guardando paths relativos (`preview_path`, `original_path`, `cover_path`); el kind/prefijo se arma en código.

## 5. Secrets Edge + deploy

En la máquina con CLI linkeado al proyecto:

```bash
supabase secrets set \
  S3_ENDPOINT=http://127.0.0.1:8333 \
  S3_PRESIGN_ENDPOINT=https://s3.estudionomade.com.ar \
  S3_REGION=us-east-1 \
  S3_ACCESS_KEY_ID='…' \
  S3_SECRET_ACCESS_KEY='…' \
  S3_BUCKET=storage
```

Si Edge no llega a `127.0.0.1` del host Seaweed, usar IP pública o red privada (`S3_ENDPOINT=http://167.104.161.230:8333`) y firewall acorde.

Deploy (auth admin va en el body de la function, no en el gateway JWT de Supabase):

```bash
supabase functions deploy storage-presign --no-verify-jwt
supabase functions deploy storage-delete --no-verify-jwt
```

## 6. Forma de URL pública

```
https://s3.estudionomade.com.ar/storage/{previews|covers|originals}/{path}
```

Ejemplo: `…/storage/previews/mi-album/abc-wm.jpg`

En Soleph: `PUBLIC_MEDIA_BASE_URL=https://s3.estudionomade.com.ar` (ver `.env.example`). El helper arma `/storage/{kind}/{path}`.

## 7. Rollback de lecturas

1. Sacar o vaciar `PUBLIC_MEDIA_BASE_URL` en el host / `.env`.
2. Rebuild del front.
3. `publicStorageUrl` vuelve a URLs públicas de Supabase Storage (`album-previews`, etc.) mientras los objetos viejos sigan ahí.

Los buckets de Supabase se dejan intactos ≥1 semana después del cutover; limpieza manual después.

## Migración one-shot

Con service role + credenciales S3 locales:

```bash
DRY_RUN=1 node scripts/migrate-supabase-to-s3.mjs --from-db
node scripts/migrate-supabase-to-s3.mjs --from-db
```

Copia `photos.preview_path` / `original_path` y `albums.cover_path` desde buckets `album-*` hacia prefijos en `storage`. Saltea keys que ya existen (HeadObject).

## Checklist cutover

1. DNS + Caddy OK  
2. GET de prueba a un objeto en `previews/`  
3. Secrets + deploy de las dos functions  
4. `PUBLIC_MEDIA_BASE_URL` + rebuild  
5. Migración `--from-db`  
6. Smoke: upload admin, URL de tienda en `s3.estudionomade.com.ar`, delete, face search si está activo  
