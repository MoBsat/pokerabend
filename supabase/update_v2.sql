-- =====================================================================
-- Pokerabend – Update auf Version 2
-- Für bestehende Installationen: einmal komplett im Supabase SQL-Editor ausführen.
--
-- ACHTUNG: Abende, Zusagen, Abstimmungen und Ergebnisse aus Version 1
-- werden gelöscht und neu angelegt. Accounts bleiben erhalten.
-- Der Admin-Account wird automatisch dem Spieler "Mo" zugeordnet.
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
