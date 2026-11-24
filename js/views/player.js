import { h, card, fmtDate } from '../ui.js';
import { avatar, crown } from '../avatar.js';
import { meta } from '../badges.js';

export function playerView(pid) {
  const { players, results, evenings } = meta.data;
  const p = players.find((x) => x.id === pid);
  if (!p) return card(h('h2', {}, 'Spieler nicht gefunden'), h('a', { href: '#/statistik' }, 'Zur Statistik'));

  const start = new Map(evenings.map((e) => [e.id, e.starts_at]));
  const byEvening = new Map();
  for (const r of results) {
    if (!byEvening.has(r.evening_id)) byEvening.set(r.evening_id, []);
    byEvening.get(r.evening_id).push(r);
  }
  const mine = results.filter((r) => r.player_id === pid)
    .sort((a, b) => new Date(start.get(b.evening_id)) - new Date(start.get(a.evening_id)));
  const full = mine.filter((r) => byEvening.get(r.evening_id).every((x) => x.place != null));
  const wins = mine.filter((r) => r.is_winner).length;
  const buyer = mine.filter((r) => r.is_buyer).length;
  const avg = full.length ? full.reduce((s, r) => s + r.place, 0) / full.length : null;
  const badges = meta.badges.get(pid) ?? [];

  const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'stat-val' }, value), h('div', { class: 'stat-label' }, label));
  const outcome = (r) => {
    if (r.place != null) return `Platz ${r.place} von ${byEvening.get(r.evening_id).length}${r.is_buyer ? ' · Essen' : ''}`;
    return r.is_winner ? 'Sieger' : 'Verlierer · Essen';
  };

  return h('div', {},
    h('a', { class: 'back', href: '#/statistik' }, '← Statistik'),
    card(
      h('div', { class: 'player-head' },
        h('div', { class: 'player-pic' }, avatar(p, 'xl'), meta.crown.has(pid) ? crown('on-avatar') : null),
        h('h1', {}, p.name)),
      h('div', { class: 'stat-row' },
        stat('Siege', wins),
        stat('Essen gekauft', buyer),
        stat('Abende*', full.length || '–'),
        stat('Ø Platz*', avg == null ? '–' : avg.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 }))),
      h('p', { class: 'hint' }, '* nur Abende mit vollständiger Platzierung')),
    card(h('h2', {}, 'Titel'),
      badges.length
        ? h('div', { class: 'badge-cards' }, badges.map((b) => h('div', { class: `badge-card b-${b.key}` },
          h('div', { class: 'badge-title' }, b.label), h('div', { class: 'muted small' }, b.desc))))
        : h('p', { class: 'muted' }, 'Noch keine Titel.')),
    card(h('h2', {}, 'Letzte Abende'),
      mine.length ? h('div', { class: 'list' }, mine.slice(0, 15).map((r) => h('a', { class: 'history-row', href: `#/abend/${r.evening_id}` },
        h('span', { class: 'muted' }, fmtDate(start.get(r.evening_id))),
        h('span', { class: r.is_winner ? 'winner' : '' }, outcome(r)))))
        : h('p', { class: 'muted' }, 'Noch keine Ergebnisse.')));
}
