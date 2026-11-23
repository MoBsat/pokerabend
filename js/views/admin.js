import { sb, q } from '../supabase.js';
import { h, run, card, fmtDate } from '../ui.js';
import { state, render } from '../app.js';

export async function adminView() {
  const profiles = await q(sb.from('profiles').select('*').order('created_at'));
  const pending = profiles.filter((p) => !p.approved);
  const active = profiles.filter((p) => p.approved).sort((a, b) => a.display_name.localeCompare(b.display_name, 'de'));

  const update = (p, patch, ok) => async (e) => {
    if (await run(() => q(sb.from('profiles').update(patch).eq('id', p.id)), { btn: e.currentTarget, ok })) render();
  };

  return h('div', {},
    card(
      h('h1', {}, 'Admin'),
      h('h2', {}, `Warten auf Freischaltung (${pending.length})`),
      pending.length ? h('div', { class: 'list' }, pending.map((p) => h('div', { class: 'user-row' },
        h('div', {}, h('strong', {}, p.display_name), h('div', { class: 'muted small' }, `registriert am ${fmtDate(p.created_at)}`)),
        h('button', { class: 'btn small primary', onclick: update(p, { approved: true }, `${p.display_name} freigeschaltet.`) }, 'Freischalten'))))
        : h('p', { class: 'muted' }, 'Keine offenen Anfragen.'),
      h('p', { class: 'hint' }, 'Unbekannte Accounts nicht freischalten. Löschen kannst du sie im Supabase-Dashboard unter Authentication > Users.')),
    card(
      h('h2', {}, `Spieler (${active.length})`),
      h('div', { class: 'list' }, active.map((p) => {
        const self = p.id === state.profile.id;
        return h('div', { class: 'user-row' },
          h('div', {}, h('strong', {}, p.display_name), p.is_admin ? h('span', { class: 'badge gold' }, 'Admin') : null),
          self ? h('span', { class: 'muted small' }, 'Du') : h('span', { class: 'row' },
            h('button', { class: 'btn small', onclick: async (e) => {
              const msg = p.is_admin ? `${p.display_name} die Admin-Rechte entziehen?` : `${p.display_name} zum Admin machen?`;
              if (confirm(msg)) await update(p, { is_admin: !p.is_admin })(e);
            } }, p.is_admin ? 'Admin entziehen' : 'Zum Admin'),
            h('button', { class: 'btn small danger', onclick: async (e) => {
              if (!confirm(`${p.display_name} sperren? Statistiken bleiben erhalten.`)) return;
              await update(p, { approved: false, is_admin: false }, 'Gesperrt.')(e);
            } }, 'Sperren')));
      }))));
}
