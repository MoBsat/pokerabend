import { sb, q } from '../supabase.js';
import { h, run, fmtDateTime, card, formData, suit } from '../ui.js';
import { state, navigate } from '../app.js';
import { STATUS } from '../data.js';

export async function eveningsView() {
  const [evenings, attendance, winners, profiles] = await Promise.all([
    q(sb.from('evenings').select('*').order('starts_at', { ascending: false })),
    q(sb.from('attendance').select('evening_id,user_id,status')),
    q(sb.from('results').select('evening_id,user_id').eq('place', 1)),
    q(sb.from('profiles').select('id,display_name')),
  ]);
  const names = new Map(profiles.map((p) => [p.id, p.display_name]));
  const winnerOf = new Map(winners.map((w) => [w.evening_id, names.get(w.user_id)]));
  const me = state.profile;

  const upcoming = evenings.filter((e) => !e.closed).reverse();
  const past = evenings.filter((e) => e.closed);

  const item = (ev) => {
    const att = attendance.filter((a) => a.evening_id === ev.id);
    const mine = att.find((a) => a.user_id === me.id)?.status;
    const yes = att.filter((a) => a.status === 'ja').length;
    return h('a', { class: 'evening-item', href: `#/abend/${ev.id}` },
      h('div', { class: 'evening-date' }, fmtDateTime(ev.starts_at)),
      h('div', { class: 'evening-meta' },
        ev.location ? h('span', {}, ev.location) : null,
        ev.closed
          ? (winnerOf.has(ev.id) ? h('span', { class: 'winner' }, suit('s'), ' ', winnerOf.get(ev.id)) : null)
          : h('span', {}, `${yes} dabei`)),
      !ev.closed ? h('span', { class: `badge ${mine ? STATUS[mine].cls : 'open'}` }, mine ? STATUS[mine].label : 'Noch nicht abgestimmt') : null);
  };

  return h('div', {},
    me.is_admin ? newEveningForm() : null,
    card(
      h('h2', {}, 'Anstehende Abende'),
      upcoming.length ? h('div', { class: 'list' }, upcoming.map(item))
        : h('p', { class: 'muted' }, 'Aktuell ist kein Abend geplant.')),
    past.length ? card(h('h2', {}, 'Vergangene Abende'), h('div', { class: 'list' }, past.map(item))) : null);
}

function newEveningForm() {
  const details = h('details', { class: 'card admin-box' },
    h('summary', {}, '+ Neuen Abend anlegen'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      let id;
      const ok = await run(async () => {
        const row = await q(sb.from('evenings').insert({
          starts_at: new Date(f.starts_at).toISOString(),
          location: f.location.trim() || null,
          notes: f.notes.trim() || null,
        }).select('id').single());
        id = row.id;
      }, { btn: e.submitter, ok: 'Abend angelegt.' });
      if (ok) navigate(`#/abend/${id}`);
    } },
      h('label', { class: 'field' }, h('span', {}, 'Datum und Uhrzeit'),
        h('input', { name: 'starts_at', type: 'datetime-local', required: true })),
      h('label', { class: 'field' }, h('span', {}, 'Ort'),
        h('input', { name: 'location', maxlength: 100, placeholder: 'z. B. bei Mo' })),
      h('label', { class: 'field' }, h('span', {}, 'Notiz (optional)'),
        h('textarea', { name: 'notes', maxlength: 1000, rows: 2 })),
      h('button', { class: 'btn primary', type: 'submit' }, 'Anlegen')));
  return details;
}
