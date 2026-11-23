import { sb, q } from '../supabase.js';
import { h, card, fmtDate, suit } from '../ui.js';
import { state } from '../app.js';
import { foodBuyers } from '../data.js';

let selectedYear = 'all';

export async function statsView() {
  const [results, evenings, profiles] = await Promise.all([
    q(sb.from('results').select('evening_id,user_id,place')),
    q(sb.from('evenings').select('id,starts_at')),
    q(sb.from('profiles').select('id,display_name')),
  ]);
  const evDate = new Map(evenings.map((e) => [e.id, e.starts_at]));
  const name = (id) => profiles.find((p) => p.id === id)?.display_name ?? 'Unbekannt';
  const years = [...new Set(results.map((r) => new Date(evDate.get(r.evening_id)).getFullYear()))].sort((a, b) => b - a);
  if (selectedYear !== 'all' && !years.includes(Number(selectedYear))) selectedYear = 'all';

  const root = h('div', {});
  const draw = () => root.replaceChildren(...content());

  function content() {
    const rs = results.filter((r) => selectedYear === 'all'
      || new Date(evDate.get(r.evening_id)).getFullYear() === Number(selectedYear));

    // pro Abend gruppieren
    const byEvening = new Map();
    for (const r of rs) {
      if (!byEvening.has(r.evening_id)) byEvening.set(r.evening_id, []);
      byEvening.get(r.evening_id).push(r);
    }

    const stats = new Map();
    const get = (uid) => {
      if (!stats.has(uid)) stats.set(uid, { uid, games: 0, wins: 0, podium: 0, placeSum: 0, buyer: 0, last: 0 });
      return stats.get(uid);
    };
    for (const list of byEvening.values()) {
      const n = list.length;
      const buyers = new Set(foodBuyers(list));
      for (const r of list) {
        const s = get(r.user_id);
        s.games++;
        s.placeSum += r.place;
        if (r.place === 1) s.wins++;
        if (r.place <= 3) s.podium++;
        if (buyers.has(r.user_id)) s.buyer++;
        if (r.place === n) s.last++;
      }
    }
    const rows = [...stats.values()]
      .map((s) => ({ ...s, avg: s.placeSum / s.games, rate: s.wins / s.games }))
      .sort((a, b) => b.wins - a.wins || a.avg - b.avg || b.games - a.games);

    const yearSelect = h('select', { onchange: (e) => { selectedYear = e.target.value; draw(); } },
      h('option', { value: 'all', selected: selectedYear === 'all' }, 'Gesamt'),
      years.map((y) => h('option', { value: String(y), selected: String(y) === selectedYear }, y)));

    if (!rows.length) {
      return [card(h('div', { class: 'head' }, h('h1', {}, 'Statistik'), yearSelect),
        h('p', { class: 'muted' }, 'Noch keine Ergebnisse vorhanden.'))];
    }

    const best = (fn, minGames = 1) => {
      const pool = rows.filter((r) => r.games >= minGames);
      return pool.length ? pool.reduce((a, b) => (fn(b) > fn(a) ? b : a)) : null;
    };
    const mostWins = best((r) => r.wins);
    const bestAvg = best((r) => -r.avg, 3);
    const mostBuyer = best((r) => r.buyer);
    const mostGames = best((r) => r.games);
    const record = (label, r, value) => r ? h('li', {}, h('span', { class: 'rec-label' }, label),
      h('span', { class: 'rec-name' }, name(r.uid)), h('span', { class: 'rec-val' }, value)) : null;

    const fmt = (x) => x.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    const table = h('div', { class: 'table-wrap' }, h('table', { class: 'stats' },
      h('thead', {}, h('tr', {},
        h('th', {}, '#'), h('th', { class: 'l' }, 'Spieler'), h('th', {}, 'Abende'), h('th', {}, 'Siege'),
        h('th', {}, 'Top 3'), h('th', {}, 'Ø Platz'), h('th', { class: 'opt' }, 'Siegquote'), h('th', {}, 'Essen'))),
      h('tbody', {}, rows.map((r, i) => h('tr', { class: r.uid === state.profile.id ? 'me' : null },
        h('td', {}, i + 1),
        h('td', { class: 'l' }, name(r.uid)),
        h('td', {}, r.games),
        h('td', { class: 'strong' }, r.wins),
        h('td', {}, r.podium),
        h('td', {}, fmt(r.avg)),
        h('td', { class: 'opt' }, `${Math.round(r.rate * 100)} %`),
        h('td', {}, r.buyer))))));

    const history = [...byEvening.entries()]
      .sort((a, b) => new Date(evDate.get(b[0])) - new Date(evDate.get(a[0])))
      .map(([eid, list]) => {
        const winner = list.find((r) => r.place === 1);
        return h('a', { class: 'history-row', href: `#/abend/${eid}` },
          h('span', { class: 'muted' }, fmtDate(evDate.get(eid))),
          h('span', {}, suit('s'), ' ', winner ? name(winner.user_id) : '–'),
          h('span', { class: 'muted small' }, `Essen: ${foodBuyers(list).map(name).join(', ')}`));
      });

    return [
      card(h('div', { class: 'head' }, h('h1', {}, 'Statistik'), yearSelect),
        h('p', { class: 'muted' }, `${byEvening.size} gespielte Abende`),
        h('ul', { class: 'records' },
          record('Meiste Siege', mostWins, mostWins?.wins),
          record('Bester Ø-Platz (ab 3 Abenden)', bestAvg, bestAvg ? fmt(bestAvg.avg) : ''),
          record('Bester Kunde beim Lieferdienst', mostBuyer, mostBuyer ? `${mostBuyer.buyer}×` : ''),
          record('Meiste Teilnahmen', mostGames, mostGames?.games))),
      card(h('h2', {}, 'Rangliste'), table),
      card(h('h2', {}, 'Verlauf'), h('div', { class: 'list' }, history)),
    ];
  }

  draw();
  return root;
}
