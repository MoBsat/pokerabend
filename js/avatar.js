import { sb, q } from './supabase.js';
import { SUPABASE_URL } from './config.js';
import { h } from './ui.js';
import { meta } from './badges.js';

const SIZE = 256;

export const avatarUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;

// Rundes Profilbild oder Kreis mit Anfangsbuchstaben
export function avatar(player, size = 'sm') {
  if (player?.avatar_path) {
    return h('img', { class: `avatar ${size}`, src: avatarUrl(player.avatar_path), alt: '', loading: 'lazy', decoding: 'async' });
  }
  const letter = (player?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return h('span', { class: `avatar ${size} initial`, 'aria-hidden': 'true' }, letter);
}

// Avatar + Name nebeneinander
export const who = (player, size = 'sm') =>
  h('span', { class: 'who' }, avatar(player, size), h('span', {}, player?.name ?? 'Unbekannt'),
    meta.crown.has(player?.id) ? crown() : null);

// Kleine Krone (SVG) für den Tabellenführer
export function crown(cls = '') {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `crown ${cls}`);
  svg.setAttribute('aria-label', 'Tabellenführer');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2.4 13h13.2v2H5.4v-2z');
  svg.append(path);
  return svg;
}

// Bild verkleinern (optional quadratisch zuschneiden). Neu kodiert -> Metadaten (GPS usw.) werden entfernt.
export async function resizeImage(file, { square = false, max = SIZE } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Bitte eine Bilddatei auswählen.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Die Datei ist zu groß (max. 25 MB).');
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Das Bild konnte nicht gelesen werden. Bitte JPG oder PNG verwenden.');
  }
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height, w, hgt;
  if (square) {
    const side = Math.min(bmp.width, bmp.height);
    sx = (bmp.width - side) / 2; sy = (bmp.height - side) / 2; sw = sh = side;
    w = hgt = Math.min(max, side);
  } else {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    w = Math.round(bmp.width * scale); hgt = Math.round(bmp.height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, hgt);
  bmp.close?.();
  const toBlob = (type, quality) => new Promise((res) => canvas.toBlob(res, type, quality));
  let blob = await toBlob('image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.82); // ältere Safari-Versionen
  if (!blob) throw new Error('Das Bild konnte nicht verarbeitet werden.');
  return blob;
}

export async function uploadAvatar(player, file) {
  const blob = await resizeImage(file, { square: true, max: SIZE });
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `player-${player.id}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('avatars').upload(path, blob, {
    contentType: blob.type, cacheControl: '31536000', upsert: false,
  });
  if (error) throw error;
  await q(sb.rpc('set_avatar', { p_player: player.id, p_path: path }));
  if (player.avatar_path) await sb.storage.from('avatars').remove([player.avatar_path]); // altes Bild aufräumen
}

export async function removeAvatar(player) {
  await q(sb.rpc('set_avatar', { p_player: player.id, p_path: null }));
  if (player.avatar_path) await sb.storage.from('avatars').remove([player.avatar_path]);
}

// Unsichtbares Dateifeld öffnen
export function pickImage(onFile) {
  const input = h('input', { type: 'file', accept: 'image/*', class: 'hidden-file' });
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.remove(); });
  document.body.append(input);
  input.click();
}
