-- =====================================================================
-- Pokerabend – Datenbankschema für Supabase
-- Einmal komplett im Supabase SQL-Editor ausführen.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 30),
  is_admin     boolean not null default false,
  approved     boolean not null default false,   -- neue Accounts müssen vom Admin freigeschaltet werden
  created_at   timestamptz not null default now()
);

create table public.evenings (
  id         bigint generated always as identity primary key,
  starts_at  timestamptz not null,
  location   text check (char_length(location) <= 100),
  notes      text check (char_length(notes) <= 1000),
  closed     boolean not null default false,      -- abgeschlossen = keine Abstimmungen mehr
  created_at timestamptz not null default now()
);

create table public.attendance (
  evening_id bigint not null references public.evenings(id) on delete cascade,
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  status     text   not null check (status in ('ja', 'vielleicht', 'nein')),
  updated_at timestamptz not null default now(),
  primary key (evening_id, user_id)
);

create table public.food_options (
  id         bigint generated always as identity primary key,
  evening_id bigint not null references public.evenings(id) on delete cascade,
  label      text   not null check (char_length(label) between 1 and 60),
  unique (id, evening_id)
);

-- Eine Stimme pro Person und Abend (änderbar)
create table public.food_votes (
  evening_id bigint not null,
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  option_id  bigint not null,
  primary key (evening_id, user_id),
  foreign key (option_id, evening_id)
    references public.food_options(id, evening_id) on delete cascade
);

-- Admin gibt Positionen vor, wer zuerst zugreift, blockiert sie
create table public.bring_items (
  id         bigint generated always as identity primary key,
  evening_id bigint not null references public.evenings(id) on delete cascade,
  label      text   not null check (char_length(label) between 1 and 60),
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz
);

-- Vollständige Endplatzierung eines Abends
create table public.results (
  evening_id bigint not null references public.evenings(id) on delete cascade,
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  place      int    not null check (place >= 1),
  primary key (evening_id, user_id),
  unique (evening_id, place)
);

create index on public.attendance (user_id);
create index on public.food_options (evening_id);
create index on public.bring_items (evening_id);
create index on public.results (user_id);

-- ---------------------------------------------------------------------
-- Hilfsfunktionen (security definer, damit RLS nicht rekursiv wird)
-- ---------------------------------------------------------------------

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

create function public.evening_open(p_evening bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select not e.closed from public.evenings e where e.id = p_evening),
    false);
$$;

-- ---------------------------------------------------------------------
-- Profil bei Registrierung automatisch anlegen
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------

-- Position übernehmen (atomar: nur wenn noch frei)
create function public.claim_item(p_item bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_approved() then
    raise exception 'Account nicht freigeschaltet';
  end if;
  update public.bring_items b
     set claimed_by = auth.uid(), claimed_at = now()
   where b.id = p_item
     and b.claimed_by is null
     and public.evening_open(b.evening_id);
  if not found then
    raise exception 'Schon vergeben oder Abend abgeschlossen';
  end if;
end;
$$;

-- Position wieder freigeben (eigene, oder als Admin jede)
create function public.release_item(p_item bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bring_items b
     set claimed_by = null, claimed_at = null
   where b.id = p_item
     and (public.is_admin()
          or (b.claimed_by = auth.uid()
              and public.is_approved()
              and public.evening_open(b.evening_id)));
  if not found then
    raise exception 'Keine Berechtigung oder Abend abgeschlossen';
  end if;
end;
$$;

-- Ergebnis speichern: p_players in Reihenfolge Platz 1 .. n
create function public.set_results(p_evening bigint, p_players uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Nur der Admin darf Ergebnisse eintragen';
  end if;
  if (select count(distinct x) from unnest(p_players) x) <> coalesce(cardinality(p_players), 0) then
    raise exception 'Ein Spieler ist doppelt eingetragen';
  end if;
  delete from public.results where evening_id = p_evening;
  insert into public.results (evening_id, user_id, place)
  select p_evening, t.u, t.ord::int
    from unnest(p_players) with ordinality as t(u, ord);
end;
$$;

revoke execute on function public.claim_item(bigint), public.release_item(bigint),
  public.set_results(bigint, uuid[]) from public, anon;
grant execute on function public.claim_item(bigint), public.release_item(bigint),
  public.set_results(bigint, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Rechte + Row Level Security
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.profiles     enable row level security;
alter table public.evenings     enable row level security;
alter table public.attendance   enable row level security;
alter table public.food_options enable row level security;
alter table public.food_votes   enable row level security;
alter table public.bring_items  enable row level security;
alter table public.results      enable row level security;

-- profiles: Freigeschaltete sehen alle, Nicht-Freigeschaltete nur sich selbst
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_approved() or id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- evenings: lesen alle Freigeschalteten, schreiben nur Admin
create policy evenings_select on public.evenings for select to authenticated
  using (public.is_approved());
create policy evenings_admin on public.evenings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- attendance: eigene Zusage, solange Abend offen
create policy attendance_select on public.attendance for select to authenticated
  using (public.is_approved());
create policy attendance_write on public.attendance for all to authenticated
  using (public.is_admin()
         or (user_id = auth.uid() and public.is_approved() and public.evening_open(evening_id)))
  with check (public.is_admin()
         or (user_id = auth.uid() and public.is_approved() and public.evening_open(evening_id)));

-- food_options: nur Admin pflegt die Auswahl
create policy food_options_select on public.food_options for select to authenticated
  using (public.is_approved());
create policy food_options_admin on public.food_options for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- food_votes: eigene Stimme, solange Abend offen
create policy food_votes_select on public.food_votes for select to authenticated
  using (public.is_approved());
create policy food_votes_write on public.food_votes for all to authenticated
  using (public.is_admin()
         or (user_id = auth.uid() and public.is_approved() and public.evening_open(evening_id)))
  with check (public.is_admin()
         or (user_id = auth.uid() and public.is_approved() and public.evening_open(evening_id)));

-- bring_items: Admin pflegt; Übernehmen/Abgeben nur über claim_item/release_item
create policy bring_items_select on public.bring_items for select to authenticated
  using (public.is_approved());
create policy bring_items_admin on public.bring_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- results: lesen alle, schreiben nur Admin
create policy results_select on public.results for select to authenticated
  using (public.is_approved());
create policy results_admin on public.results for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
