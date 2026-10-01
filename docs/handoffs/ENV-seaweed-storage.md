# Handoff: variables de entorno — storage SeaweedFS (Soleph)

**Para quien tiene acceso a:** hosting del front Soleph + proyecto Supabase de Sole (`kmdxrjbofkfrzodjjmwj`).

**Contexto:** El código ya está. Las fotos nuevas van al S3 propio (SeaweedFS), bucket `storage`. Supabase sigue siendo solo DB + login admin.

**Infra VPS / DNS / Caddy:** ya está. **No hace falta tocar el server.**

**Doc técnico:** `docs/seaweed-storage.md`

---

## Qué hay que hacer (solo esto)

| # | Dónde | Qué |
|---|--------|-----|
| 1 | **Hosting del front** (donde se buildea Soleph) | Setear `PUBLIC_MEDIA_BASE_URL` y redeploy |
| 2 | **Supabase** (proyecto Soleph) | Secrets `S3_*` + deploy de 2 Edge Functions |
| 3 | **Una máquina con Node** (local o CI de confianza) | Correr el script de **migración** de fotos viejas |

**No** hace falta: DNS, Caddy, abrir puertos, crear bucket (ya montado).

**Nunca** pongas keys S3 ni `service_role` en variables `PUBLIC_*`.

---

## 1) Front — variable pública

En el entorno de **producción** del sitio:

```bash
PUBLIC_MEDIA_BASE_URL=https://s3.estudionomade.com.ar
```

- Sin barra final.
- Después: **rebuild / redeploy** (Astro la mete en el build).

Las `PUBLIC_SUPABASE_*` no cambian.

**Rollback de lecturas:** vaciar/sacar `PUBLIC_MEDIA_BASE_URL` y redeploy → URLs vuelven a Supabase Storage (mientras existan los buckets viejos).

---

## 2) Supabase — secrets + deploy de functions

Proyecto ref: **`kmdxrjbofkfrzodjjmwj`**  
URL: `https://kmdxrjbofkfrzodjjmwj.supabase.co`

Functions en el repo (ya codeadas):

- `storage-presign`
- `storage-delete`

### Opción A — con Supabase CLI (si está instalada y logueada)

```bash
# En el repo soleph, branch con el código de storage mergeado
cd /path/al/soleph

supabase login   # si no hay sesión
supabase link --project-ref kmdxrjbofkfrzodjjmwj

supabase secrets set \
  S3_ENDPOINT=https://s3.estudionomade.com.ar \
  S3_PRESIGN_ENDPOINT=https://s3.estudionomade.com.ar \
  S3_REGION=us-east-1 \
  S3_ACCESS_KEY_ID='PEGAR_ACCESS_KEY_SEAWEED' \
  S3_SECRET_ACCESS_KEY='PEGAR_SECRET_SEAWEED' \
  S3_BUCKET=storage

supabase functions deploy storage-presign --no-verify-jwt
supabase functions deploy storage-delete --no-verify-jwt

supabase secrets list   # verificar nombres (no muestra valores)
```

### Opción B — sin CLI (Dashboard)

Si **no** tiene CLI linkeada a este cliente:

1. Entrá al [Dashboard Supabase](https://supabase.com/dashboard) → proyecto **Soleph** (`kmdxrjbofkfrzodjjmwj`).
2. **Edge Functions → Secrets** (o Project Settings → Edge Functions → Secrets) y creá/editá:

| Nombre | Valor |
|--------|--------|
| `S3_ENDPOINT` | `https://s3.estudionomade.com.ar` |
| `S3_PRESIGN_ENDPOINT` | `https://s3.estudionomade.com.ar` |
| `S3_REGION` | `us-east-1` |
| `S3_ACCESS_KEY_ID` | *(access key del Seaweed/S3)* |
| `S3_SECRET_ACCESS_KEY` | *(secret del Seaweed/S3)* |
| `S3_BUCKET` | `storage` |

3. **Deploy de functions** sin CLI:
   - Ideal: que alguien con CLI haga el `deploy` de arriba una vez, **o**
   - GitHub Action / CI del repo si ya despliegan functions al merge, **o**
   - Instalar CLI solo para este deploy (~5 min):  
     https://supabase.com/docs/guides/cli → `supabase login` → `link` → `functions deploy …`

Las functions **tienen** que quedar desplegadas; solo secrets no alcanza.

`--no-verify-jwt` es a propósito: la function valida admin con el JWT (igual que face-index).

### Por qué ese endpoint

- **`S3_ENDPOINT`** y **`S3_PRESIGN_ENDPOINT`**: ambos  
  `https://s3.estudionomade.com.ar`  
  (dominio del S3; **no** la IP cruda).
- El browser y las Edge Functions hablan al mismo host público HTTPS.

Keys: las del user S3 de Seaweed (quien montó el storage). Pasarlas por canal seguro, no por grupo abierto si se puede.

---

## 3) Migración de fotos viejas

**Proyecto nuevo / sin fotos previas:** no hace falta migrar. Arrancá con uploads nuevos desde admin.

Si en el futuro hubiera objetos en Supabase Storage para copiar a Seaweed, el script es `scripts/migrate-supabase-to-s3.mjs --from-db` (ver `docs/seaweed-storage.md`).

---

## Orden

1. Secrets Supabase + **deploy** de las 2 functions  
2. `PUBLIC_MEDIA_BASE_URL` en el front + redeploy  
3. Smoke test (upload admin)  

---

## Smoke test (5 min)

1. `/admin` con usuario admin.  
2. Subir **1 foto** de prueba.  
3. Network:  
   - `…/functions/v1/storage-presign` → 200  
   - PUT a `s3.estudionomade.com.ar` → 200  
4. Tienda: imagen desde `https://s3.estudionomade.com.ar/storage/previews/…`  
5. Borrar esa foto en admin.  
6. Fotos **viejas** del álbum migrado también cargan desde `s3.estudionomade…` (si no, faltó migración o el front sin `PUBLIC_MEDIA_BASE_URL`).

---

## Si algo falla

| Síntoma | Revisar |
|---------|---------|
| Presign 401/403 | Sesión admin; functions deployadas con `--no-verify-jwt`; role `admin` en `profiles` |
| Presign 500 “Faltan S3_…” | Secrets mal nombrados o no guardados |
| PUT falla / CORS | Avisar a quien mira Caddy/Seaweed (infra ya debería estar) |
| Tienda sigue en `*.supabase.co/storage` | Falta `PUBLIC_MEDIA_BASE_URL` o no hubo rebuild |
| Fotos viejas 404 en s3 | Falta migración `--from-db` |
| “No tengo CLI” | Usar Dashboard para secrets (opción B) + pedir un deploy de functions a quien tenga CLI, o instalar CLI solo para eso |

---

## Resumen ultra corto para copiar/pegar

```
Soleph storage → Seaweed (s3.estudionomade.com.ar). VPS ya OK.

1) Front:
   PUBLIC_MEDIA_BASE_URL=https://s3.estudionomade.com.ar
   + redeploy

2) Supabase proyecto kmdxrjbofkfrzodjjmwj:
   Secrets:
     S3_ENDPOINT=https://s3.estudionomade.com.ar
     S3_PRESIGN_ENDPOINT=https://s3.estudionomade.com.ar
     S3_REGION=us-east-1
     S3_ACCESS_KEY_ID=…
     S3_SECRET_ACCESS_KEY=…
     S3_BUCKET=storage
   Deploy:
     storage-presign y storage-delete con --no-verify-jwt
   (CLI: supabase link + secrets set + functions deploy)
   (Sin CLI: secrets en Dashboard; deploy con CLI una vez o CI)

3) Proyecto vacío: no migrar. Subir fotos nuevas desde admin.

Nunca keys en PUBLIC_*. Detalle: docs/handoffs/ENV-seaweed-storage.md
```
