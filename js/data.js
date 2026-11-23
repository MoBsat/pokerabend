export const STATUS = {
  ja: { label: 'Dabei', cls: 'yes' },
  vielleicht: { label: 'Vielleicht', cls: 'maybe' },
  nein: { label: 'Abgesagt', cls: 'no' },
};

export const BRING_ITEMS = ['Cola', 'Wasser', 'Körner', 'Gummibärchen', 'Chips'];

export const isOpen = (ev) => Date.now() < new Date(ev.vote_deadline).getTime();
export const hasStarted = (ev) => Date.now() >= new Date(ev.starts_at).getTime();

// Vollständige Platzierung vorhanden?
export const isFullResult = (results) => results.length > 0 && results.every((r) => r.place != null);

export function foodText(o) {
  const parts = [];
  if (o.adana) parts.push(`${o.adana}× Adana`);
  if (o.wurst) parts.push(`${o.wurst}× Wurst`);
  return parts.join(', ');
}
