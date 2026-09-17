# Supabase Soleph

## Proyecto activo

| | |
|--|--|
| **Ref** | `xfjukxgkqgwmghteooht` |
| **URL** | `https://xfjukxgkqgwmghteooht.supabase.co` |
| **Uso** | Admin, tienda, storage, face Edge Functions |

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
supabase link --project-ref xfjukxgkqgwmghteooht
supabase secrets set AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... REKOGNITION_COLLECTION_PREFIX=soleph-
supabase functions deploy face-index
supabase functions deploy face-search
```

## Front

`PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` del proyecto de arriba.  
Reiniciar `npm run dev` después de tocar `.env`.
