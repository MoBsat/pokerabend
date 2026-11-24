import { sb, q } from '../supabase.js';
import { SUPABASE_URL } from '../config.js';
import { h, run, card, fmtAgo, fmtDate } from '../ui.js';
import { state, render } from '../app.js';
import { avatar, crown, resizeImage, pickImage } from '../avatar.js';
import { meta, invalidateMeta } from '../badges.js';

const imageUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/board/${path}`;

// ---------------------------------------------------------------- Gelesen-Status (nur in diesem Browser)
const SEEN_KEY = 'poker.chatLastSeen';
export function lastSeen() {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; }
}
function markSeen(id) {
  try { if (id > lastSeen()) localStorage.setItem(SEEN_KEY, String(id)); } catch { /* egal */ }
}

// ---------------------------------------------------------------- Erwähnungen
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Regex für "@Name" aller Spieler (längste Namen zuerst) + "@alle"
function mentionRegex(players) {
  const names = players.map((p) => p.name).sort((a, b) => b.length - a.length).map(escapeRe);
  return new RegExp(`@(alle|${names.join('|')})(?![\\p{L}\\d_])`, 'giu');
}

export function mentionsMe(body, players, myName) {
  if (!myName) return false;
  for (const m of body.matchAll(mentionRegex(players))) {
    const n = m[1].toLowerCase();
    if (n === 'alle' || n === myName.toLowerCase()) return true;
  }
  return false;
}

// Text mit hervorgehobenen @Erwähnungen (alles als Textknoten, kein HTML)
function renderBody(body, players, myName) {
  const out = [];
  let last = 0;
  for (const m of body.matchAll(mentionRegex(players))) {
    if (m.index > last) out.push(body.slice(last, m.index));
    const n = m[1].toLowerCase();
    const me = n === 'alle' || (myName && n === myName.toLowerCase());
    const p = players.find((x) => x.name.toLowerCase() === n);
    out.push(p
      ? h('a', { class: `mention ${me ? 'me' : ''}`, href: `#/spieler/${p.id}` }, `@${p.name}`)
      : h('span', { class: `mention ${me ? 'me' : ''}` }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

// Sieger des letzten Abends mit Ergebnis (+ Datum)
function champion() {
  const { results, evenings } = meta.data;
  const start = new Map(evenings.map((e) => [e.id, e.starts_at]));
  const w = results.filter((r) => r.is_winner)
    .sort((a, b) => new Date(start.get(b.evening_id)) - new Date(start.get(a.evening_id)))[0];
  return w ? { pid: w.player_id, date: start.get(w.evening_id) } : null;
}

// ================================================================ Seite
export async function boardView() {
  const players = meta.data.players;
  const player = (pid) => players.find((p) => p.id === pid);
  const myPid = state.player?.id;
  const myName = state.player?.name;
  const admin = state.profile.is_admin;
  const champ = champion();
  const iAmChamp = !!(champ && myPid && champ.pid === myPid);

  const [pinned, initial] = await Promise.all([
    champ ? q(sb.from('posts').select('*').eq('player_id', champ.pid).gte('created_at', new Date(champ.date).toISOString())
      .order('created_at', { ascending: false }).limit(5)) : [],
    q(sb.from('chat_messages').select('*').order('id', { ascending: false }).limit(150)),
  ]);
  const featured = pinned.find((p) => p.image_path) ?? null;
  let messages = initial.reverse();

  return h('div', {}, winnerCorner(), chat());

  // ---------------------------------------------------------- Siegerbild oben
  function winnerCorner() {
    if (!champ) return null;
    const head = h('div', { class: 'corner-head' }, crown('lg'), h('div', {},
      h('div', { class: 'corner-title' }, 'Siegerecke'),
      h('div', { class: 'muted small' }, `${player(champ.pid)?.name ?? '?'} hat am ${fmtDate(champ.date)} gewonnen`)));

    const editor = iAmChamp ? winnerEditor() : null;
    if (!featured) {
      return h('section', { class: 'card winner-corner empty' }, head,
        h('p', { class: 'muted small corner-hint' }, iAmChamp
          ? 'Du hast den letzten Abend gewonnen. Lade ein Bild hoch, es hängt hier oben für alle, bis der Nächste gewinnt.'
          : 'Nur der Sieger darf hier ein Bild aufhängen.'),
        editor);
    }
    const canDelete = iAmChamp || admin;
    return h('section', { class: 'card winner-corner' }, head,
      h('a', { href: imageUrl(featured.image_path), target: '_blank', rel: 'noopener' },
        h('img', { class: 'corner-img', src: imageUrl(featured.image_path), alt: 'Bild des Siegers' })),
      featured.body ? h('p', { class: 'corner-text' }, featured.body) : null,
      h('div', { class: 'row corner-actions' },
        editor,
        canDelete ? h('button', { class: 'btn small', onclick: async (e) => {
          if (!confirm('Siegerbild entfernen?')) return;
          if (await run(() => removePost(featured), { btn: e.currentTarget })) render();
        } }, 'Bild entfernen') : null));
  }

  async function removePost(p) {
    await q(sb.from('posts').delete().eq('id', p.id));
    if (p.image_path) await sb.storage.from('board').remove([p.image_path]);
  }

  // Bild auswählen -> Vorschau + Bildunterschrift -> speichern (ersetzt das bisherige)
  function winnerEditor() {
    const box = h('div', { class: 'winner-editor' });
    const start = () => pickImage((file) => {
      const caption = h('input', { maxlength: 300, placeholder: 'Bildunterschrift (optional)' });
      box.replaceChildren(
        h('img', { class: 'editor-preview', src: URL.createObjectURL(file), alt: '' }),
        caption,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary small', onclick: async (e) => {
            const ok = await run(async () => {
              const blob = await resizeImage(file, { max: 1280 });
              const path = `post-${myPid}/${Date.now()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
              const { error } = await sb.storage.from('board').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
              if (error) throw error;
              try {
                await q(sb.from('posts').insert({ player_id: myPid, body: caption.value.trim() || null, image_path: path }));
              } catch (err) {
                await sb.storage.from('board').remove([path]);
                throw err;
              }
              // vorheriges Siegerbild aufräumen
              for (const old of pinned.filter((p) => p.player_id === myPid)) {
                try { await removePost(old); } catch { /* egal */ }
              }
            }, { btn: e.currentTarget, ok: 'Siegerbild aufgehängt.' });
            if (ok) { invalidateMeta(); render(); }
          } }, 'Aufhängen'),
          h('button', { class: 'btn small', onclick: () => box.replaceChildren(button()) }, 'Abbrechen')));
    });
    const button = () => h('button', { class: 'btn small primary', onclick: start }, featured ? 'Bild ändern' : 'Bild hochladen');
    box.append(button());
    return box;
  }

  // ---------------------------------------------------------- Chat
  function chat() {
    const list = h('div', { class: 'chat-list' });

    const msgEl = (m) => {
      const mine = m.player_id === myPid;
      const forMe = !mine && mentionsMe(m.body, players, myName);
      const p = player(m.player_id);
      return h('div', { class: `msg ${mine ? 'mine' : ''} ${forMe ? 'for-me' : ''}` },
        !mine ? h('a', { href: `#/spieler/${m.player_id}`, class: 'plain' }, avatar(p, 'sm')) : null,
        h('div', { class: 'bubble' },
          !mine ? h('div', { class: 'msg-name' }, p?.name ?? '?') : null,
          h('div', { class: 'msg-text' }, renderBody(m.body, players, myName)),
          h('div', { class: 'msg-meta' }, fmtAgo(m.created_at),
            mine || admin ? h('button', { class: 'icon-btn tiny', title: 'Löschen', onclick: async (e) => {
              if (!confirm('Nachricht löschen?')) return;
              if (await run(() => q(sb.from('chat_messages').delete().eq('id', m.id)), { btn: e.currentTarget })) {
                messages = messages.filter((x) => x.id !== m.id);
                draw(false);
              }
            } }, '✕') : null)));
    };

    const draw = (scroll = true) => {
      list.replaceChildren(...(messages.length ? messages.map(msgEl)
        : [h('p', { class: 'muted center' }, 'Noch keine Nachrichten. Schreib die erste!')]));
      if (scroll) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
      if (messages.length) markSeen(messages[messages.length - 1].id);
    };

    // neue Nachrichten alle 8 Sekunden nachladen
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      const lastId = messages.length ? messages[messages.length - 1].id : 0;
      try {
        const fresh = await q(sb.from('chat_messages').select('*').gt('id', lastId).order('id'));
        if (fresh.length) {
          const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
          messages = messages.concat(fresh).slice(-300);
          draw(atBottom);
        }
      } catch { /* nächster Versuch */ }
    };
    const timer = setInterval(poll, 8000);
    state.cleanup = () => clearInterval(timer);

    // ---------- Eingabe mit @-Vorschlägen
    const input = h('textarea', { rows: 1, maxlength: 1000, placeholder: 'Nachricht … (@ für Namen)', autocomplete: 'off' });
    const suggest = h('div', { class: 'mention-suggest', hidden: true });

    const currentToken = () => {
      const before = input.value.slice(0, input.selectionStart);
      const m = before.match(/(^|\s)@([\p{L}\d_-]*)$/u);
      return m ? { query: m[2], start: before.length - m[2].length - 1 } : null;
    };
    const insert = (name) => {
      const t = currentToken();
      if (!t) return;
      const after = input.value.slice(input.selectionStart);
      input.value = `${input.value.slice(0, t.start)}@${name} ${after.replace(/^\s+/, '')}`;
      const pos = t.start + name.length + 2;
      input.setSelectionRange(pos, pos);
      suggest.hidden = true;
      input.focus();
      autosize();
    };
    const updateSuggest = () => {
      const t = currentToken();
      if (!t) { suggest.hidden = true; return; }
      const qy = t.query.toLowerCase();
      const options = [{ id: 0, name: 'alle' }, ...players.filter((p) => p.id !== myPid)]
        .filter((p) => p.name.toLowerCase().startsWith(qy)).slice(0, 6);
      if (!options.length) { suggest.hidden = true; return; }
      suggest.replaceChildren(...options.map((p) => h('button', {
        type: 'button', class: 'suggest-item',
        onmousedown: (e) => e.preventDefault(), // Fokus im Eingabefeld behalten
        onclick: () => insert(p.name),
      }, p.id ? avatar(p, 'xs') : h('span', { class: 'avatar xs initial' }, '@'), p.id ? p.name : 'alle')));
      suggest.hidden = false;
    };
    const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; };
    input.addEventListener('input', () => { updateSuggest(); autosize(); });
    input.addEventListener('click', updateSuggest);
    input.addEventListener('blur', () => setTimeout(() => { suggest.hidden = true; }, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!suggest.hidden) { suggest.querySelector('button')?.click(); return; }
        form.requestSubmit();
      }
      if (e.key === 'Escape') suggest.hidden = true;
    });

    const form = myPid ? h('form', { class: 'chat-form', onsubmit: async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      const btn = form.querySelector('button[type=submit]');
      if (await run(() => q(sb.from('chat_messages').insert({ player_id: myPid, body })), { btn })) {
        input.value = '';
        autosize();
        await poll();
        list.scrollTop = list.scrollHeight;
        input.focus();
      }
    } }, h('div', { class: 'chat-input' }, suggest, input), h('button', { class: 'btn primary', type: 'submit' }, 'Senden'))
      : h('p', { class: 'hint' }, 'Dein Account ist noch keinem Spieler zugeordnet.');

    draw();
    return h('section', { class: 'card chat-card' }, h('h2', {}, 'Chat'), list, form);
  }
}
