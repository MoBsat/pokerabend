import { sb, q } from './supabase.js';
import { SUPABASE_URL } from './config.js';
import { h } from './ui.js';

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
  h('span', { class: 'who' }, avatar(player, size), h('span', {}, player?.name ?? 'Unbekannt'));

// Bild quadratisch zuschneiden und verkleinern. Neu kodiert -> Metadaten (GPS usw.) werden entfernt.
async function resize(file) {
  if (!file.type.startsWith('image/')) throw new Error('Bitte eine Bilddatei auswählen.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Die Datei ist zu groß (max. 25 MB).');
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Das Bild konnte nicht gelesen werden. Bitte JPG oder PNG verwenden.');
  }
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bmp.close?.();
  const toBlob = (type, quality) => new Promise((res) => canvas.toBlob(res, type, quality));
  let blob = await toBlob('image/webp', 0.85);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.85); // ältere Safari-Versionen
  if (!blob) throw new Error('Das Bild konnte nicht verarbeitet werden.');
  return blob;
}

export async function uploadAvatar(player, file) {
  const blob = await resize(file);
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
