-- =====================================================================
-- Pokerabend – Update auf Version 4 (Pinnwand, Chat, Regeln)
-- Für bestehende Installationen (Version 3): einmal im Supabase SQL-Editor ausführen.
-- Bestehende Daten bleiben vollständig erhalten. Mehrfaches Ausführen schadet nicht.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pinnwand, Chat, Regeln (Version 4)
-- ---------------------------------------------------------------------

create table if not exists public.posts (
  id         bigint generated always as identity primary key,
  player_id  bigint not null references public.players(id) on delete cascade,
  body       text check (char_length(body) <= 2000),
  image_path text,
  created_at timestamptz not null default now(),
  check (char_length(trim(coalesce(body, ''))) > 0 or image_path is not null)
);

create table if not exists public.post_comments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.posts(id) on delete cascade,
  player_id  bigint not null references public.players(id) on delete cascade,
  body       text   not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.post_likes (
  post_id   bigint not null references public.posts(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  primary key (post_id, player_id)
);

create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  player_id  bigint not null references public.players(id) on delete cascade,
  body       text   not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- Bearbeitbare Texte (z. B. Regeln)
create table if not exists public.app_texts (
  key        text primary key,
  body       text not null default '' check (char_length(body) <= 20000),
  updated_at timestamptz not null default now()
);

create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists post_comments_post_idx on public.post_comments (post_id);
create index if not exists chat_created_idx on public.chat_messages (created_at desc);

-- Sieger des letzten Abends mit Ergebnis
create or replace function public.current_champion() returns bigint
language sql stable security definer set search_path = '' as $$
  select r.player_id
    from public.results r
    join public.evenings e on e.id = r.evening_id
   where r.is_winner
   order by e.starts_at desc
   limit 1;
$$;

-- Darf der aktuelle Nutzer jetzt ein Bild posten?
create or replace function public.can_post_image() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_approved()
     and public.my_player_id() is not null
     and public.my_player_id() = public.current_champion();
$$;

-- ---------------------------------------------------------------------
-- Rechte + Row Level Security
-- ---------------------------------------------------------------------

revoke all on public.posts, public.post_comments, public.post_likes, public.chat_messages, public.app_texts from anon;
grant select, insert, update, delete on public.posts, public.post_comments, public.post_likes,
  public.chat_messages, public.app_texts to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.posts         enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_likes    enable row level security;
alter table public.chat_messages enable row level security;
alter table public.app_texts     enable row level security;

drop policy if exists posts_select on public.posts;
drop policy if exists posts_insert on public.posts;
drop policy if exists posts_delete on public.posts;
create policy posts_select on public.posts for select to authenticated using (public.is_approved());
-- Bild nur für den Sieger des letzten Abends, und nur aus seinem eigenen Ordner
create policy posts_insert on public.posts for insert to authenticated
  with check (public.is_approved()
              and player_id = public.my_player_id()
              and (image_path is null
                   or (public.can_post_image()
                       and image_path ~ ('^post-' || player_id || '/[A-Za-z0-9._-]{1,80}$'))));
create policy posts_delete on public.posts for delete to authenticated
  using (player_id = public.my_player_id() or public.is_admin());

drop policy if exists comments_select on public.post_comments;
drop policy if exists comments_insert on public.post_comments;
drop policy if exists comments_delete on public.post_comments;
create policy comments_select on public.post_comments for select to authenticated using (public.is_approved());
create policy comments_insert on public.post_comments for insert to authenticated
  with check (public.is_approved() and player_id = public.my_player_id());
create policy comments_delete on public.post_comments for delete to authenticated
  using (player_id = public.my_player_id() or public.is_admin());

drop policy if exists likes_select on public.post_likes;
drop policy if exists likes_insert on public.post_likes;
drop policy if exists likes_delete on public.post_likes;
create policy likes_select on public.post_likes for select to authenticated using (public.is_approved());
create policy likes_insert on public.post_likes for insert to authenticated
  with check (public.is_approved() and player_id = public.my_player_id());
create policy likes_delete on public.post_likes for delete to authenticated
  using (player_id = public.my_player_id());

drop policy if exists chat_select on public.chat_messages;
drop policy if exists chat_insert on public.chat_messages;
drop policy if exists chat_delete on public.chat_messages;
create policy chat_select on public.chat_messages for select to authenticated using (public.is_approved());
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (public.is_approved() and player_id = public.my_player_id());
create policy chat_delete on public.chat_messages for delete to authenticated
  using (player_id = public.my_player_id() or public.is_admin());

drop policy if exists texts_select on public.app_texts;
drop policy if exists texts_admin on public.app_texts;
create policy texts_select on public.app_texts for select to authenticated using (public.is_approved());
create policy texts_admin on public.app_texts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Bilder der Pinnwand (öffentlicher Bucket "board")
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board', 'board', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists board_insert on storage.objects;
drop policy if exists board_delete on storage.objects;
drop policy if exists board_select on storage.objects;
create policy board_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'board'
              and public.can_post_image()
              and split_part(name, '/', 1) = 'post-' || public.my_player_id()::text);
create policy board_delete on storage.objects for delete to authenticated
  using (bucket_id = 'board'
         and (public.is_admin()
              or (public.my_player_id() is not null
                  and split_part(name, '/', 1) = 'post-' || public.my_player_id()::text)));
create policy board_select on storage.objects for select to authenticated
  using (bucket_id = 'board'
         and (public.is_admin()
              or (public.my_player_id() is not null
                  and split_part(name, '/', 1) = 'post-' || public.my_player_id()::text)));

-- ---------------------------------------------------------------------
-- Startinhalt der Regeln (nur falls noch keine vorhanden)
-- ---------------------------------------------------------------------

insert into public.app_texts (key, body) values ('rules',
'# Ablauf
- Wir spielen jeden Freitag um 19:00 Uhr bei Vito.
- Zusagen, Essen und Mitbringen bis Freitag 10:00 Uhr in der App eintragen. Danach ist alles gesperrt.

# Essen
- Die letzten 3 der Platzierung kaufen das Essen.
- Zur Auswahl stehen Adana und Wurst, jeweils 0 bis 2 Stück.

# Mitbringen
- Wer sich für etwas einträgt, bringt es auch mit.

# Spielregeln
- Hier eure Pokerregeln eintragen (Buy-in, Blinds, Rebuys …).

# Pinnwand
- Der Sieger des letzten Abends darf ein Bild posten, das oben für alle angezeigt wird.')
on conflict (key) do nothing;
