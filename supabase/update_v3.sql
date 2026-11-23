-- =====================================================================
-- Pokerabend – Update auf Version 3 (Profilbilder)
-- Für bestehende Installationen (Version 2): einmal im Supabase SQL-Editor ausführen.
-- Bestehende Daten bleiben vollständig erhalten.
-- =====================================================================

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
