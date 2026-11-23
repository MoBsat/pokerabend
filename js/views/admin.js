import { sb, q } from '../supabase.js';
import { h, run, card, fmtDate } from '../ui.js';
import { state, render, loadProfile } from '../app.js';
import { avatar, uploadAvatar, removeAvatar, pickImage } from '../avatar.js';

export async function adminView() {
  const [profiles, players] = await Promise.all([
    q(sb.from('profiles').select('*').order('created_at')),
    q(sb.from('players').select('*').order('name')),
  ]);
  const pending = profiles.filter((p) => !p.approved);
  const active = profiles.filter((p) => p.approved).sort((a, b) => a.display_name.localeCompare(b.display_name, 'de'));
  const playerOf = (uid) => players.find((p) => p.user_id === uid);
  const profileOf = (uid) => profiles.find((p) => p.id === uid);
  const free = players.filter((p) => !p.user_id);
  const reload = (ok) => { if (ok) render(); };

  const assignSelect = (p) => h('select', { class: 'assign' },
    [...(playerOf(p.id) ? [playerOf(p.id)] : []), ...free].map((pl) => h('option', { value: String(pl.id), selected: pl.user_id === p.id || pl.name.toLowerCase() === p.display_name.toLowerCase() }, `Spieler: ${pl.name}`)),
    h('option', { value: 'new' }, `Neuer Spieler „${p.display_name}“`));

  const approveRow = (p) => {
    const sel = assignSelect(p);
    return h('div', { class: 'user-row' },
      h('div', {}, h('strong', {}, p.display_name), h('div', { class: 'muted small' }, `registriert am ${fmtDate(p.created_at)}`)),
      h('div', { class: 'row' }, sel,
        h('button', { class: 'btn small primary', onclick: async (e) => {
          const isNew = sel.value === 'new';
          reload(await run(() => q(sb.rpc('approve_user', {
            p_user: p.id, p_player: isNew ? null : Number(sel.value), p_new_name: isNew ? p.display_name : null,
          })), { btn: e.currentTarget, ok: `${p.display_name} freigeschaltet.` }));
        } }, 'Freischalten')));
  };

  const updateProfile = (p, patch, ok) => async (e) =>
    reload(await run(() => q(sb.from('profiles').update(patch).eq('id', p.id)), { btn: e.currentTarget, ok }));

  return h('div', {},
    card(
      h('h1', {}, 'Admin'),
      h('h2', {}, `Warten auf Freischaltung (${pending.length})`),
      pending.length ? h('div', { class: 'list' }, pending.map(approveRow)) : h('p', { class: 'muted' }, 'Keine offenen Anfragen.'),
      h('p', { class: 'hint' }, 'Beim Freischalten ordnest du den Account einem Spieler zu, damit seine bisherigen Ergebnisse mitzählen. Unbekannte Accounts nicht freischalten; löschen kannst du sie im Supabase-Dashboard unter Authentication > Users.')),

    card(
      h('h2', {}, `Spieler (${players.length})`),
      h('div', { class: 'list' }, players.map((pl) => h('div', { class: 'user-row' },
        h('div', { class: 'who' }, avatar(pl, 'md'), h('div', {}, h('strong', {}, pl.name),
          h('div', { class: 'muted small' }, pl.user_id ? `Account: ${profileOf(pl.user_id)?.display_name ?? '?'}` : 'kein Account'))),
        h('span', { class: 'row' },
        h('button', { class: 'btn small', onclick: (e) => {
          const btn = e.currentTarget;
          pickImage(async (file) => {
            const ok = await run(async () => {
              await uploadAvatar(pl, file);
              if (pl.user_id === state.session.user.id) await loadProfile();
            }, { btn, ok: `Bild für ${pl.name} gespeichert.` });
            reload(ok);
          });
        } }, 'Bild'),
        pl.avatar_path ? h('button', { class: 'icon-btn', title: 'Bild entfernen', onclick: async (e) => {
          if (!confirm(`Bild von ${pl.name} entfernen?`)) return;
          reload(await run(async () => {
            await removeAvatar(pl);
            if (pl.user_id === state.session.user.id) await loadProfile();
          }, { btn: e.currentTarget }));
        } }, '\u2715') : null,
        h('button', { class: 'btn small', onclick: async (e) => {
          const name = prompt('Neuer Name:', pl.name)?.trim();
          if (!name || name === pl.name) return;
          const ok = await run(async () => {
            await q(sb.from('players').update({ name }).eq('id', pl.id));
            if (pl.user_id === state.session.user.id) await loadProfile();
          }, { btn: e.currentTarget, ok: 'Umbenannt.' });
          reload(ok);
        } }, 'Umbenennen'))))),
      h('form', { class: 'add-form', onsubmit: async (e) => {
        e.preventDefault();
        const name = e.target.elements.name.value.trim();
        if (!name) return;
        reload(await run(() => q(sb.from('players').insert({ name })), { btn: e.submitter, ok: `${name} angelegt.` }));
      } },
        h('input', { name: 'name', placeholder: 'Neuer Spieler (ohne Account)', maxlength: 30, required: true }),
        h('button', { class: 'btn primary', type: 'submit' }, 'Anlegen'))),

    card(
      h('h2', {}, `Accounts (${active.length})`),
      h('div', { class: 'list' }, active.map((p) => {
        const self = p.id === state.profile.id;
        const pl = playerOf(p.id);
        return h('div', { class: 'user-row' },
          h('div', {},
            h('strong', {}, p.display_name), p.is_admin ? h('span', { class: 'badge gold' }, 'Admin') : null,
            h('div', { class: 'muted small' }, pl ? `Spieler: ${pl.name}` : 'keinem Spieler zugeordnet')),
          self ? h('span', { class: 'muted small' }, 'Du') : h('span', { class: 'row' },
            h('button', { class: 'btn small', onclick: async (e) => {
              const msg = p.is_admin ? `${p.display_name} die Admin-Rechte entziehen?` : `${p.display_name} zum Admin machen?`;
              if (confirm(msg)) await updateProfile(p, { is_admin: !p.is_admin })(e);
            } }, p.is_admin ? 'Admin entziehen' : 'Zum Admin'),
            h('button', { class: 'btn small danger', onclick: async (e) => {
              if (!confirm(`${p.display_name} sperren? Die Statistik bleibt erhalten.`)) return;
              await updateProfile(p, { approved: false, is_admin: false }, 'Gesperrt.')(e);
            } }, 'Sperren')));
      })),
      h('p', { class: 'hint' }, 'Gesperrte Accounts erscheinen wieder unter „Warten auf Freischaltung“.')),
  );
}

