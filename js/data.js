import { FOOD_BUYERS } from './config.js';

// Letzte X Plätze eines Abends (results: [{user_id, place}])
export function foodBuyers(results) {
  const sorted = [...results].sort((a, b) => a.place - b.place);
  return sorted.slice(Math.max(0, sorted.length - FOOD_BUYERS)).map((r) => r.user_id);
}

export const STATUS = {
  ja: { label: 'Dabei', cls: 'yes' },
  vielleicht: { label: 'Vielleicht', cls: 'maybe' },
  nein: { label: 'Abgesagt', cls: 'no' },
};
