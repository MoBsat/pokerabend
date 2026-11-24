-- =====================================================================
-- Pokerabend – komplettes Datenbankschema (Neuinstallation)
-- Einmal komplett im Supabase SQL-Editor ausführen.
-- =====================================================================

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 30),
  is_admin     boolean not null default false,
  approved     boolean not null default false,   -- neue Accounts müssen vom Admin freigeschaltet werden
  created_at   timestamptz not null default now()
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.is_admin and p.approved from public.profiles p where p.id = auth.uid()),
    false);
$$;

create function public.is_approved() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.approved from public.profiles p where p.id = auth.uid()),
    false);
$$;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                               split_part(new.email, '@', 1)), 30);
begin
  if char_length(coalesce(v_name, '')) < 2 then
    v_name := 'Spieler ' || left(new.id::text, 4);
  end if;
  insert into public.profiles (id, display_name) values (new.id, v_name);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Normale Nutzer dürfen nur ihren Anzeigenamen ändern, nicht
-- is_admin/approved (auch nicht bei sich selbst).
create function public.protect_profile_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated')
     and not public.is_admin()
     and (new.is_admin is distinct from old.is_admin
          or new.approved is distinct from old.approved
          or new.id is distinct from old.id) then
    raise exception 'Keine Berechtigung, diese Felder zu ändern';
  end if;
  return new;
end;
$$;

create trigger protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
grant select, update on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (public.is_approved() or id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());


-- =====================================================================
-- Spielbetrieb
-- =====================================================================
-- ---------------------------------------------------------------------
-- Alte Strukturen entfernen (Accounts/Profile bleiben erhalten)
-- ---------------------------------------------------------------------
drop table if exists public.results, public.bring_items, public.bring_claims,
  public.food_votes, public.food_options, public.food_orders,
  public.attendance, public.evenings, public.players cascade;
drop function if exists public.claim_item(bigint);
drop function if exists public.release_item(bigint);
drop function if exists public.set_results(bigint, uuid[]);
drop function if exists public.set_results(bigint, bigint[]);
drop function if exists public.evening_open(bigint);
drop function if exists public.voting_open(bigint);
drop function if exists public.can_vote(bigint, bigint);
drop function if exists public.my_player_id();
drop function if exists public.approve_user(uuid, bigint, text);
drop function if exists public.set_vote_deadline();
drop function if exists public.drop_food_when_not_attending();
drop function if exists public.drop_food_when_attendance_deleted();

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

-- Spieler (auch ohne Account). Ein Account wird vom Admin einem Spieler zugeordnet.
create table public.players (
  id         bigint generated always as identity primary key,
  name       text not null unique check (char_length(name) between 1 and 30),
  user_id    uuid unique references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.evenings (
  id            bigint generated always as identity primary key,
  starts_at     timestamptz not null unique,
  location      text not null default 'Bei Vito' check (char_length(location) <= 100),
  notes         text check (char_length(notes) <= 1000),
  vote_deadline timestamptz not null,   -- wird automatisch auf 10:00 Uhr (Berlin) am Spieltag gesetzt
  created_at    timestamptz not null default now()
);

create table public.attendance (
  evening_id bigint not null references public.evenings(id) on delete cascade,
  player_id  bigint not null references public.players(id) on delete cascade,
  status     text   not null check (status in ('ja', 'vielleicht', 'nein')),
  updated_at timestamptz not null default now(),
  primary key (evening_id, player_id)
);

-- Essensbestellung pro Person: je 0-2 Adana und 0-2 Wurst
create table public.food_orders (
  evening_id bigint   not null references public.evenings(id) on delete cascade,
  player_id  bigint   not null references public.players(id) on delete cascade,
  adana      smallint not null default 0 check (adana between 0 and 2),
  wurst      smallint not null default 0 check (wurst between 0 and 2),
  updated_at timestamptz not null default now(),
  primary key (evening_id, player_id),
  check (adana + wurst > 0)
);

-- Mitbringen: feste Positionen (je Abend nur einmal vergebbar) + Sonstiges mit Freitext
create table public.bring_claims (
  id         bigint generated always as identity primary key,
  evening_id bigint not null references public.evenings(id) on delete cascade,
  player_id  bigint not null references public.players(id) on delete cascade,
  item       text   not null check (item in ('Cola', 'Wasser', 'Körner', 'Gummibärchen', 'Chips', 'Sonstiges')),
  note       text   check (char_length(note) <= 60),
  created_at timestamptz not null default now(),
  check (item <> 'Sonstiges' or char_length(trim(coalesce(note, ''))) > 0)
);
create unique index bring_claims_fixed_unique on public.bring_claims (evening_id, item) where item <> 'Sonstiges';

-- Ergebnis: volle Platzierung (place gesetzt) oder nur Sieger/Verlierer (Altdaten, place leer)
create table public.results (
  evening_id bigint  not null references public.evenings(id) on delete cascade,
  player_id  bigint  not null references public.players(id) on delete cascade,
  place      int     check (place >= 1),
  is_winner  boolean not null default false,
  is_buyer   boolean not null default false,   -- kauft Essen (die letzten 3)
  primary key (evening_id, player_id),
  unique (evening_id, place)
);

create index on public.attendance (player_id);
create index on public.bring_claims (evening_id);
create index on public.results (player_id);

-- ---------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------

create function public.my_player_id() returns bigint
language sql stable security definer set search_path = '' as $$
  select p.id from public.players p where p.user_id = auth.uid();
$$;

create function public.voting_open(p_evening bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select now() < e.vote_deadline from public.evenings e where e.id = p_evening), false);
$$;

-- Darf der aktuelle Nutzer für diesen Spieler an diesem Abend etwas ändern?
-- Admin immer; sonst nur für sich selbst und nur bis zur Frist.
create function public.can_vote(p_evening bigint, p_player bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
      or (public.is_approved()
          and p_player = public.my_player_id()
          and public.voting_open(p_evening));
$$;

-- Frist: Spieltag 10:00 Uhr deutscher Zeit
create function public.set_vote_deadline() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.vote_deadline := (date_trunc('day', new.starts_at at time zone 'Europe/Berlin') + interval '10 hours')
                       at time zone 'Europe/Berlin';
  return new;
end;
$$;
create trigger set_vote_deadline
  before insert or update of starts_at on public.evenings
  for each row execute function public.set_vote_deadline();

-- Wer nicht (mehr) "dabei" ist, bekommt auch kein Essen
create function public.drop_food_when_not_attending() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'ja' then
    delete from public.food_orders where evening_id = new.evening_id and player_id = new.player_id;
  end if;
  return new;
end;
$$;
create trigger drop_food_when_not_attending
  after insert or update on public.attendance
  for each row execute function public.drop_food_when_not_attending();

create function public.drop_food_when_attendance_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.food_orders where evening_id = old.evening_id and player_id = old.player_id;
  return old;
end;
$$;
create trigger drop_food_when_attendance_deleted
  after delete on public.attendance
  for each row execute function public.drop_food_when_attendance_deleted();

-- ---------------------------------------------------------------------
-- RPCs (nur Admin)
-- ---------------------------------------------------------------------

-- Platzierung speichern: p_players in Reihenfolge Platz 1 .. n; erst ab Beginn des Abends
create function public.set_results(p_evening bigint, p_players bigint[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_n int := coalesce(cardinality(p_players), 0);
begin
  if not public.is_admin() then
    raise exception 'Nur der Admin darf Ergebnisse eintragen';
  end if;
  if not exists (select 1 from public.evenings e where e.id = p_evening and now() >= e.starts_at) then
    raise exception 'Die Platzierung kann erst nach Beginn des Abends eingetragen werden';
  end if;
  if v_n < 2 then
    raise exception 'Mindestens 2 Spieler eintragen';
  end if;
  if (select count(distinct x) from unnest(p_players) x) <> v_n then
    raise exception 'Ein Spieler ist doppelt eingetragen';
  end if;
  delete from public.results where evening_id = p_evening;
  insert into public.results (evening_id, player_id, place, is_winner, is_buyer)
  select p_evening, t.pid, t.ord::int, t.ord = 1, t.ord > greatest(v_n - 3, 1)
    from unnest(p_players) with ordinality as t(pid, ord);
end;
$$;

-- Account freischalten und einem (bestehenden oder neuen) Spieler zuordnen
create function public.approve_user(p_user uuid, p_player bigint, p_new_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Nur der Admin darf Accounts freischalten';
  end if;
  update public.players set user_id = null where user_id = p_user;
  if p_player is null then
    if char_length(trim(coalesce(p_new_name, ''))) = 0 then
      raise exception 'Spielername fehlt';
    end if;
    insert into public.players (name, user_id) values (trim(p_new_name), p_user);
  else
    update public.players set user_id = p_user where id = p_player and user_id is null;
    if not found then
      raise exception 'Dieser Spieler ist schon einem anderen Account zugeordnet';
    end if;
  end if;
  update public.profiles set approved = true where id = p_user;
end;
$$;

revoke execute on function public.set_results(bigint, bigint[]), public.approve_user(uuid, bigint, text) from public, anon;
grant execute on function public.set_results(bigint, bigint[]), public.approve_user(uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- Rechte + Row Level Security
-- ---------------------------------------------------------------------

revoke all on public.players, public.evenings, public.attendance, public.food_orders,
  public.bring_claims, public.results from anon;
grant select, insert, update, delete on public.players, public.evenings, public.attendance,
  public.food_orders, public.bring_claims, public.results to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.players      enable row level security;
alter table public.evenings     enable row level security;
alter table public.attendance   enable row level security;
alter table public.food_orders  enable row level security;
alter table public.bring_claims enable row level security;
alter table public.results      enable row level security;

create policy players_select on public.players for select to authenticated
  using (public.is_approved() or user_id = auth.uid());
create policy players_admin on public.players for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy evenings_select on public.evenings for select to authenticated
  using (public.is_approved());
create policy evenings_admin on public.evenings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy attendance_select on public.attendance for select to authenticated
  using (public.is_approved());
create policy attendance_write on public.attendance for all to authenticated
  using (public.can_vote(evening_id, player_id))
  with check (public.can_vote(evening_id, player_id));

create policy food_select on public.food_orders for select to authenticated
  using (public.is_approved());
create policy food_write on public.food_orders for all to authenticated
  using (public.can_vote(evening_id, player_id))
  with check (public.can_vote(evening_id, player_id)
              and (public.is_admin()
                   or exists (select 1 from public.attendance a
                               where a.evening_id = food_orders.evening_id
                                 and a.player_id = food_orders.player_id
                                 and a.status = 'ja')));

create policy bring_select on public.bring_claims for select to authenticated
  using (public.is_approved());
create policy bring_write on public.bring_claims for all to authenticated
  using (public.can_vote(evening_id, player_id))
  with check (public.can_vote(evening_id, player_id));

-- Ergebnisse nur lesen; geschrieben wird ausschließlich über set_results()
create policy results_select on public.results for select to authenticated
  using (public.is_approved());

-- ---------------------------------------------------------------------
-- Daten: Spieler, bisherige Abende, Termine bis Ende 2027
-- ---------------------------------------------------------------------

insert into public.players (name) values
  ('Mo'), ('Ando'), ('Karo'), ('Fadi'), ('Hraj'), ('Vito'), ('George'), ('Awo'), ('Ahmad');

-- Admin-Account mit Spieler "Mo" verknüpfen
update public.players
   set user_id = (select id from public.profiles where is_admin and approved order by created_at limit 1)
 where name = 'Mo';

-- Bisherige Abende + jeden Freitag 19:00 Uhr bis Ende 2027
insert into public.evenings (starts_at)
select (d::date + time '19:00') at time zone 'Europe/Berlin'
  from generate_series(date '2026-10-16', date '2027-12-31', interval '7 days') d;

-- Bisherige Ergebnisse (nur Sieger und Verlierer bekannt)
insert into public.results (evening_id, player_id, is_winner, is_buyer)
select e.id, p.id, v.winner, not v.winner
  from (values
    ('2026-10-16', 'Karo',   true), ('2026-10-16', 'Awo',    false), ('2026-10-16', 'Ando',  false),
    ('2026-10-23', 'Ando',   true), ('2026-10-23', 'George', false), ('2026-10-23', 'Vito',  false),
    ('2026-10-30', 'Fadi',   true), ('2026-10-30', 'George', false), ('2026-10-30', 'Awo',   false),
    ('2026-11-06', 'Ando',   true), ('2026-11-06', 'George', false), ('2026-11-06', 'Awo',   false),
    ('2026-11-13', 'Mo',     true), ('2026-11-13', 'Ahmad',  false), ('2026-11-13', 'Ando',  false),
                                    ('2026-11-13', 'Karo',   false),
    ('2026-11-20', 'Hraj',   true), ('2026-11-20', 'Mo',     false), ('2026-11-20', 'Vito',  false),
                                    ('2026-11-20', 'Karo',   false)
  ) as v(day, name, winner)
  join public.evenings e on (e.starts_at at time zone 'Europe/Berlin')::date = v.day::date
  join public.players p on p.name = v.name;

-- ---------------------------------------------------------------------
-- Profilbilder (Supabase Storage, öffentlicher Bucket "avatars")
-- Dateien liegen unter avatars/player-<id>/<name>.webp
-- ---------------------------------------------------------------------

alter table public.players add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 307200, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Darf der aktuelle Nutzer Bilder für diesen Ordner verwalten? (eigener Spieler oder Admin)
create or replace function public.can_manage_avatar(p_object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
      or (public.is_approved()
          and public.my_player_id() is not null
          and split_part(p_object_name, '/', 1) = 'player-' || public.my_player_id()::text);
$$;

drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;
drop policy if exists avatars_select on storage.objects;

create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.can_manage_avatar(name));
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and public.can_manage_avatar(name))
  with check (bucket_id = 'avatars' and public.can_manage_avatar(name));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.can_manage_avatar(name));
-- Lesen der eigenen Dateien (Anzeige läuft über die öffentliche URL und braucht das nicht)
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.can_manage_avatar(name));

-- Bildpfad am Spieler setzen (null = Bild entfernen)
create or replace function public.set_avatar(p_player bigint, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or (public.is_approved() and p_player = public.my_player_id())) then
    raise exception 'Keine Berechtigung';
  end if;
  if p_path is not null and p_path !~ ('^player-' || p_player || '/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'Ungültiger Dateipfad';
  end if;
  update public.players set avatar_path = p_path where id = p_player;
end;
$$;

revoke execute on function public.set_avatar(bigint, text) from public, anon;
grant execute on function public.set_avatar(bigint, text) to authenticated;

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
