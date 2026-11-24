import { sb, q } from './supabase.js';

// Gemeinsame Daten für Krone, Titel und Spielerseiten (wird kurz zwischengespeichert)
export const meta = {
  crown: new Set(),      // Spieler-IDs mit Krone
  badges: new Map(),     // Spieler-ID -> [{ key, label, desc }]
  data: null,
  loadedAt: 0,
};

const TTL = 60 * 1000;

export function invalidateMeta() { meta.loadedAt = 0; }

export async function loadMeta(force = false) {
  if (!force && meta.data && Date.now() - meta.loadedAt < TTL) return meta;
  const [players, evenings, results, orders, attendance, claims, posts, comments, chats] = await Promise.all([
    q(sb.from('players').select('id,name,avatar_path,user_id')),
    q(sb.from('evenings').select('id,starts_at')),
    q(sb.from('results').select('evening_id,player_id,place,is_winner,is_buyer')),
    q(sb.from('food_orders').select('player_id,adana,wurst')),
    q(sb.from('attendance').select('evening_id,player_id,status')),
    q(sb.from('bring_claims').select('player_id')),
    q(sb.from('posts').select('player_id')),
    q(sb.from('post_comments').select('player_id')),
    q(sb.from('chat_messages').select('id,player_id,body').order('id', { ascending: false }).limit(300)),
  ]);
  meta.data = { players, evenings, results, orders, attendance, claims, posts, comments, chats };
  compute();
  meta.loadedAt = Date.now();
  return meta;
}

// Rangliste eines Jahres: Siege absteigend, dann weniger Essenskäufe
export function yearRanking(year) {
  const { evenings, results } = meta.data;
  const yearOf = new Map(evenings.map((e) => [e.id, new Date(e.starts_at).getFullYear()]));
  const s = new Map();
  for (const r of results) {
    if (yearOf.get(r.evening_id) !== year) continue;
    const x = s.get(r.player_id) ?? { pid: r.player_id, wins: 0, buyer: 0 };
    if (r.is_winner) x.wins++;
    if (r.is_buyer) x.buyer++;
    s.set(r.player_id, x);
  }
  return [...s.values()].sort((a, b) => b.wins - a.wins || a.buyer - b.buyer);
}

// Alle Spieler mit dem Bestwert (Gleichstand -> mehrere)
function leaders(totals, min) {
  const best = Math.max(0, ...totals.values());
  if (best < min) return [];
  return [...totals.entries()].filter(([, v]) => v === best).map(([pid]) => pid);
}

function compute() {
  const { evenings, results, orders, attendance, claims, posts, comments, chats } = meta.data;
  const badges = new Map();
  const give = (pid, key, label, desc) => {
    if (!badges.has(pid)) badges.set(pid, []);
    badges.get(pid).push({ key, label, desc });
  };
  const evStart = new Map(evenings.map((e) => [e.id, new Date(e.starts_at)]));
  const byEvening = new Map();
  for (const r of results) {
    if (!byEvening.has(r.evening_id)) byEvening.set(r.evening_id, []);
    byEvening.get(r.evening_id).push(r);
  }
  const played = [...byEvening.keys()].sort((a, b) => evStart.get(a) - evStart.get(b));
  const year = new Date().getFullYear();

  // Krone: Tabellenführer des laufenden Jahres
  const ranking = yearRanking(year);
  meta.crown = new Set(ranking.length && ranking[0].wins > 0
    ? ranking.filter((r) => r.wins === ranking[0].wins && r.buyer === ranking[0].buyer).map((r) => r.pid)
    : []);
  for (const pid of meta.crown) give(pid, 'leader', `Tabellenführer ${year}`, `Führt die Jahreswertung ${year} an.`);

  // Champion vergangener Jahre
  const years = [...new Set(played.map((id) => evStart.get(id).getFullYear()))].filter((y) => y < year);
  for (const y of years) {
    const r = yearRanking(y);
    if (r.length && r[0].wins > 0) {
      r.filter((x) => x.wins === r[0].wins && x.buyer === r[0].buyer)
        .forEach((x) => give(x.pid, `champ${y}`, `Champion ${y}`, `Die meisten Siege im Jahr ${y}.`));
    }
  }

  // Serien über aufeinanderfolgende Abende
  const winStreak = new Map(), bestWin = new Map(), buyStreak = new Map(), bestBuy = new Map();
  const comeback = new Set();
  let prevBuyers = new Set();
  for (const eid of played) {
    const list = byEvening.get(eid);
    const winners = new Set(list.filter((r) => r.is_winner).map((r) => r.player_id));
    const buyers = new Set(list.filter((r) => r.is_buyer).map((r) => r.player_id));
    for (const pid of new Set([...winStreak.keys(), ...winners])) {
      const v = winners.has(pid) ? (winStreak.get(pid) ?? 0) + 1 : 0;
      winStreak.set(pid, v);
      bestWin.set(pid, Math.max(bestWin.get(pid) ?? 0, v));
    }
    for (const pid of new Set([...buyStreak.keys(), ...buyers])) {
      const v = buyers.has(pid) ? (buyStreak.get(pid) ?? 0) + 1 : 0;
      buyStreak.set(pid, v);
      bestBuy.set(pid, Math.max(bestBuy.get(pid) ?? 0, v));
    }
    for (const w of winners) if (prevBuyers.has(w)) comeback.add(w);
    prevBuyers = buyers;
  }
  for (const [pid, n] of bestWin) if (n >= 2) give(pid, 'streak', 'Seriensieger', `${n} Siege in Folge.`);
  for (const [pid, n] of bestBuy) if (n >= 3) give(pid, 'regular', 'Stammkunde beim Lieferdienst', `${n}-mal in Folge Essen gekauft.`);
  for (const pid of comeback) give(pid, 'comeback', 'Comeback', 'Gewonnen, nachdem er beim Abend davor noch Essen kaufen musste.');

  // Rote Laterne: Letzter des letzten Abends mit vollständiger Platzierung
  const lastFull = [...played].reverse().find((eid) => byEvening.get(eid).every((r) => r.place != null));
  if (lastFull) {
    const list = byEvening.get(lastFull);
    const last = list.reduce((a, b) => (b.place > a.place ? b : a));
    give(last.player_id, 'lantern', 'Rote Laterne', 'Letzter Platz beim jüngsten Abend.');
  }

  // Knapp daneben: die meisten 2. Plätze
  const seconds = new Map();
  for (const r of results) if (r.place === 2) seconds.set(r.player_id, (seconds.get(r.player_id) ?? 0) + 1);
  for (const pid of leaders(seconds, 2)) give(pid, 'second', 'Knapp daneben', `${seconds.get(pid)}-mal Zweiter.`);

  // Essen
  const adana = new Map(), wurst = new Map();
  for (const o of orders) {
    adana.set(o.player_id, (adana.get(o.player_id) ?? 0) + o.adana);
    wurst.set(o.player_id, (wurst.get(o.player_id) ?? 0) + o.wurst);
  }
  for (const pid of leaders(adana, 1)) give(pid, 'adana', 'Adana-König', `${adana.get(pid)} Adana bestellt, mehr als jeder andere.`);
  for (const pid of leaders(wurst, 1)) give(pid, 'wurst', 'Wurst-Baron', `${wurst.get(pid)} Wurst bestellt, mehr als jeder andere.`);

  // Eiserner: 10 Zusagen in Folge (vergangene Abende)
  const now = Date.now();
  const pastIds = evenings.filter((e) => new Date(e.starts_at).getTime() < now)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).map((e) => e.id);
  const statusOf = new Map(attendance.map((a) => [`${a.evening_id}:${a.player_id}`, a.status]));
  const iron = new Map();
  for (const pid of new Set(attendance.map((a) => a.player_id))) {
    let cur = 0, best = 0;
    for (const eid of pastIds) {
      const st = statusOf.get(`${eid}:${pid}`);
      if (st === 'ja') { cur++; best = Math.max(best, cur); } else if (st) cur = 0;
    }
    iron.set(pid, best);
  }
  for (const [pid, n] of iron) if (n >= 10) give(pid, 'iron', 'Der Eiserne', `${n} Zusagen in Folge.`);

  // Mitbring-Held und Plaudertasche
  const count = (rows) => rows.reduce((m, r) => m.set(r.player_id, (m.get(r.player_id) ?? 0) + 1), new Map());
  const bring = count(claims);
  for (const pid of leaders(bring, 3)) give(pid, 'bring', 'Mitbring-Held', `${bring.get(pid)}-mal etwas mitgebracht.`);
  const talk = count([...posts, ...comments, ...chats]);
  for (const pid of leaders(talk, 20)) give(pid, 'talk', 'Plaudertasche', `${talk.get(pid)} Nachrichten im Chat.`);

  meta.badges = badges;
}

// Übersicht aller möglichen Titel (für die Regeln/Statistik)
export const BADGE_LIST = [
  ['Tabellenführer', 'Führt die Jahreswertung an (Siege, bei Gleichstand weniger Essenskäufe). Trägt die Krone.'],
  ['Champion <Jahr>', 'Hat ein abgeschlossenes Jahr gewonnen.'],
  ['Seriensieger', 'Mindestens 2 Siege in Folge.'],
  ['Comeback', 'Gewonnen direkt nach einem Abend als Essenskäufer.'],
  ['Knapp daneben', 'Die meisten 2. Plätze (mindestens 2).'],
  ['Stammkunde beim Lieferdienst', 'Mindestens 3-mal in Folge Essen gekauft.'],
  ['Rote Laterne', 'Letzter beim jüngsten Abend mit Platzierung.'],
  ['Adana-König', 'Die meisten Adana bestellt.'],
  ['Wurst-Baron', 'Die meisten Würste bestellt.'],
  ['Der Eiserne', '10 Zusagen in Folge.'],
  ['Mitbring-Held', 'Am häufigsten etwas mitgebracht (mindestens 3-mal).'],
  ['Plaudertasche', 'Die meisten Chatnachrichten (mindestens 20).'],
];
