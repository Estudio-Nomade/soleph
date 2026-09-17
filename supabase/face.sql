-- Face search (FullFoto-style): embeddings 128-d + match por álbum
-- Run after schema.sql. Requires pgvector.

create extension if not exists vector;

create table if not exists public.face_embeddings (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.photos (id) on delete cascade,
  album_id uuid not null references public.albums (id) on delete cascade,
  -- face-api FaceRecognitionNet descriptor
  embedding vector(128) not null,
  box jsonb,
  det_score real,
  model text not null default 'face-api-128',
  created_at timestamptz not null default now()
);

create index if not exists face_embeddings_album_id_idx
  on public.face_embeddings (album_id);

create index if not exists face_embeddings_photo_id_idx
  on public.face_embeddings (photo_id);

-- L2 index (face-api descriptors compare well with euclidean)
create index if not exists face_embeddings_l2_idx
  on public.face_embeddings
  using hnsw (embedding vector_l2_ops);

alter table public.face_embeddings enable row level security;

drop policy if exists "admin all face_embeddings" on public.face_embeddings;
create policy "admin all face_embeddings"
  on public.face_embeddings for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Public does NOT read raw embeddings; only via RPC on published albums.

create or replace function public.match_album_faces(
  query_embedding vector(128),
  match_album uuid,
  match_threshold double precision default 0.55,
  match_count integer default 60
)
returns table (
  photo_id uuid,
  distance double precision,
  preview_path text,
  sort_order integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    fe.photo_id,
    min(fe.embedding <-> query_embedding)::double precision as distance,
    p.preview_path,
    p.sort_order
  from public.face_embeddings fe
  join public.photos p on p.id = fe.photo_id
  join public.albums a on a.id = fe.album_id
  where fe.album_id = match_album
    and a.published = true
    and a.search_by_face = true
    and (fe.embedding <-> query_embedding) < match_threshold
  group by fe.photo_id, p.preview_path, p.sort_order
  order by distance asc
  limit greatest(1, least(match_count, 200));
$$;

revoke all on function public.match_album_faces(vector, uuid, double precision, integer) from public;
grant execute on function public.match_album_faces(vector, uuid, double precision, integer) to anon, authenticated;

comment on table public.face_embeddings is 'Face descriptors (face-api 128-d). FullFoto-like selfie search.';
comment on function public.match_album_faces is 'Nearest faces in a published album by L2 distance.';
