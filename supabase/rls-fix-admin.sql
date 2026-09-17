-- Fix infinite recursion on profiles RLS (admin policy queried profiles while reading profiles).
-- Safe is_admin() runs as owner and bypasses RLS.

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

-- Recreate admin policies without self-referential EXISTS on profiles
drop policy if exists "admin all profiles" on public.profiles;
drop policy if exists "users read own profile" on public.profiles;
drop policy if exists "admin all albums" on public.albums;
drop policy if exists "admin all photos" on public.photos;
drop policy if exists "admin all orders" on public.orders;
drop policy if exists "admin all order_items" on public.order_items;
drop policy if exists "admin all settings" on public.settings;
drop policy if exists "admin all face_embeddings" on public.face_embeddings;

create policy "users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "admin all profiles"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

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

-- face_embeddings may not exist on fresh schema-only installs; guard
do $$
begin
  if to_regclass('public.face_embeddings') is not null then
    execute $p$
      create policy "admin all face_embeddings"
        on public.face_embeddings for all
        using (public.is_admin())
        with check (public.is_admin())
    $p$;
  end if;
end $$;

-- ensure Sole admin row (idempotent)
update public.profiles
set role = 'admin', full_name = coalesce(nullif(full_name, ''), 'Sole Yaquinta')
where id in (
  select id from auth.users where email = 'soleyaquinta@hotmail.com'
);

comment on function public.is_admin is 'RLS helper: true if auth.uid() has profiles.role=admin (security definer, no recursion)';
