// The five controls live in the URL hash so a loan officer can paste one link into a credit memo.

export interface HashState {
  crop: string | null;
  study: string | null;
  target: string | null;     // 'YYYY-MM'
  rate: number | null;       // yearly operating rate as a fraction; null means the study's own
  acres: number;
}

export const DEFAULT_HASH: HashState = { crop: null, study: null, target: null, rate: null, acres: 1 };

export function parseHash(hash: string): HashState {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const rate = q.get('rate');
  const acres = Number(q.get('acres'));
  return {
    crop: q.get('crop'),
    study: q.get('study'),
    target: /^\d{4}-\d{2}$/.test(q.get('target') ?? '') ? q.get('target') : null,
    rate: rate !== null && rate !== '' && Number.isFinite(Number(rate)) ? Number(rate) / 100 : null,
    acres: Number.isFinite(acres) && acres > 0 ? acres : 1,
  };
}

export function serializeHash(s: HashState): string {
  const q = new URLSearchParams();
  if (s.crop) q.set('crop', s.crop);
  if (s.study) q.set('study', s.study);
  if (s.target) q.set('target', s.target);
  if (s.rate !== null) q.set('rate', String(Math.round(s.rate * 10000) / 100));
  if (s.acres !== 1) q.set('acres', String(s.acres));
  const out = q.toString();
  return out ? `#${out}` : '';
}
