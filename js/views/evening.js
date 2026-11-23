import { sb, q } from '../supabase.js';
import { h, run, fmtDateTime, toLocalInput, card, formData, suit } from '../ui.js';
import { state, render, navigate } from '../app.js';
import { STATUS, BRING_ITEMS, isOpen, hasStarted, isFullResult, foodText } from '../data.js';
import { who } from '../avatar.js';

export async function eveningView(id) {
  if (!Number.isInteger(id)) return notFound();
  const [ev, attendance, orders, claims, results, players] = await Promise.all([
    q(sb.from('evenings').select('*').eq('id', id).maybeSingle()),
    q(sb.from('attendance').select('*').eq('evening_id', id)),
    q(sb.from('food_orders').select('*').eq('evening_id', id)),
    q(sb.from('bring_claims').select('*').eq('evening_id', id).order('id')),
    q(sb.from('results').select('*').eq('evening_id', id)),
    q(sb.from('players').select('id,name,user_id,avatar_path').order('name')),
  ]);
  if (!ev) return notFound();

  const ctx = {
    ev, attendance, orders, claims, results, players,
    name: (pid) => players.find((p) => p.id === pid)?.name ?? 'Unbekannt',
    player: (pid) => players.find((p) => p.id === pid),
    myPid: state.player?.id ?? null,
    admin: state.profile.is_admin,
    open: isOpen(ev),
    started: hasStarted(ev),
  };
  ctx.myStatus = attendance.find((a) => a.player_id === ctx.myPid)?.status;

  return h('div', { class: 'evening' },
    h('a', { class: 'back', href: '#/' }, '← Alle Abende'),
    headSection(ctx),
    results.length ? resultSection(ctx) : null,
    attendanceSection(ctx),
    foodSection(ctx),
    bringSection(ctx),
    ctx.admin ? adminFixSection(ctx) : null,
    !results.length ? resultSection(ctx) : null);
}

const notFound = () => card(h('h2', {}, 'Abend nicht gefunden'), h('a', { href: '#/' }, 'Zur Übersicht'));
const reload = (ok) => { if (ok) render(); };
let fixOpen = false; // Admin-Korrektur bleibt nach Änderungen aufgeklappt

// ---------------------------------------------------------------- Kopf
function headSection({ ev, admin, open, myPid }) {
  const edit = h('details', { class: 'admin-box' },
    h('summary', {}, 'Termin bearbeiten'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      reload(await run(() => q(sb.from('evenings').update({
        starts_at: new Date(f.starts_at).toISOString(),
        location: f.location.trim() || 'Bei Vito',
        notes: f.notes.trim() || null,
      }).eq('id', ev.id)), { btn: e.submitter, ok: 'Gespeichert.' }));
    } },
      h('p', { class: 'hint' }, 'Die Abstimmungsfrist liegt automatisch um 10:00 Uhr am Tag des Abends.'),
      h('label', { class: 'field' }, h('span', {}, 'Datum und Uhrzeit'),
        h('input', { name: 'starts_at', type: 'datetime-local', required: true, value: toLocalInput(ev.starts_at) })),
      h('label', { class: 'field' }, h('span', {}, 'Ort'),
        h('input', { name: 'location', maxlength: 100, value: ev.location })),
      h('label', { class: 'field' }, h('span', {}, 'Notiz (z. B. „fällt aus“)'),
        h('textarea', { name: 'notes', maxlength: 1000, rows: 2, value: ev.notes ?? '' })),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Speichern'),
        h('button', { class: 'btn danger', type: 'button', onclick: async (e) => {
          if (!confirm('Diesen Abend inklusive aller Abstimmungen und Ergebnisse löschen?')) return;
          if (await run(() => q(sb.from('evenings').delete().eq('id', ev.id)), { btn: e.currentTarget, ok: 'Abend gelöscht.' })) navigate('#/');
        } }, 'Abend löschen'))));

  return card(
    h('div', { class: 'head' },
      h('div', {},
        h('h1', {}, fmtDateTime(ev.starts_at)),
        h('p', { class: 'location' }, ev.location)),
      h('span', { class: `badge ${open ? 'yes' : 'closed'}` }, open ? 'Abstimmung offen' : 'Abstimmung geschlossen')),
    h('p', { class: open ? 'deadline' : 'deadline closed' },
      open ? `Abstimmen bis ${fmtDateTime(ev.vote_deadline)}` : `Abstimmung endete ${fmtDateTime(ev.vote_deadline)}`),
    ev.notes ? h('p', { class: 'notes' }, ev.notes) : null,
    !myPid ? h('p', { class: 'hint' }, 'Dein Account ist noch keinem Spieler zugeordnet, deshalb kannst du nicht abstimmen.') : null,
    admin ? edit : null);
}

// ---------------------------------------------------------------- Teilnahme
function attendanceSection({ ev, attendance, players, name, player, myPid, myStatus, open }) {
  const set = (status) => async (e) => reload(await run(() => q(sb.from('attendance').upsert({
    evening_id: ev.id, player_id: myPid, status, updated_at: new Date().toISOString(),
  })), { btn: e.currentTarget }));

  const byName = (a, b) => name(a).localeCompare(name(b), 'de');
  const group = (status) => attendance.filter((a) => a.status === status).map((a) => a.player_id).sort(byName);
  const answered = new Set(attendance.map((a) => a.player_id));
  // "Keine Antwort" nur für Spieler mit Account
  const missing = players.filter((p) => p.user_id && !answered.has(p.id)).map((p) => p.id);

  const col = (title, cls, list) => h('div', { class: `att-col ${cls}` },
    h('h4', {}, `${title} (${list.length})`),
    list.length ? h('ul', {}, list.map((pid) => h('li', {}, who(player(pid))))) : h('p', { class: 'muted' }, '–'));

  return card(
    h('h2', {}, suit('s'), ' Wer ist dabei?'),
    open && myPid ? h('div', { class: 'choice' },
      Object.entries(STATUS).map(([key, s]) =>
        h('button', { class: `btn choice-btn ${s.cls} ${myStatus === key ? 'selected' : ''}`, onclick: set(key) }, s.label)))
      : null,
    h('div', { class: 'att-grid' },
      col('Dabei', 'yes', group('ja')),
      col('Vielleicht', 'maybe', group('vielleicht')),
      col('Abgesagt', 'no', group('nein')),
      open ? col('Keine Antwort', 'none', missing) : null));
}

// ---------------------------------------------------------------- Essen
function foodSection({ ev, orders, results, name, player, myPid, myStatus, open }) {
  const mine = orders.find((o) => o.player_id === myPid) ?? { adana: 0, wurst: 0 };
  const totalA = orders.reduce((s, o) => s + o.adana, 0);
  const totalW = orders.reduce((s, o) => s + o.wurst, 0);
  const buyers = results.filter((r) => r.is_buyer).map((r) => name(r.player_id));

  const save = (patch) => async (e) => {
    const next = { adana: mine.adana, wurst: mine.wurst, ...patch };
    const action = next.adana + next.wurst === 0
      ? () => q(sb.from('food_orders').delete().eq('evening_id', ev.id).eq('player_id', myPid))
      : () => q(sb.from('food_orders').upsert({ evening_id: ev.id, player_id: myPid, ...next, updated_at: new Date().toISOString() }));
    reload(await run(action, { btn: e.currentTarget }));
  };
  const picker = (label, key) => h('div', { class: 'picker' },
    h('span', { class: 'picker-label' }, label),
    h('div', { class: 'seg' }, [0, 1, 2].map((n) =>
      h('button', { class: `seg-btn ${mine[key] === n ? 'selected' : ''}`, onclick: save({ [key]: n }) }, n))));

  let mySection = null;
  if (open && myPid) {
    mySection = myStatus === 'ja'
      ? h('div', { class: 'food-pick' }, picker('Adana', 'adana'), picker('Wurst', 'wurst'))
      : h('p', { class: 'hint' }, 'Essen auswählen kann nur, wer bei „Wer ist dabei?“ zugesagt hat.');
  }

  const list = [...orders].sort((a, b) => name(a.player_id).localeCompare(name(b.player_id), 'de'));

  return card(
    h('h2', {}, suit('h'), ' Was isst du?'),
    mySection,
    h('div', { class: 'shopping' },
      h('h3', {}, 'Einkaufsliste'),
      orders.length
        ? h('p', { class: 'shopping-total' }, h('strong', {}, `${totalA}× Adana`), ' · ', h('strong', {}, `${totalW}× Wurst`))
        : h('p', { class: 'muted' }, 'Noch keine Bestellungen.'),
      h('p', { class: 'small' }, buyers.length
        ? [h('strong', {}, 'Essen kaufen: '), buyers.join(', ')]
        : h('span', { class: 'muted' }, 'Wer einkauft, steht nach der Platzierung fest (die letzten 3).')),
      list.length ? h('ul', { class: 'order-list' }, list.map((o) =>
        h('li', {}, who(player(o.player_id)), h('span', { class: 'muted' }, foodText(o))))) : null));
}

// ---------------------------------------------------------------- Mitbringen
function bringSection({ ev, claims, name, myPid, admin, open }) {
  const canAct = open && myPid;
  const remove = (c) => async (e) => reload(await run(() => q(sb.from('bring_claims').delete().eq('id', c.id)), { btn: e.currentTarget }));
  const take = (item, note) => q(sb.from('bring_claims').insert({ evening_id: ev.id, player_id: myPid, item, note: note ?? null }));

  const fixed = BRING_ITEMS.map((item) => {
    const c = claims.find((x) => x.item === item);
    const mine = c && c.player_id === myPid;
    const actions = [];
    if (!c && canAct) {
      actions.push(h('button', { class: 'btn small primary', onclick: async (e) => reload(await run(() => take(item), { btn: e.currentTarget })) }, 'Bringe ich mit'));
    }
    if (c && ((mine && canAct) || admin)) {
      actions.push(h('button', { class: 'btn small', onclick: remove(c) }, mine ? 'Doch nicht' : 'Entfernen'));
    }
    return h('div', { class: `bring-row ${c ? 'taken' : 'free'} ${mine ? 'mine' : ''}` },
      h('span', { class: 'bring-label' }, item),
      h('span', { class: 'bring-who' }, c ? name(c.player_id) : 'frei'),
      h('span', { class: 'bring-actions' }, actions));
  });

  const others = claims.filter((c) => c.item === 'Sonstiges');
  const otherRows = others.map((c) => {
    const mine = c.player_id === myPid;
    return h('div', { class: `bring-row taken ${mine ? 'mine' : ''}` },
      h('span', { class: 'bring-label' }, c.note),
      h('span', { class: 'bring-who' }, name(c.player_id)),
      h('span', { class: 'bring-actions' },
        (mine && canAct) || admin ? h('button', { class: 'btn small', onclick: remove(c) }, mine ? 'Doch nicht' : 'Entfernen') : null));
  });

  const taken = BRING_ITEMS.filter((i) => claims.some((c) => c.item === i)).length;
  return card(
    h('h2', {}, suit('d'), ' Wer bringt was mit?'),
    h('p', { class: 'muted' }, `${taken} von ${BRING_ITEMS.length} vergeben`),
    h('div', { class: 'bring' }, fixed),
    h('h3', { class: 'sub' }, 'Sonstiges'),
    otherRows.length ? h('div', { class: 'bring' }, otherRows) : h('p', { class: 'muted' }, 'Noch nichts.'),
    canAct ? h('form', { class: 'add-form', onsubmit: async (e) => {
      e.preventDefault();
      const note = e.target.elements.note.value.trim();
      if (note) reload(await run(() => take('Sonstiges', note), { btn: e.submitter }));
    } },
      h('input', { name: 'note', placeholder: 'Ich bringe sonst noch mit …', maxlength: 60, required: true }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Eintragen')) : null);
}

// ---------------------------------------------------------------- Admin-Korrektur
function adminFixSection({ ev, attendance, orders, players }) {
  const statusOf = (pid) => attendance.find((a) => a.player_id === pid)?.status ?? '';
  const orderOf = (pid) => orders.find((o) => o.player_id === pid) ?? { adana: 0, wurst: 0 };

  const setStatus = (pid) => async (e) => {
    const status = e.target.value;
    reload(await run(() => (status
      ? q(sb.from('attendance').upsert({ evening_id: ev.id, player_id: pid, status, updated_at: new Date().toISOString() }))
      : q(sb.from('attendance').delete().eq('evening_id', ev.id).eq('player_id', pid)))));
  };
  const setFood = (pid, key) => async (e) => {
    const next = { ...orderOf(pid), [key]: Number(e.target.value) };
    reload(await run(() => (next.adana + next.wurst === 0
      ? q(sb.from('food_orders').delete().eq('evening_id', ev.id).eq('player_id', pid))
      : q(sb.from('food_orders').upsert({ evening_id: ev.id, player_id: pid, adana: next.adana, wurst: next.wurst })))));
  };
  const num = (pid, key) => h('select', { onchange: setFood(pid, key), disabled: statusOf(pid) !== 'ja' },
    [0, 1, 2].map((n) => h('option', { value: String(n), selected: orderOf(pid)[key] === n }, n)));

  return h('details', { class: 'card admin-box', open: fixOpen, ontoggle: (e) => { fixOpen = e.target.open; } },
    h('summary', {}, 'Admin: Zusagen und Essen korrigieren'),
    h('p', { class: 'hint' }, 'Gilt auch nach Ablauf der Frist. Essen geht nur bei „Dabei“.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'fix' },
      h('thead', {}, h('tr', {}, h('th', { class: 'l' }, 'Spieler'), h('th', {}, 'Status'), h('th', {}, 'Adana'), h('th', {}, 'Wurst'))),
      h('tbody', {}, players.map((p) => h('tr', {},
        h('td', { class: 'l' }, p.name),
        h('td', {}, h('select', { onchange: setStatus(p.id) },
          h('option', { value: '', selected: !statusOf(p.id) }, '–'),
          Object.entries(STATUS).map(([k, s]) => h('option', { value: k, selected: statusOf(p.id) === k }, s.label)))),
        h('td', {}, num(p.id, 'adana')),
        h('td', {}, num(p.id, 'wurst'))))))));
}

// ---------------------------------------------------------------- Ergebnis
function resultSection(ctx) {
  const { results, player, admin, started, ev } = ctx;
  const wrap = card(h('h2', {}, suit('c'), ' Ergebnis'));

  if (isFullResult(results)) {
    const sorted = [...results].sort((a, b) => a.place - b.place);
    wrap.append(h('ol', { class: 'ranking' }, sorted.map((r) =>
      h('li', { class: `rank-${Math.min(r.place, 4)} ${r.is_buyer ? 'buyer' : ''}` },
        h('span', { class: 'place' }, r.place),
        h('span', { class: 'rank-name' }, who(player(r.player_id))),
        r.is_winner ? h('span', { class: 'badge gold' }, 'Sieger') : null,
        r.is_buyer ? h('span', { class: 'badge buyer' }, 'kauft Essen') : null))));
  } else if (results.length) {
    const winner = results.filter((r) => r.is_winner).map((r) => who(player(r.player_id)));
    const losers = results.filter((r) => r.is_buyer).map((r) => who(player(r.player_id)));
    wrap.append(h('div', { class: 'legacy' },
      h('div', { class: 'legacy-row' }, h('span', { class: 'badge gold' }, 'Sieger'), h('div', { class: 'chips' }, winner)),
      h('div', { class: 'legacy-row' }, h('span', { class: 'badge buyer' }, 'Verlierer'), h('div', { class: 'chips' }, losers)),
      h('p', { class: 'hint' }, 'Für diesen Abend sind nur Sieger und Verlierer erfasst.')));
  } else {
    wrap.append(h('p', { class: 'muted' }, started ? 'Noch keine Platzierung eingetragen.'
      : `Die Platzierung wird nach dem Abend eingetragen (ab ${fmtDateTime(ev.starts_at)}).`));
  }
  if (admin && started) wrap.append(resultEditor(ctx));
  return wrap;
}

function resultEditor({ ev, results, attendance, players, player }) {
  const order = isFullResult(results)
    ? [...results].sort((a, b) => a.place - b.place).map((r) => r.player_id)
    : attendance.filter((a) => a.status === 'ja').map((a) => a.player_id);
  const list = h('ol', { class: 'editor-list' });
  const addSelect = h('select', {});
  const box = h('details', { class: 'admin-box', open: !isFullResult(results) && order.length > 0 },
    h('summary', {}, isFullResult(results) ? 'Platzierung bearbeiten' : 'Platzierung eintragen'),
    h('p', { class: 'hint' }, 'Reihenfolge = Endplatzierung, Platz 1 oben. Die letzten 3 kaufen Essen.'),
    list,
    h('div', { class: 'add-form' }, addSelect,
      h('button', { class: 'btn', type: 'button', onclick: () => {
        if (addSelect.value) { order.push(Number(addSelect.value)); draw(); }
      } }, 'Hinzufügen')),
    h('button', { class: 'btn primary block', onclick: async (e) => {
      if (order.length < 2) return alert('Mindestens 2 Spieler eintragen.');
      if (results.length && !isFullResult(results) && !confirm('Die bisherigen Angaben (Sieger/Verlierer) werden ersetzt. Fortfahren?')) return;
      reload(await run(() => q(sb.rpc('set_results', { p_evening: ev.id, p_players: order })),
        { btn: e.currentTarget, ok: 'Platzierung gespeichert.' }));
    } }, 'Platzierung speichern'));

  const move = (i, d) => { const j = i + d; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; draw(); };

  function draw() {
    list.replaceChildren(...order.map((pid, i) => h('li', { class: i >= Math.max(order.length - 3, 1) ? 'buyer' : null },
      h('span', { class: 'place' }, i + 1),
      h('span', { class: 'rank-name' }, who(player(pid))),
      h('span', { class: 'editor-btns' },
        h('button', { class: 'icon-btn', type: 'button', disabled: i === 0, title: 'Hoch', onclick: () => move(i, -1) }, '▲'),
        h('button', { class: 'icon-btn', type: 'button', disabled: i === order.length - 1, title: 'Runter', onclick: () => move(i, 1) }, '▼'),
        h('button', { class: 'icon-btn', type: 'button', title: 'Entfernen', onclick: () => { order.splice(i, 1); draw(); } }, '✕')))));
    const rest = players.filter((p) => !order.includes(p.id));
    addSelect.replaceChildren(
      h('option', { value: '' }, rest.length ? 'Spieler auswählen …' : 'Alle eingetragen'),
      ...rest.map((p) => h('option', { value: String(p.id) }, p.name)));
  }
  draw();
  return box;
}
