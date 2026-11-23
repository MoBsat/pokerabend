import { sb, baseUrl } from '../supabase.js';
import { h, run, toast, suit, formData } from '../ui.js';
import { state, render, loadProfile } from '../app.js';

export function authView() {
  let mode = 'login';
  const wrap = h('div', { class: 'auth' });

  const field = (label, attrs) => h('label', { class: 'field' }, h('span', {}, label), h('input', attrs));

  function forms() {
    if (mode === 'login') {
      return h('form', { onsubmit: async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        await run(async () => {
          const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
          if (error) throw error;
        }, { btn: e.submitter });
      } },
        field('E-Mail', { name: 'email', type: 'email', required: true, autocomplete: 'email' }),
        field('Passwort', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' }),
        h('button', { class: 'btn primary block', type: 'submit' }, 'Anmelden'),
        h('button', { class: 'btn link', type: 'button', onclick: () => { mode = 'forgot'; draw(); } }, 'Passwort vergessen?'));
    }
    if (mode === 'register') {
      return h('form', { onsubmit: async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        if (f.password !== f.password2) return toast('Die Passwörter stimmen nicht überein.', 'error');
        await run(async () => {
          const { data, error } = await sb.auth.signUp({
            email: f.email.trim(),
            password: f.password,
            options: { data: { display_name: f.name.trim() }, emailRedirectTo: baseUrl() },
          });
          if (error) throw error;
          if (!data.session) {
            mode = 'done';
            draw();
          }
        }, { btn: e.submitter });
      } },
        field('Anzeigename', { name: 'name', required: true, minlength: 2, maxlength: 30, autocomplete: 'nickname' }),
        field('E-Mail', { name: 'email', type: 'email', required: true, autocomplete: 'email' }),
        field('Passwort (mind. 8 Zeichen)', { name: 'password', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }),
        field('Passwort wiederholen', { name: 'password2', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }),
        h('button', { class: 'btn primary block', type: 'submit' }, 'Registrieren'));
    }
    if (mode === 'forgot') {
      return h('form', { onsubmit: async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        await run(async () => {
          const { error } = await sb.auth.resetPasswordForEmail(f.email.trim(), { redirectTo: baseUrl() });
          if (error) throw error;
        }, { btn: e.submitter, ok: 'Falls die Adresse registriert ist, kommt gleich eine Mail mit Link.' });
      } },
        h('p', { class: 'muted' }, 'Du bekommst eine Mail mit einem Link, über den du ein neues Passwort setzen kannst.'),
        field('E-Mail', { name: 'email', type: 'email', required: true, autocomplete: 'email' }),
        h('button', { class: 'btn primary block', type: 'submit' }, 'Link senden'),
        h('button', { class: 'btn link', type: 'button', onclick: () => { mode = 'login'; draw(); } }, 'Zurück zur Anmeldung'));
    }
    return h('div', { class: 'notice' },
      h('h3', {}, 'Fast geschafft'),
      h('p', {}, 'Wir haben dir eine Mail geschickt. Klick auf den Link darin, um deine Adresse zu bestätigen. Danach muss der Admin deinen Account noch freischalten.'),
      h('button', { class: 'btn', onclick: () => { mode = 'login'; draw(); } }, 'Zur Anmeldung'));
  }

  function draw() {
    const tab = (m, label) => h('button', {
      class: `tab ${mode === m ? 'active' : ''}`, type: 'button',
      onclick: () => { mode = m; draw(); },
    }, label);
    wrap.replaceChildren(
      h('div', { class: 'auth-logo' }, suit('s'), suit('h'), suit('d'), suit('c')),
      h('h1', { class: 'auth-title' }, 'Pokerabend'),
      h('section', { class: 'card' },
        mode === 'done' ? null : h('div', { class: 'tabs' }, tab('login', 'Anmelden'), tab('register', 'Registrieren')),
        forms()));
  }
  draw();
  return wrap;
}

export function pendingView() {
  return h('div', { class: 'auth' },
    h('div', { class: 'auth-logo' }, suit('s')),
    h('section', { class: 'card' },
      h('h2', {}, `Hallo ${state.profile?.display_name ?? ''}`),
      h('p', {}, 'Dein Account ist angelegt, wartet aber noch auf die Freischaltung durch den Admin. Sag kurz in der Gruppe Bescheid.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: async (e) => {
          await run(loadProfile, { btn: e.currentTarget });
          if (!state.profile?.approved) toast('Noch nicht freigeschaltet.');
          render();
        } }, 'Erneut prüfen'),
        h('button', { class: 'btn', onclick: () => sb.auth.signOut() }, 'Abmelden'))));
}

export function recoveryView() {
  return h('div', { class: 'auth' },
    h('section', { class: 'card' },
      h('h2', {}, 'Neues Passwort setzen'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        if (f.password !== f.password2) return toast('Die Passwörter stimmen nicht überein.', 'error');
        const okay = await run(async () => {
          const { error } = await sb.auth.updateUser({ password: f.password });
          if (error) throw error;
        }, { btn: e.submitter, ok: 'Passwort geändert.' });
        if (okay) { state.recovery = false; render(); }
      } },
        h('label', { class: 'field' }, h('span', {}, 'Neues Passwort'),
          h('input', { name: 'password', type: 'password', minlength: 8, required: true, autocomplete: 'new-password' })),
        h('label', { class: 'field' }, h('span', {}, 'Wiederholen'),
          h('input', { name: 'password2', type: 'password', minlength: 8, required: true, autocomplete: 'new-password' })),
        h('button', { class: 'btn primary block', type: 'submit' }, 'Speichern'))));
}
