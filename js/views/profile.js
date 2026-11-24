import { sb } from '../supabase.js';
import { h, run, card, toast, formData } from '../ui.js';
import { state, render, loadProfile } from '../app.js';
import { avatar, uploadAvatar, removeAvatar, pickImage } from '../avatar.js';

export function profileView() {
  return h('div', {},
    state.player ? card(
      h('div', { class: 'profile-pic' },
        avatar(state.player, 'xl'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: (e) => {
            const btn = e.currentTarget;
            pickImage(async (file) => {
              if (await run(async () => { await uploadAvatar(state.player, file); await loadProfile(); },
                { btn, ok: 'Profilbild gespeichert.' })) render();
            });
          } }, state.player.avatar_path ? 'Bild ändern' : 'Profilbild hochladen'),
          state.player.avatar_path ? h('button', { class: 'btn', onclick: async (e) => {
            if (!confirm('Profilbild entfernen?')) return;
            if (await run(async () => { await removeAvatar(state.player); await loadProfile(); },
              { btn: e.currentTarget, ok: 'Profilbild entfernt.' })) render();
          } }, 'Entfernen') : null),
        h('p', { class: 'hint' }, 'Das Bild wird quadratisch zugeschnitten und verkleinert. Standortdaten aus Handyfotos werden dabei entfernt.'))) : null,
    card(
      h('h1', {}, 'Profil'),
      h('p', {}, h('span', { class: 'muted' }, 'Spieler: '), h('strong', {}, state.player?.name ?? 'noch nicht zugeordnet')),
      h('p', {}, h('span', { class: 'muted' }, 'E-Mail: '), state.session.user.email),
      h('p', { class: 'hint' }, 'Den Spielernamen ändert der Admin.'),
      state.player ? h('a', { class: 'btn', href: `#/spieler/${state.player.id}` }, 'Meine Spielerseite') : null),
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
