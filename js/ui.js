// Kleiner DOM-Builder. Texte werden immer als Text eingefügt (kein innerHTML) -> kein XSS über Namen o. ä.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'selected') el[k] = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  if (value !== undefined) el.value = value;
  return el;
}

export function toast(msg, type = 'info') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3500);
  setTimeout(() => t.remove(), 4000);
}

const ERRORS = [
  [/invalid login credentials/i, 'E-Mail oder Passwort ist falsch.'],
  [/email not confirmed/i, 'Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Mail).'],
  [/user already registered/i, 'Diese E-Mail ist bereits registriert.'],
  [/password should be at least/i, 'Das Passwort ist zu kurz (mindestens 8 Zeichen).'],
  [/rate limit|too many requests|security purposes/i, 'Zu viele Versuche. Bitte warte kurz und versuch es erneut.'],
  [/same.*password|different from the old/i, 'Das neue Passwort muss sich vom alten unterscheiden.'],
  [/bring_claims_fixed_unique|duplicate key/i, 'Das hat schon jemand anderes übernommen.'],
  [/row-level security|permission denied/i, 'Nicht möglich: Die Abstimmung ist geschlossen oder dir fehlt die Berechtigung.'],
  [/failed to fetch|networkerror/i, 'Keine Verbindung zum Server.'],
  [/display_name_check/i, 'Der Name muss 2 bis 30 Zeichen lang sein.'],
];

export function errMsg(e) {
  const m = e?.message || String(e);
  for (const [re, txt] of ERRORS) if (re.test(m)) return txt;
  return m;
}

// Führt eine Aktion aus, zeigt Fehler als Toast, deaktiviert den Button währenddessen
export async function run(fn, { ok, btn } = {}) {
  if (btn) btn.disabled = true;
  try {
    await fn();
    if (ok) toast(ok, 'success');
    return true;
  } catch (e) {
    console.error(e);
    toast(errMsg(e), 'error');
    return false;
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
}

const dtf = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const df = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtDateTime = (iso) => dtf.format(new Date(iso)) + ' Uhr';
export const fmtDate = (iso) => df.format(new Date(iso));
const tf = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
export const fmtTime = (iso) => tf.format(new Date(iso)) + ' Uhr';

// ISO -> Wert für <input type="datetime-local"> in lokaler Zeit
export function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const card = (...children) => h('section', { class: 'card' }, ...children);
export const suit = (s) => h('span', { class: `suit suit-${s}`, 'aria-hidden': 'true' },
  { s: '♠', h: '♥', d: '♦', c: '♣' }[s]);

export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}
