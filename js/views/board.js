import { sb, q } from '../supabase.js';
import { SUPABASE_URL } from '../config.js';
import { h, run, card, fmtAgo, fmtDate } from '../ui.js';
import { state, render } from '../app.js';
import { who, avatar, crown, resizeImage, pickImage } from '../avatar.js';
import { meta, invalidateMeta } from '../badges.js';

const imageUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/board/${path}`;

// Sieger des letzten Abends mit Ergebnis (+ Datum)
function champion() {
  const { results, evenings } = meta.data;
  const start = new Map(evenings.map((e) => [e.id, e.starts_at]));
  const w = results.filter((r) => r.is_winner)
    .sort((a, b) => new Date(start.get(b.evening_id)) - new Date(start.get(a.evening_id)))[0];
  return w ? { pid: w.player_id, date: start.get(w.evening_id) } : null;
}

export async function boardView(tab) {
  const tabs = h('div', { class: 'tabs board-tabs' },
    h('a', { class: `tab ${tab === 'board' ? 'active' : ''}`, href: '#/pinnwand' }, 'Pinnwand'),
    h('a', { class: `tab ${tab === 'chat' ? 'active' : ''}`, href: '#/pinnwand/chat' }, 'Chat'));
  return h('div', {}, tabs, tab === 'chat' ? await chatView() : await postsView());
}

// ================================================================ Pinnwand
async function postsView() {
  const posts = await q(sb.from('posts').select('*').order('created_at', { ascending: false }).limit(50));
  const ids = posts.map((p) => p.id);
  const [comments, likes] = ids.length ? await Promise.all([
    q(sb.from('post_comments').select('*').in('post_id', ids).order('created_at')),
    q(sb.from('post_likes').select('*').in('post_id', ids)),
  ]) : [[], []];
  const players = meta.data.players;
  const player = (pid) => players.find((p) => p.id === pid);
  const myPid = state.player?.id;
  const admin = state.profile.is_admin;
  const champ = champion();
  const iAmChamp = champ && myPid && champ.pid === myPid;
  const reload = (ok) => { if (ok) { invalidateMeta(); render(); } };

  // ---------- Siegerecke
  const featured = champ && posts.find((p) => p.image_path && p.player_id === champ.pid
    && new Date(p.created_at) >= new Date(champ.date));
  let corner;
  if (!champ) {
    corner = null;
  } else if (featured) {
    corner = h('section', { class: 'card winner-corner' },
      h('div', { class: 'corner-head' }, crown('lg'), h('div', {},
        h('div', { class: 'corner-title' }, 'Siegerecke'),
        h('div', { class: 'muted small' }, `${player(champ.pid)?.name} hat am ${fmtDate(champ.date)} gewonnen`))),
      h('a', { href: imageUrl(featured.image_path), target: '_blank', rel: 'noopener' },
        h('img', { class: 'corner-img', src: imageUrl(featured.image_path), alt: 'Bild des Siegers' })),
      featured.body ? h('p', { class: 'corner-text' }, featured.body) : null);
  } else {
    corner = h('section', { class: 'card winner-corner empty' },
      h('div', { class: 'corner-head' }, crown('lg'), h('div', {},
        h('div', { class: 'corner-title' }, 'Siegerecke'),
        h('div', { class: 'muted small' }, iAmChamp
          ? 'Du hast den letzten Abend gewonnen. Poste unten ein Bild, es erscheint hier für alle.'
          : `${player(champ.pid)?.name ?? 'Der Sieger'} hat am ${fmtDate(champ.date)} gewonnen. Nur er darf hier ein Bild posten.`))));
  }

  // ---------- Neuer Beitrag
  let file = null;
  const preview = h('div', { class: 'compose-preview' });
  const text = h('textarea', { rows: 2, maxlength: 2000, placeholder: 'Was gibt’s Neues?' });
  const showPreview = () => {
    preview.replaceChildren();
    if (!file) return;
    preview.append(h('img', { src: URL.createObjectURL(file), alt: '' }),
      h('button', { class: 'icon-btn', type: 'button', title: 'Bild entfernen', onclick: () => { file = null; showPreview(); } }, '✕'));
  };
  const composer = myPid ? card(
    h('form', { class: 'compose', onsubmit: async (e) => {
      e.preventDefault();
      const body = text.value.trim();
      if (!body && !file) return;
      reload(await run(async () => {
        let path = null;
        if (file) {
          const blob = await resizeImage(file, { max: 1280 });
          path = `post-${myPid}/${Date.now()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
          const { error } = await sb.storage.from('board').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
          if (error) throw error;
        }
        try {
          await q(sb.from('posts').insert({ player_id: myPid, body: body || null, image_path: path }));
        } catch (err) {
          if (path) await sb.storage.from('board').remove([path]);
          throw err;
        }
      }, { btn: e.submitter, ok: 'Gepostet.' }));
    } },
      text,
      preview,
      h('div', { class: 'row compose-actions' },
        iAmChamp ? h('button', { class: 'btn small', type: 'button', onclick: () => pickImage((f) => { file = f; showPreview(); }) }, 'Siegerbild anhängen') : null,
        h('button', { class: 'btn primary', type: 'submit' }, 'Posten')))) : null;

  // ---------- Beiträge
  const postCard = (p) => {
    const mine = p.player_id === myPid;
    const pl = likes.filter((l) => l.post_id === p.id);
    const liked = pl.some((l) => l.player_id === myPid);
    const pc = comments.filter((c) => c.post_id === p.id);
    const toggleLike = async (e) => reload(await run(() => (liked
      ? q(sb.from('post_likes').delete().eq('post_id', p.id).eq('player_id', myPid))
      : q(sb.from('post_likes').insert({ post_id: p.id, player_id: myPid }))), { btn: e.currentTarget }));
    const del = async (e) => {
      if (!confirm('Beitrag löschen?')) return;
      reload(await run(async () => {
        await q(sb.from('posts').delete().eq('id', p.id));
        if (p.image_path) await sb.storage.from('board').remove([p.image_path]);
      }, { btn: e.currentTarget }));
    };
    return h('article', { class: `card post ${p === featured ? 'is-featured' : ''}` },
      h('div', { class: 'post-head' },
        h('a', { href: `#/spieler/${p.player_id}`, class: 'plain' }, who(player(p.player_id), 'md')),
        h('span', { class: 'muted small' }, fmtAgo(p.created_at)),
        mine || admin ? h('button', { class: 'icon-btn', title: 'Löschen', onclick: del }, '✕') : null),
      p.body ? h('p', { class: 'post-body' }, p.body) : null,
      p.image_path ? h('a', { href: imageUrl(p.image_path), target: '_blank', rel: 'noopener' },
        h('img', { class: 'post-img', src: imageUrl(p.image_path), alt: '', loading: 'lazy' })) : null,
      h('div', { class: 'post-actions' },
        h('button', { class: `like-btn ${liked ? 'liked' : ''}`, disabled: !myPid, onclick: toggleLike,
          title: pl.map((l) => player(l.player_id)?.name).join(', ') || 'Gefällt mir' },
          '♥ ', pl.length || ''),
        h('span', { class: 'muted small' }, pc.length ? `${pc.length} Kommentar${pc.length > 1 ? 'e' : ''}` : '')),
      pc.length ? h('div', { class: 'comments' }, pc.map((c) => h('div', { class: 'comment' },
        avatar(player(c.player_id), 'xs'),
        h('div', { class: 'comment-body' },
          h('strong', {}, player(c.player_id)?.name ?? '?'), ' ', c.body,
          h('span', { class: 'muted small' }, ' · ', fmtAgo(c.created_at))),
        c.player_id === myPid || admin ? h('button', { class: 'icon-btn small', title: 'Löschen', onclick: async (e) =>
          reload(await run(() => q(sb.from('post_comments').delete().eq('id', c.id)), { btn: e.currentTarget })) }, '✕') : null))) : null,
      myPid ? h('form', { class: 'comment-form', onsubmit: async (e) => {
        e.preventDefault();
        const body = e.target.elements.body.value.trim();
        if (body) reload(await run(() => q(sb.from('post_comments').insert({ post_id: p.id, player_id: myPid, body })), { btn: e.submitter }));
      } },
        h('input', { name: 'body', placeholder: 'Kommentieren …', maxlength: 1000, required: true }),
        h('button', { class: 'btn small', type: 'submit' }, 'Senden')) : null);
  };

  return h('div', {},
    corner,
    composer,
    posts.length ? posts.map(postCard) : card(h('p', { class: 'muted' }, 'Noch keine Beiträge. Mach den Anfang!')));
}

// ================================================================ Chat
async function chatView() {
  const myPid = state.player?.id;
  const players = meta.data.players;
  const player = (pid) => players.find((p) => p.id === pid);
  const admin = state.profile.is_admin;
  let messages = (await q(sb.from('chat_messages').select('*').order('id', { ascending: false }).limit(100))).reverse();

  const list = h('div', { class: 'chat-list' });
  const msgEl = (m) => {
    const mine = m.player_id === myPid;
    return h('div', { class: `msg ${mine ? 'mine' : ''}`, 'data-id': m.id },
      !mine ? avatar(player(m.player_id), 'sm') : null,
      h('div', { class: 'bubble' },
        !mine ? h('div', { class: 'msg-name' }, player(m.player_id)?.name ?? '?') : null,
        h('div', { class: 'msg-text' }, m.body),
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
    list.replaceChildren(...(messages.length ? messages.map(msgEl) : [h('p', { class: 'muted center' }, 'Noch keine Nachrichten.')]));
    if (scroll) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  };

  // Neue Nachrichten regelmäßig nachladen
  const poll = async () => {
    if (document.visibilityState !== 'visible') return;
    const lastId = messages.length ? messages[messages.length - 1].id : 0;
    try {
      const fresh = await q(sb.from('chat_messages').select('*').gt('id', lastId).order('id'));
      if (fresh.length) {
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        messages = messages.concat(fresh).slice(-200);
        draw(atBottom);
      }
    } catch { /* nächster Versuch */ }
  };
  const timer = setInterval(poll, 8000);
  state.cleanup = () => clearInterval(timer);

  const input = h('input', { name: 'body', placeholder: 'Nachricht …', maxlength: 1000, autocomplete: 'off', required: true });
  const form = myPid ? h('form', { class: 'chat-form', onsubmit: async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    const btn = e.submitter;
    if (await run(() => q(sb.from('chat_messages').insert({ player_id: myPid, body })), { btn })) {
      input.value = '';
      await poll();
      list.scrollTop = list.scrollHeight;
      input.focus();
    }
  } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Senden'))
    : h('p', { class: 'hint' }, 'Dein Account ist noch keinem Spieler zugeordnet.');

  draw();
  return card(list, form);
}

