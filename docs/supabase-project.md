# Supabase Soleph

## Proyecto activo

| | |
|--|--|
| **Ref** | `kmdxrjbofkfrzodjjmwj` |
| **URL** | `https://kmdxrjbofkfrzodjjmwj.supabase.co` |
| **Uso** | Admin, tienda, DB/auth. Blobs en SeaweedFS (`s3.estudionomade.com.ar`) |

Keys solo en `.env` local / secrets de host (Vercel, Edge Functions).  
Nunca commitear `service_role`.

## SQL a correr (orden)

1. `supabase/schema.sql` — albums, photos, settings, RLS, buckets  
2. `supabase/categories.sql` — categorías + `photos.code` / `source_filename`  
3. (Opcional face embeddings locales) `supabase/face.sql`  
4. Si hace falta: `supabase/rls-fix-admin.sql`

## Admin user

1. Auth → Users → crear `soleyaquinta@hotmail.com` + password  
2. SQL:

```sql
insert into public.profiles (id, full_name, role)
select id, 'Sole', 'admin'
from auth.users
where email = 'soleyaquinta@hotmail.com'
on conflict (id) do update
  set role = 'admin', full_name = excluded.full_name;
```

## Edge Functions

```bash
supabase link --project-ref kmdxrjbofkfrzodjjmwj
# Storage (Seaweed):
supabase secrets set \
  S3_ENDPOINT=https://s3.estudionomade.com.ar \
  S3_PRESIGN_ENDPOINT=https://s3.estudionomade.com.ar \
  S3_REGION=us-east-1 \
  S3_ACCESS_KEY_ID=... \
  S3_SECRET_ACCESS_KEY=... \
  S3_BUCKET=storage
supabase functions deploy storage-presign --no-verify-jwt
supabase functions deploy storage-delete --no-verify-jwt
# Face (opcional, AWS):
# supabase secrets set AWS_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... REKOGNITION_COLLECTION_PREFIX=soleph-
# supabase functions deploy face-index face-search face-detect
```

## Front

`PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` + `PUBLIC_MEDIA_BASE_URL=https://s3.estudionomade.com.ar`  
Reiniciar `npm run dev` después de tocar `.env`. Ver `docs/seaweed-storage.md`.
