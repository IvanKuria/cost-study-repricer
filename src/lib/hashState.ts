// The controls live in the URL hash so a loan officer can paste one link into a credit memo.

export interface HashState {
  crop: string | null;
  study: string | null;
  target: string | null;     // 'YYYY-MM'
  rate: number | null;       // yearly operating rate as a fraction; null means the study's own
  crRate: number | null;     // yearly capital recovery rate for the establishment charge as a fraction; null means the study's own
  acres: number;
  /** Lender edits to gross returns, keyed like the engine's overrides: 'ret-0:price', 'ret-0:quantity', 'ret-0:total', 'gross:total'.
   *  In the URL each is one parameter, e.g. 'ret-0.price=1.75'. They belong to the study and clear when the study changes. */
  returns: Record<string, number>;
}

export const DEFAULT_HASH: HashState = { crop: null, study: null, target: null, rate: null, crRate: null, acres: 1, returns: {} };

const RETURN_PARAM = /^(ret-\d+|gross)\.(price|quantity|total)$/;

export function parseHash(hash: string): HashState {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const rate = q.get('rate');
  const crRate = q.get('crrate');
  const pctOf = (v: string | null) => v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) / 100 : null;
  const acres = Number(q.get('acres'));
  const returns: Record<string, number> = {};
  for (const [k, v] of q) {
    const m = k.match(RETURN_PARAM);
    if (m && v !== '' && Number.isFinite(Number(v))) returns[`${m[1]}:${m[2]}`] = Number(v);
  }
  return {
    crop: q.get('crop'),
    study: q.get('study'),
    target: /^\d{4}-\d{2}$/.test(q.get('target') ?? '') ? q.get('target') : null,
    rate: pctOf(rate),
    crRate: pctOf(crRate),
    acres: Number.isFinite(acres) && acres > 0 ? acres : 1,
    returns,
  };
}

export function serializeHash(s: HashState): string {
  const q = new URLSearchParams();
  if (s.crop) q.set('crop', s.crop);
  if (s.study) q.set('study', s.study);
  if (s.target) q.set('target', s.target);
  if (s.rate !== null) q.set('rate', String(Math.round(s.rate * 10000) / 100));
  if (s.crRate !== null) q.set('crrate', String(Math.round(s.crRate * 10000) / 100));
  if (s.acres !== 1) q.set('acres', String(s.acres));
  for (const [k, v] of Object.entries(s.returns ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
    const param = k.replace(':', '.');
    if (RETURN_PARAM.test(param) && Number.isFinite(v)) q.set(param, String(v));
  }
  const out = q.toString();
  return out ? `#${out}` : '';
}
