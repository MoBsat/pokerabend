import { sb, q } from '../supabase.js';
import { h, run, card, toast, formData } from '../ui.js';
import { state, render, loadProfile } from '../app.js';

export function profileView() {
  const p = state.profile;
  return h('div', {},
    card(
      h('h1', {}, 'Profil'),
      h('p', { class: 'muted' }, state.session.user.email),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        const name = formData(e.target).name.trim();
        if (await run(async () => {
          await q(sb.from('profiles').update({ display_name: name }).eq('id', p.id));
          await loadProfile();
        }, { btn: e.submitter, ok: 'Name gespeichert.' })) render();
      } },
        h('label', { class: 'field' }, h('span', {}, 'Anzeigename'),
          h('input', { name: 'name', value: p.display_name, minlength: 2, maxlength: 30, required: true })),
        h('button', { class: 'btn primary', type: 'submit' }, 'Speichern'))),
    card(
      h('h2', {}, 'Passwort ändern'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        if (f.password !== f.password2) return toast('Die Passwörter stimmen nicht überein.', 'error');
        if (await run(async () => {
          const { error } = await sb.auth.updateUser({ password: f.password });
          if (error) throw error;
        }, { btn: e.submitter, ok: 'Passwort geändert.' })) e.target.reset();
      } },
        h('label', { class: 'field' }, h('span', {}, 'Neues Passwort'),
          h('input', { name: 'password', type: 'password', minlength: 8, required: true, autocomplete: 'new-password' })),
        h('label', { class: 'field' }, h('span', {}, 'Wiederholen'),
          h('input', { name: 'password2', type: 'password', minlength: 8, required: true, autocomplete: 'new-password' })),
        h('button', { class: 'btn primary', type: 'submit' }, 'Passwort ändern'))),
    card(h('button', { class: 'btn danger block', onclick: () => sb.auth.signOut() }, 'Abmelden')));
}
