import { sb, q } from '../supabase.js';
import { h, fmtDateTime, fmtTime, card, suit } from '../ui.js';
import { state } from '../app.js';
import { STATUS, isOpen } from '../data.js';
import { avatar } from '../avatar.js';

export async function eveningsView() {
  const [evenings, attendance, results, players] = await Promise.all([
    q(sb.from('evenings').select('*').order('starts_at')),
    q(sb.from('attendance').select('evening_id,player_id,status')),
    q(sb.from('results').select('evening_id,player_id,is_winner')),
    q(sb.from('players').select('id,name,avatar_path')),
  ]);
  const byId = new Map(players.map((p) => [p.id, p]));
  const winnerOf = new Map(results.filter((r) => r.is_winner).map((r) => [r.evening_id, byId.get(r.player_id)]));
  const myPid = state.player?.id;

  // Ein Abend gilt bis 6 Stunden nach Beginn als "anstehend"
  const cutoff = Date.now() - 6 * 3600 * 1000;
  const upcoming = evenings.filter((e) => new Date(e.starts_at).getTime() >= cutoff);
  const past = evenings.filter((e) => new Date(e.starts_at).getTime() < cutoff).reverse();

  const item = (ev, big = false) => {
    const att = attendance.filter((a) => a.evening_id === ev.id);
    const mine = att.find((a) => a.player_id === myPid)?.status;
    const yes = att.filter((a) => a.status === 'ja').length;
    const open = isOpen(ev);
    const isPast = new Date(ev.starts_at).getTime() < cutoff;
    let badge = null;
    if (!isPast) {
      badge = mine
        ? h('span', { class: `badge ${STATUS[mine].cls}` }, STATUS[mine].label)
        : h('span', { class: 'badge open' }, open ? 'Noch nicht abgestimmt' : 'Keine Antwort');
    }
    return h('a', { class: `evening-item ${big ? 'big' : ''}`, href: `#/abend/${ev.id}` },
      h('div', { class: 'evening-date' }, fmtDateTime(ev.starts_at)),
      h('div', { class: 'evening-meta' },
        h('span', {}, ev.location),
        isPast
          ? (winnerOf.has(ev.id) ? h('span', { class: 'winner who' }, avatar(winnerOf.get(ev.id), 'xs'), winnerOf.get(ev.id)?.name) : h('span', {}, 'kein Ergebnis'))
          : h('span', {}, `${yes} dabei`),
        !isPast ? h('span', { class: open ? 'deadline' : 'deadline closed' },
          open ? `Abstimmung bis ${fmtTime(ev.vote_deadline)}` : 'Abstimmung geschlossen') : null),
      badge);
  };

  const [next, ...later] = upcoming;
  const soon = later.slice(0, 3);
  const rest = later.slice(3);

  return h('div', {},
    !myPid ? card(h('p', {}, 'Dein Account ist noch keinem Spieler zugeordnet. Der Admin muss das unter „Admin“ erledigen.')) : null,
    next ? card(h('h2', {}, 'Nächster Abend'), item(next, true)) : card(h('p', { class: 'muted' }, 'Keine weiteren Termine angelegt.')),
    soon.length ? card(
      h('h2', {}, 'Danach'),
      h('div', { class: 'list' }, soon.map((e) => item(e))),
      rest.length ? h('details', { class: 'more' },
        h('summary', {}, `Alle weiteren Termine (${rest.length})`),
        h('div', { class: 'list' }, rest.map((e) => item(e)))) : null) : null,
    past.length ? card(h('h2', {}, 'Vergangene Abende'), h('div', { class: 'list' }, past.map((e) => item(e)))) : null);
}
