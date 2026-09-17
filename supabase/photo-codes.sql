-- Photo public codes for order identification (WhatsApp / delivery)
-- Human-readable short code, unique. UUID stays internal.

alter table public.photos
  add column if not exists code text;

-- backfill missing codes
update public.photos
set code = upper(substr(replace(id::text, '-', ''), 1, 8))
where code is null or code = '';

create unique index if not exists photos_code_uidx on public.photos (code);

create or replace function public.gen_photo_code()
returns text
language plpgsql
as $$
declare
  candidate text;
  i int := 0;
begin
  loop
    -- 8 chars base36-ish from random + clock
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

comment on column public.photos.code is 'Código corto público para identificar la foto en pedidos WA / entrega';
