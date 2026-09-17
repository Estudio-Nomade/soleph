-- Camera file number as public photo code + categories (mansos/potros/damas/…)
-- Run in Supabase SQL editor of project xfjukxgkqgwmghteooht (or linked project).

create extension if not exists "pgcrypto";

-- ---------- categories ----------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums (id) on delete cascade,
  name text not null,
  slug text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (album_id, slug)
);

create index if not exists categories_album_id_idx on public.categories (album_id, sort_order);

create table if not exists public.photo_categories (
  photo_id uuid not null references public.photos (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (photo_id, category_id)
);

create index if not exists photo_categories_category_id_idx
  on public.photo_categories (category_id);

alter table public.categories enable row level security;
alter table public.photo_categories enable row level security;

-- is_admin helper (idempotent)
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

drop policy if exists "public read categories of published" on public.categories;
create policy "public read categories of published"
  on public.categories for select
  using (
    exists (
      select 1 from public.albums a
      where a.id = categories.album_id and a.published = true
    )
  );

drop policy if exists "admin all categories" on public.categories;
create policy "admin all categories"
  on public.categories for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public read photo_categories of published" on public.photo_categories;
create policy "public read photo_categories of published"
  on public.photo_categories for select
  using (
    exists (
      select 1
      from public.photos p
      join public.albums a on a.id = p.album_id
      where p.id = photo_categories.photo_id and a.published = true
    )
  );

drop policy if exists "admin all photo_categories" on public.photo_categories;
create policy "admin all photo_categories"
  on public.photo_categories for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- photo code = camera card number when possible ----------
alter table public.photos add column if not exists code text;
alter table public.photos add column if not exists source_filename text;

-- Prefer explicit code; unique per album is friendlier for camera numbers (0012 can repeat across albums)
drop index if exists photos_code_uidx;
create unique index if not exists photos_album_code_uidx on public.photos (album_id, code);

create or replace function public.gen_photo_code()
returns text
language plpgsql
as $$
declare
  candidate text;
  i int := 0;
begin
  loop
    candidate := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.photos p where p.code = candidate);
    i := i + 1;
    exit when i > 20;
  end loop;
  return candidate;
end;
$$;

create or replace function public.photos_set_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := public.gen_photo_code();
  else
    new.code := upper(btrim(new.code));
  end if;
  return new;
end;
$$;

drop trigger if exists photos_set_code_trg on public.photos;
create trigger photos_set_code_trg
  before insert or update of code on public.photos
  for each row execute function public.photos_set_code();

-- Seed default category names helper (call from app after album create)
comment on table public.categories is 'Filtros de álbum: mansos, potros, damas, etc.';
comment on column public.photos.code is 'Número de tarjeta/cámara o código corto (#1234)';
comment on column public.photos.source_filename is 'Nombre original del archivo al subir (DSC_1234.JPG)';
