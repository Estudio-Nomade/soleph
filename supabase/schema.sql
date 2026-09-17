-- Soleph schema (Supabase)
-- Run in SQL editor. Designed for: admin events, watermarked previews,
-- full-res delivery files, editable prices, orders with format per photo.

create extension if not exists "pgcrypto";

-- profiles / admin gate (map auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'customer' check (role in ('admin', 'customer')),
  created_at timestamptz not null default now()
);

create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null default 'event' check (kind in ('event', 'portfolio')),
  date_label text,
  cover_path text,
  message text,
  published boolean not null default false,
  search_by_face boolean not null default true,
  photo_price_ars integer not null default 5000 check (photo_price_ars >= 0),
  -- [{ "quantity": 3, "price": 10000 }, ...]
  price_tiers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums (id) on delete cascade,
  sort_order integer not null default 0,
  -- public/watermarked preview (safe to show in storefront)
  preview_path text not null,
  -- private original / hi-res for delivery after payment
  original_path text,
  width integer,
  height integer,
  taken_at timestamptz,
  -- face index (AWS Rekognition) — phase 2
  rekognition_face_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists photos_album_id_idx on public.photos (album_id, sort_order);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  payment_method text not null check (payment_method in ('mercado_pago', 'transferencia')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'fulfilled', 'cancelled')),
  currency text not null default 'ARS',
  total_ars integer not null default 0,
  mp_preference_id text,
  mp_payment_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  photo_id uuid not null references public.photos (id),
  album_id uuid not null references public.albums (id),
  -- default redes if buyer never chose
  format text not null default 'redes' check (format in ('redes', 'impresion')),
  unit_price_ars integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- business settings editable without redeploy
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('formats', '{"default":"redes","options":[{"id":"redes","label":"Para redes"},{"id":"impresion","label":"Para impresión"}]}'::jsonb),
  ('storefront', '{"currency":"ARS","transfer":{"owner":"Sole Yaquinta","alias":null,"cbu":null}}'::jsonb)
on conflict (key) do nothing;

-- optional: auto profile row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Storage buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('album-previews', 'album-previews', true, 10485760, array['image/jpeg','image/png','image/webp']::text[]),
  ('album-originals', 'album-originals', false, 52428800, array['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]),
  ('album-covers', 'album-covers', true, 10485760, array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS
alter table public.albums enable row level security;
alter table public.photos enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;

-- drop old policies if re-running
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('albums','photos','orders','order_items','settings','profiles')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- public read published catalog
create policy "public read published albums"
  on public.albums for select
  using (published = true);

create policy "public read photos of published albums"
  on public.photos for select
  using (
    exists (
      select 1 from public.albums a
      where a.id = photos.album_id and a.published = true
    )
  );

create policy "public read settings"
  on public.settings for select
  using (true);

-- is_admin() avoids infinite recursion when policies on profiles
-- query profiles themselves (security definer bypasses RLS).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

-- own profile read
create policy "users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- admin full access via is_admin()
create policy "admin all albums"
  on public.albums for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin all photos"
  on public.photos for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin all orders"
  on public.orders for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin all order_items"
  on public.order_items for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin all settings"
  on public.settings for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin all profiles"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

-- Storage policies (admin write; public read on public buckets)
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'soleph %'
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy "soleph public read previews"
  on storage.objects for select
  using (bucket_id in ('album-previews', 'album-covers'));

create policy "soleph admin read originals"
  on storage.objects for select
  using (
    bucket_id = 'album-originals'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "soleph admin insert media"
  on storage.objects for insert
  with check (
    bucket_id in ('album-previews', 'album-originals', 'album-covers')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "soleph admin update media"
  on storage.objects for update
  using (
    bucket_id in ('album-previews', 'album-originals', 'album-covers')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    bucket_id in ('album-previews', 'album-originals', 'album-covers')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "soleph admin delete media"
  on storage.objects for delete
  using (
    bucket_id in ('album-previews', 'album-originals', 'album-covers')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

comment on table public.albums is 'Eventos/portfolio que Sole carga desde admin';
comment on column public.photos.preview_path is 'Marca de agua / web';
comment on column public.photos.original_path is 'Archivo full para entrega post-pago';
comment on column public.order_items.format is 'redes (default) | impresion';

-- After running this SQL:
-- 1) Auth → Users → invite/create Sole's user
-- 2) SQL: update public.profiles set role = 'admin', full_name = 'Sole' where id = '<user-uuid>';
-- 3) Put PUBLIC_SUPABASE_URL + PUBLIC_SUPABASE_ANON_KEY in .env
