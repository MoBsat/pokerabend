import { sb, q } from './supabase.js';
import { h, toast, errMsg, suit } from './ui.js';
import { APP_NAME } from './config.js';
import { authView, pendingView, recoveryView } from './views/auth.js';
import { eveningsView } from './views/evenings.js';
import { eveningView } from './views/evening.js';
import { statsView } from './views/stats.js';
import { adminView } from './views/admin.js';
import { profileView } from './views/profile.js';
import { boardView } from './views/board.js';
import { rulesView } from './views/rules.js';
import { playerView } from './views/player.js';
import { avatar } from './avatar.js';
import { loadMeta } from './badges.js';

export const state = { session: null, profile: null, player: null, recovery: false, cleanup: null };

const app = document.getElementById('app');
const headerSlot = h('div');
const main = h('main', { class: 'container' });
app.replaceChildren(headerSlot, main);

// Hinweise aus Bestätigungs-/Reset-Links (Fehler, abgelaufene Links)
const params = new URLSearchParams(location.search);
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const linkError = params.get('error_description') || hashParams.get('error_description');
const hadCode = params.has('code');
if (params.toString() || hashParams.has('error')) {
  history.replaceState(null, '', location.pathname + (hashParams.has('error') ? '' : location.hash));
}

export async function loadProfile() {
  state.profile = state.session
    ? await q(sb.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle())
    : null;
  state.player = state.profile?.approved
    ? await q(sb.from('players').select('*').eq('user_id', state.session.user.id).maybeSingle())
    : null;
}

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function header() {
  if (!state.session || !state.profile?.approved || state.recovery) {
    return h('header', { class: 'topbar' }, h('div', { class: 'brand' }, suit('s'), ' ', APP_NAME));
  }
  const route = location.hash.replace(/^#\/?/, '').split('/')[0];
  const link = (r, ...label) => h('a', { href: `#/${r}`, class: route === r ? 'active' : null }, ...label);
  const me = h('a', { href: '#/profil', class: `nav-me ${route === 'profil' ? 'active' : ''}`, title: 'Profil', 'aria-label': 'Profil' },
    state.player ? avatar(state.player, 'sm') : h('span', { class: 'avatar sm initial' }, '?'));
  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar-row' }, h('a', { class: 'brand', href: '#/' }, suit('s'), ' ', APP_NAME), me),
    h('nav', {},
      link('', 'Abende'),
      link('pinnwand', 'Pinnwand'),
      link('statistik', 'Statistik'),
      link('regeln', 'Regeln'),
      state.profile.is_admin ? link('admin', 'Admin') : null,
    ));
}

let renderToken = 0;
export async function render() {
  const token = ++renderToken;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

  let view;
  if (state.recovery) view = recoveryView;
  else if (!state.session) view = authView;
  else if (!state.profile?.approved) view = pendingView;
  else {
    switch (parts[0]) {
      case undefined: view = eveningsView; break;
      case 'abend': view = () => eveningView(Number(parts[1])); break;
      case 'statistik': view = statsView; break;
      case 'admin': view = state.profile.is_admin ? adminView : eveningsView; break;
      case 'profil': view = profileView; break;
      case 'pinnwand': view = () => boardView(parts[1] === 'chat' ? 'chat' : 'board'); break;
      case 'regeln': view = rulesView; break;
      case 'spieler': view = () => playerView(Number(parts[1])); break;
      default: view = eveningsView;
    }
  }

  // Aufräumen der vorherigen Ansicht (z. B. Chat-Aktualisierung)
  if (state.cleanup) { try { state.cleanup(); } catch { /* egal */ } state.cleanup = null; }

  headerSlot.replaceChildren(header());
  if (!main.firstChild) main.append(h('div', { class: 'loading' }, 'Lade …'));
  main.setAttribute('aria-busy', 'true');
  try {
    if (state.profile?.approved && !state.recovery) {
      try { await loadMeta(); } catch (e) { console.error(e); }
      if (token !== renderToken) return;
      headerSlot.replaceChildren(header());
    }
    const content = await view(parts);
    if (token !== renderToken) return;
    main.replaceChildren(content);
  } catch (e) {
    console.error(e);
    if (token !== renderToken) return;
    main.replaceChildren(h('section', { class: 'card error' }, h('h2', {}, 'Fehler'), h('p', {}, errMsg(e))));
  } finally {
    if (token === renderToken) main.removeAttribute('aria-busy');
  }
}

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

// Beim Zurückkehren zur App (z. B. Handy entsperrt) aktuelle Daten laden
let lastShown = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastShown > 30000 && state.session) render();
  if (document.visibilityState === 'hidden') lastShown = Date.now();
});

let initialized = false;
sb.auth.onAuthStateChange((event, session) => {
  state.session = session;
  if (event === 'PASSWORD_RECOVERY') state.recovery = true;
  if (event === 'SIGNED_OUT') { state.recovery = false; state.profile = null; state.player = null; }
  if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
  // Supabase empfiehlt, im Callback keine weiteren Supabase-Aufrufe direkt zu awaiten
  setTimeout(async () => {
    try { await loadProfile(); } catch (e) { console.error(e); toast(errMsg(e), 'error'); }
    if (!initialized) {
      initialized = true;
      if (linkError) toast(linkError.replace(/\+/g, ' '), 'error');
      else if (hadCode && !session) toast('E-Mail bestätigt. Bitte melde dich jetzt an.', 'success');
    }
    render();
  }, 0);
});
