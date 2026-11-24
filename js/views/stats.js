import { sb, q } from '../supabase.js';
import { h, card, fmtDate, suit } from '../ui.js';
import { state } from '../app.js';
import { who } from '../avatar.js';

let selectedYear = 'all';

export async function statsView() {
  const [results, evenings, players] = await Promise.all([
    q(sb.from('results').select('evening_id,player_id,place,is_winner,is_buyer')),
    q(sb.from('evenings').select('id,starts_at')),
    q(sb.from('players').select('id,name,avatar_path')),
  ]);
  const evDate = new Map(evenings.map((e) => [e.id, e.starts_at]));
  const name = (id) => players.find((p) => p.id === id)?.name ?? 'Unbekannt';
  const yearOf = (eid) => new Date(evDate.get(eid)).getFullYear();
  const years = [...new Set(results.map((r) => yearOf(r.evening_id)))].sort((a, b) => b - a);
  if (selectedYear !== 'all' && !years.includes(Number(selectedYear))) selectedYear = 'all';
  const myPid = state.player?.id;

  const root = h('div', {});
  const draw = () => root.replaceChildren(...content());

  function content() {
    const rs = results.filter((r) => selectedYear === 'all' || yearOf(r.evening_id) === Number(selectedYear));
    const byEvening = new Map();
    for (const r of rs) {
      if (!byEvening.has(r.evening_id)) byEvening.set(r.evening_id, []);
      byEvening.get(r.evening_id).push(r);
    }

    const stats = new Map();
    const get = (pid) => {
      if (!stats.has(pid)) stats.set(pid, { pid, wins: 0, buyer: 0, games: 0, podium: 0, placeSum: 0 });
      return stats.get(pid);
    };
    let fullCount = 0;
    for (const list of byEvening.values()) {
      const full = list.every((r) => r.place != null);
      if (full) fullCount++;
      for (const r of list) {
        const s = get(r.player_id);
        if (r.is_winner) s.wins++;
        if (r.is_buyer) s.buyer++;
        if (full) {
          s.games++;
          s.placeSum += r.place;
          if (r.place <= 3) s.podium++;
        }
      }
    }
    const rows = [...stats.values()]
      .map((s) => ({ ...s, avg: s.games ? s.placeSum / s.games : null }))
      .sort((a, b) => b.wins - a.wins || a.buyer - b.buyer || (a.avg ?? 99) - (b.avg ?? 99) || name(a.pid).localeCompare(name(b.pid), 'de'));

    const yearSelect = h('select', { onchange: (e) => { selectedYear = e.target.value; draw(); } },
      h('option', { value: 'all', selected: selectedYear === 'all' }, 'Gesamt'),
      years.map((y) => h('option', { value: String(y), selected: String(y) === selectedYear }, y)));

    if (!rows.length) {
      return [card(h('div', { class: 'head' }, h('h1', {}, 'Statistik'), yearSelect), h('p', { class: 'muted' }, 'Noch keine Ergebnisse vorhanden.'))];
    }

    const fmt = (x) => (x == null ? '–' : x.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    // Alle Spieler mit dem Bestwert (bei Gleichstand mehrere Namen)
    const top = (val, pool = rows) => {
      if (!pool.length) return null;
      const best = Math.max(...pool.map(val));
      if (best <= 0 && val !== negAvg) return null;
      return { names: pool.filter((r) => val(r) === best).map((r) => name(r.pid)).join(', '), best };
    };
    const negAvg = (r) => -r.avg;
    const record = (label, t, show) => t ? h('li', {}, h('span', { class: 'rec-label' }, label),
      h('span', { class: 'rec-name' }, t.names), h('span', { class: 'rec-val' }, show(t.best))) : null;

    const table = h('div', { class: 'table-wrap' }, h('table', { class: 'stats' },
      h('thead', {}, h('tr', {},
        h('th', {}, '#'), h('th', { class: 'l' }, 'Spieler'), h('th', {}, 'Siege'), h('th', {}, 'Essen'),
        h('th', {}, 'Abende*'), h('th', {}, 'Ø Platz*'), h('th', { class: 'opt' }, 'Top 3*'))),
      h('tbody', {}, rows.map((r, i) => h('tr', { class: r.pid === myPid ? 'me' : null },
        h('td', {}, i + 1),
        h('td', { class: 'l' }, h('a', { class: 'plain', href: `#/spieler/${r.pid}` }, who(players.find((p) => p.id === r.pid), 'xs'))),
        h('td', { class: 'strong' }, r.wins),
        h('td', {}, r.buyer),
        h('td', {}, r.games || '–'),
        h('td', {}, fmt(r.avg)),
        h('td', { class: 'opt' }, r.games ? r.podium : '–'))))));

    const history = [...byEvening.entries()]
      .sort((a, b) => new Date(evDate.get(b[0])) - new Date(evDate.get(a[0])))
      .map(([eid, list]) => h('a', { class: 'history-row', href: `#/abend/${eid}` },
        h('span', { class: 'muted' }, fmtDate(evDate.get(eid))),
        h('span', {}, suit('s'), ' ', list.filter((r) => r.is_winner).map((r) => name(r.player_id)).join(', ') || '–'),
        h('span', { class: 'muted small' }, `Essen: ${list.filter((r) => r.is_buyer).map((r) => name(r.player_id)).join(', ')}`)));

    return [
      card(h('div', { class: 'head' }, h('h1', {}, 'Statistik'), yearSelect),
        h('p', { class: 'muted' }, `${byEvening.size} gespielte Abende`),
        h('ul', { class: 'records' },
          record('Meiste Siege', top((r) => r.wins), (v) => v),
          record('Bester Kunde beim Lieferdienst', top((r) => r.buyer), (v) => `${v}×`),
          record('Bester Ø-Platz (ab 3 Abenden)', top(negAvg, rows.filter((r) => r.games >= 3)), (v) => fmt(-v)),
          record('Meiste Teilnahmen*', top((r) => r.games), (v) => v))),
      card(h('h2', {}, 'Rangliste'), h('p', { class: 'hint' }, 'Auf einen Namen tippen für Titel und Bilanz.'), table,
        h('p', { class: 'hint' }, `* nur Abende mit vollständiger Platzierung (${fullCount}). Bei älteren Abenden sind nur Sieger und Verlierer erfasst.`)),
      card(h('h2', {}, 'Verlauf'), h('div', { class: 'list' }, history)),
    ];
  }

  draw();
  return root;
}
