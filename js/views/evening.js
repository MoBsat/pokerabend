import { sb, q } from '../supabase.js';
import { h, run, fmtDateTime, toLocalInput, card, formData, suit } from '../ui.js';
import { state, render, navigate } from '../app.js';
import { STATUS, foodBuyers } from '../data.js';

export async function eveningView(id) {
  if (!Number.isInteger(id)) return notFound();
  const [ev, attendance, options, votes, items, results, profiles] = await Promise.all([
    q(sb.from('evenings').select('*').eq('id', id).maybeSingle()),
    q(sb.from('attendance').select('*').eq('evening_id', id)),
    q(sb.from('food_options').select('*').eq('evening_id', id).order('id')),
    q(sb.from('food_votes').select('*').eq('evening_id', id)),
    q(sb.from('bring_items').select('*').eq('evening_id', id).order('id')),
    q(sb.from('results').select('*').eq('evening_id', id).order('place')),
    q(sb.from('profiles').select('id,display_name,approved').order('display_name')),
  ]);
  if (!ev) return notFound();

  const ctx = {
    ev, attendance, options, votes, items, results,
    players: profiles.filter((p) => p.approved),
    name: (uid) => profiles.find((p) => p.id === uid)?.display_name ?? 'Unbekannt',
    me: state.profile,
    admin: state.profile.is_admin,
    open: !ev.closed,
  };

  return h('div', { class: 'evening' },
    h('a', { class: 'back', href: '#/' }, '← Alle Abende'),
    headSection(ctx),
    results.length ? resultSection(ctx) : null,
    attendanceSection(ctx),
    foodSection(ctx),
    bringSection(ctx),
    !results.length ? resultSection(ctx) : null);
}

const notFound = () => card(h('h2', {}, 'Abend nicht gefunden'), h('a', { href: '#/' }, 'Zur Übersicht'));

// ---------------------------------------------------------------- Kopf
function headSection({ ev, admin, open }) {
  const edit = h('details', { class: 'admin-box inline' },
    h('summary', {}, 'Bearbeiten'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      if (await run(() => q(sb.from('evenings').update({
        starts_at: new Date(f.starts_at).toISOString(),
        location: f.location.trim() || null,
        notes: f.notes.trim() || null,
      }).eq('id', ev.id)), { btn: e.submitter, ok: 'Gespeichert.' })) render();
    } },
      h('label', { class: 'field' }, h('span', {}, 'Datum und Uhrzeit'),
        h('input', { name: 'starts_at', type: 'datetime-local', required: true, value: toLocalInput(ev.starts_at) })),
      h('label', { class: 'field' }, h('span', {}, 'Ort'),
        h('input', { name: 'location', maxlength: 100, value: ev.location ?? '' })),
      h('label', { class: 'field' }, h('span', {}, 'Notiz'),
        h('textarea', { name: 'notes', maxlength: 1000, rows: 2, value: ev.notes ?? '' })),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Speichern'),
        h('button', { class: 'btn danger', type: 'button', onclick: async (e) => {
          if (!confirm('Abend inklusive Abstimmungen und Ergebnis wirklich löschen?')) return;
          if (await run(() => q(sb.from('evenings').delete().eq('id', ev.id)), { btn: e.currentTarget, ok: 'Abend gelöscht.' })) navigate('#/');
        } }, 'Abend löschen'))));

  return card(
    h('div', { class: 'head' },
      h('div', {},
        h('h1', {}, fmtDateTime(ev.starts_at)),
        ev.location ? h('p', { class: 'location' }, ev.location) : null),
      h('span', { class: `badge ${open ? 'yes' : 'closed'}` }, open ? 'Offen' : 'Abgeschlossen')),
    ev.notes ? h('p', { class: 'notes' }, ev.notes) : null,
    admin ? h('div', { class: 'admin-actions' },
      h('button', { class: 'btn small', onclick: async (e) => {
        if (open && !confirm('Abend abschließen? Danach sind keine Abstimmungen mehr möglich.')) return;
        if (await run(() => q(sb.from('evenings').update({ closed: open }).eq('id', ev.id)), { btn: e.currentTarget })) render();
      } }, open ? 'Abend abschließen' : 'Wieder öffnen'),
      edit) : null);
}

// ---------------------------------------------------------------- Teilnahme
function attendanceSection({ ev, attendance, players, name, me, open }) {
  const mine = attendance.find((a) => a.user_id === me.id)?.status;
  const set = (status) => async (e) => {
    if (await run(() => q(sb.from('attendance').upsert({
      evening_id: ev.id, user_id: me.id, status, updated_at: new Date().toISOString(),
    })), { btn: e.currentTarget })) render();
  };

  const group = (status) => attendance.filter((a) => a.status === status).map((a) => name(a.user_id)).sort();
  const answered = new Set(attendance.map((a) => a.user_id));
  const missing = players.filter((p) => !answered.has(p.id)).map((p) => p.display_name);

  const col = (title, cls, list) => h('div', { class: `att-col ${cls}` },
    h('h4', {}, `${title} (${list.length})`),
    list.length ? h('ul', {}, list.map((n) => h('li', {}, n))) : h('p', { class: 'muted' }, '–'));

  return card(
    h('h2', {}, suit('s'), ' Wer ist dabei?'),
    open ? h('div', { class: 'choice' },
      Object.entries(STATUS).map(([key, s]) =>
        h('button', { class: `btn choice-btn ${s.cls} ${mine === key ? 'selected' : ''}`, onclick: set(key) }, s.label)))
      : null,
    h('div', { class: 'att-grid' },
      col('Dabei', 'yes', group('ja')),
      col('Vielleicht', 'maybe', group('vielleicht')),
      col('Abgesagt', 'no', group('nein')),
      open ? col('Keine Antwort', 'none', missing) : null));
}

// ---------------------------------------------------------------- Essen
function foodSection({ ev, options, votes, results, name, me, admin, open }) {
  const myVote = votes.find((v) => v.user_id === me.id)?.option_id;
  const buyers = results.length ? foodBuyers(results) : [];
  const max = Math.max(1, ...options.map((o) => votes.filter((v) => v.option_id === o.id).length));

  const vote = (opt) => async (e) => {
    const btn = e.currentTarget;
    const action = myVote === opt.id
      ? () => q(sb.from('food_votes').delete().eq('evening_id', ev.id).eq('user_id', me.id))
      : () => q(sb.from('food_votes').upsert({ evening_id: ev.id, user_id: me.id, option_id: opt.id }));
    if (await run(action, { btn })) render();
  };

  const rows = [...options]
    .map((o) => ({ ...o, voters: votes.filter((v) => v.option_id === o.id).map((v) => name(v.user_id)) }))
    .sort((a, b) => b.voters.length - a.voters.length || a.id - b.id)
    .map((o) => {
      const bar = h('div', { class: 'bar-fill' });
      bar.style.width = `${(o.voters.length / max) * 100}%`;
      return h('div', { class: `vote-row ${myVote === o.id ? 'mine' : ''}` },
        h('button', { class: 'vote-btn', disabled: !open, onclick: vote(o),
          title: myVote === o.id ? 'Stimme zurücknehmen' : 'Dafür stimmen' },
          h('div', { class: 'bar' }, bar),
          h('span', { class: 'vote-label' }, myVote === o.id ? '✓ ' : '', o.label),
          h('span', { class: 'vote-count' }, o.voters.length)),
        o.voters.length ? h('div', { class: 'voters' }, o.voters.join(', ')) : null,
        admin ? h('button', { class: 'icon-btn', title: 'Option löschen', onclick: async (e) => {
          if (o.voters.length && !confirm(`"${o.label}" hat Stimmen. Trotzdem löschen?`)) return;
          if (await run(() => q(sb.from('food_options').delete().eq('id', o.id)), { btn: e.currentTarget })) render();
        } }, '✕') : null);
    });

  return card(
    h('h2', {}, suit('h'), ' Was essen wir?'),
    buyers.length ? h('div', { class: 'buyers' },
      h('strong', {}, 'Essen kaufen: '), buyers.map(name).join(', ')) : null,
    options.length ? h('div', { class: 'votes' }, rows)
      : h('p', { class: 'muted' }, admin ? 'Noch keine Optionen. Leg unten welche an.' : 'Der Admin hat noch keine Optionen angelegt.'),
    open && options.length ? h('p', { class: 'hint' }, 'Eine Stimme pro Person. Antippen zum Abstimmen, nochmal antippen zum Zurücknehmen.') : null,
    admin ? addForm('Neue Essensoption, z. B. Pizza', (label) => q(sb.from('food_options').insert({ evening_id: ev.id, label }))) : null);
}

// ---------------------------------------------------------------- Mitbringen
function bringSection({ ev, items, name, me, admin, open }) {
  const rows = items.map((it) => {
    const mine = it.claimed_by === me.id;
    const free = !it.claimed_by;
    const actions = [];
    if (open && free) {
      actions.push(h('button', { class: 'btn small primary', onclick: async (e) => {
        if (await run(() => q(sb.rpc('claim_item', { p_item: it.id })), { btn: e.currentTarget })) render();
      } }, 'Bringe ich mit'));
    }
    if (!free && ((open && mine) || admin)) {
      actions.push(h('button', { class: 'btn small', onclick: async (e) => {
        if (await run(() => q(sb.rpc('release_item', { p_item: it.id })), { btn: e.currentTarget })) render();
      } }, mine ? 'Doch nicht' : 'Freigeben'));
    }
    if (admin) {
      actions.push(h('button', { class: 'icon-btn', title: 'Position löschen', onclick: async (e) => {
        if (!free && !confirm(`"${it.label}" ist schon vergeben. Trotzdem löschen?`)) return;
        if (await run(() => q(sb.from('bring_items').delete().eq('id', it.id)), { btn: e.currentTarget })) render();
      } }, '✕'));
    }
    return h('div', { class: `bring-row ${free ? 'free' : 'taken'} ${mine ? 'mine' : ''}` },
      h('span', { class: 'bring-label' }, it.label),
      h('span', { class: 'bring-who' }, free ? 'frei' : name(it.claimed_by)),
      h('span', { class: 'bring-actions' }, actions));
  });

  const freeCount = items.filter((i) => !i.claimed_by).length;
  return card(
    h('h2', {}, suit('d'), ' Wer bringt was mit?'),
    items.length ? h('p', { class: 'muted' }, `${items.length - freeCount} von ${items.length} vergeben`) : null,
    items.length ? h('div', { class: 'bring' }, rows)
      : h('p', { class: 'muted' }, admin ? 'Noch nichts angelegt. Leg unten Positionen an.' : 'Der Admin hat noch keine Positionen angelegt.'),
    admin ? addForm('Neue Position, z. B. Cola', (label) => q(sb.from('bring_items').insert({ evening_id: ev.id, label }))) : null);
}

function addForm(placeholder, insert) {
  return h('form', { class: 'add-form', onsubmit: async (e) => {
    e.preventDefault();
    const input = e.target.elements.label;
    const label = input.value.trim();
    if (!label) return;
    if (await run(() => insert(label), { btn: e.submitter })) render();
  } },
    h('input', { name: 'label', placeholder, maxlength: 60, required: true }),
    h('button', { class: 'btn primary', type: 'submit' }, 'Hinzufügen'));
}

// ---------------------------------------------------------------- Ergebnis
function resultSection(ctx) {
  const { results, name, admin } = ctx;
  const buyers = new Set(foodBuyers(results));
  const wrap = card(h('h2', {}, suit('c'), ' Ergebnis'));

  if (results.length) {
    wrap.append(h('ol', { class: 'ranking' }, results.map((r) =>
      h('li', { class: `rank-${Math.min(r.place, 4)} ${buyers.has(r.user_id) ? 'buyer' : ''}` },
        h('span', { class: 'place' }, r.place),
        h('span', { class: 'rank-name' }, name(r.user_id)),
        r.place === 1 ? h('span', { class: 'badge gold' }, 'Sieger') : null,
        buyers.has(r.user_id) ? h('span', { class: 'badge buyer' }, 'kauft Essen') : null))));
  } else {
    wrap.append(h('p', { class: 'muted' }, 'Noch kein Ergebnis eingetragen.'));
  }
  if (admin) wrap.append(resultEditor(ctx));
  return wrap;
}

function resultEditor({ ev, results, attendance, players, name }) {
  let order = results.length
    ? results.map((r) => r.user_id)
    : attendance.filter((a) => a.status === 'ja').map((a) => a.user_id);
  const list = h('ol', { class: 'editor-list' });
  const addSelect = h('select', {});
  const box = h('details', { class: 'admin-box', open: !results.length && order.length > 0 },
    h('summary', {}, results.length ? 'Ergebnis bearbeiten' : 'Ergebnis eintragen'),
    h('p', { class: 'hint' }, 'Reihenfolge = Endplatzierung. Platz 1 steht oben. Mit den Pfeilen sortieren.'),
    list,
    h('div', { class: 'add-form' }, addSelect,
      h('button', { class: 'btn', type: 'button', onclick: () => {
        if (addSelect.value) { order.push(addSelect.value); draw(); }
      } }, 'Spieler hinzufügen')),
    h('button', { class: 'btn primary block', onclick: async (e) => {
      if (order.length < 2) return alert('Mindestens 2 Spieler eintragen.');
      if (await run(() => q(sb.rpc('set_results', { p_evening: ev.id, p_players: order })),
        { btn: e.currentTarget, ok: 'Ergebnis gespeichert.' })) render();
    } }, 'Ergebnis speichern'));

  const move = (i, d) => { const j = i + d; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; draw(); };

  function draw() {
    list.replaceChildren(...order.map((uid, i) => h('li', {},
      h('span', { class: 'place' }, i + 1),
      h('span', { class: 'rank-name' }, name(uid)),
      h('span', { class: 'editor-btns' },
        h('button', { class: 'icon-btn', type: 'button', disabled: i === 0, title: 'Hoch', onclick: () => move(i, -1) }, '▲'),
        h('button', { class: 'icon-btn', type: 'button', disabled: i === order.length - 1, title: 'Runter', onclick: () => move(i, 1) }, '▼'),
        h('button', { class: 'icon-btn', type: 'button', title: 'Entfernen', onclick: () => { order.splice(i, 1); draw(); } }, '✕')))));
    const rest = players.filter((p) => !order.includes(p.id));
    addSelect.replaceChildren(
      h('option', { value: '' }, rest.length ? 'Spieler auswählen …' : 'Alle Spieler eingetragen'),
      ...rest.map((p) => h('option', { value: p.id }, p.display_name)));
  }
  draw();
  return box;
}
