import { sb, q } from '../supabase.js';
import { h, run, card, fmtAgo } from '../ui.js';
import { state, render } from '../app.js';
import { BADGE_LIST } from '../badges.js';

// Einfache Formatierung: "# Überschrift", "- Aufzählung", Leerzeile = neuer Absatz
function renderText(text) {
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) { out.push(h('p', {}, para.join(' '))); para = []; } };
  const flushList = () => { if (list) { out.push(list); list = null; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    if (line.startsWith('# ')) { flushPara(); flushList(); out.push(h('h2', {}, line.slice(2))); continue; }
    if (line.startsWith('- ')) { flushPara(); list ??= h('ul', { class: 'rules-list' }); list.append(h('li', {}, line.slice(2))); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out;
}

export async function rulesView() {
  const row = await q(sb.from('app_texts').select('*').eq('key', 'rules').maybeSingle());
  const text = row?.body ?? '';
  const admin = state.profile.is_admin;

  const content = h('div', { class: 'rules' }, text ? renderText(text) : h('p', { class: 'muted' }, 'Noch keine Regeln hinterlegt.'));

  const editor = admin ? h('details', { class: 'admin-box' },
    h('summary', {}, 'Regeln bearbeiten'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const body = e.target.elements.body.value;
      if (await run(() => q(sb.from('app_texts').upsert({ key: 'rules', body, updated_at: new Date().toISOString() })),
        { btn: e.submitter, ok: 'Regeln gespeichert.' })) render();
    } },
      h('p', { class: 'hint' }, 'Formatierung: Zeile mit „# “ = Überschrift, Zeile mit „- “ = Aufzählungspunkt, leere Zeile = neuer Absatz.'),
      h('textarea', { name: 'body', rows: 18, maxlength: 20000, class: 'rules-edit', value: text }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Speichern'))) : null;

  return h('div', {},
    card(h('h1', {}, 'Regeln'), content,
      row?.updated_at ? h('p', { class: 'hint' }, `Zuletzt geändert ${fmtAgo(row.updated_at)}`) : null,
      editor),
    card(h('h2', {}, 'Titel und Abzeichen'),
      h('p', { class: 'muted' }, 'Werden automatisch vergeben und stehen auf den Spielerseiten.'),
      h('dl', { class: 'badge-list' }, BADGE_LIST.map(([label, desc]) => [h('dt', {}, label), h('dd', {}, desc)]))));
}
