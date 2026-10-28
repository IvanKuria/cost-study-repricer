import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { DEFAULT_SETTINGS, referencePeriod, repriceStudy } from './reprice';
import { CROP_PRICES } from './cropPrices';
import type { RepricedTable } from './types';

// Guards the mature production table the same way coverage.test.ts guards the establishment charge: at the study's
// own month nothing is repriced, so every table must reproduce the study's printed totals; repriced tables must add up;
// and the list of studies in each state is snapshotted so a parser change that breaks one shows up in review.

const load = (id: string) => JSON.parse(readFileSync(`data/studies/parsed/${id}.json`, 'utf8')) as ParsedStudy;
const IDS = readdirSync('data/studies/parsed').filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.005);
const cell = (t: RepricedTable, id: string) => t.rows.find(r => r.id === id)?.cells.total;

/** Studies whose production table does not reproduce the printed totals at unchanged prices, each with the reason. */
const MISMATCH_ALLOWED: Record<string, string> = {};

type State = 'reproduces' | 'mismatch' | 'no printed totals' | 'printed total only';
function stateOf(s: ParsedStudy): { state: State; detail: string } {
  const c = s.costsPerAcre;
  if (!c.totalCost && !c.operatingTotal) return { state: 'no printed totals', detail: '' };
  const t = repriceStudy(s, { targetPeriod: referencePeriod(s, DEFAULT_SETTINGS).period, layout: 'production' });
  const bad: string[] = [];
  const op = cell(t, 'total-operating'), tot = cell(t, 'total');
  if (c.operatingTotal && !(op?.repriced != null && close(op.repriced, c.operatingTotal.value))) bad.push(`operating ${Math.round(op?.repriced ?? NaN)} vs ${c.operatingTotal.value}`);
  if (c.totalCost && !(tot?.repriced != null && close(tot.repriced, c.totalCost.value))) bad.push(`total ${Math.round(tot?.repriced ?? NaN)} vs ${c.totalCost.value}`);
  if (bad.length) return { state: 'mismatch', detail: bad.join(', ') };
  return { state: c.operations.length ? 'reproduces' : 'printed total only', detail: '' };
}

describe('production tables', () => {
  const states = Object.fromEntries(IDS.map(id => [id, stateOf(load(id))]));

  it('at the study\'s own month, every table reproduces its printed operating and total costs', () => {
    const bad = IDS.filter(id => states[id].state === 'mismatch' && !MISMATCH_ALLOWED[id]).map(id => `${id}: ${states[id].detail}`);
    expect(bad, 'new mismatches: fix the parse or add a reason to MISMATCH_ALLOWED').toEqual([]);
    expect(Object.keys(MISMATCH_ALLOWED).filter(id => states[id].state !== 'mismatch'), 'these now reproduce; remove them from MISMATCH_ALLOWED').toEqual([]);
  });

  it('state list matches the reviewed snapshot (update with `npx vitest -u` after checking the diff)', async () => {
    const grouped: Record<string, string[]> = {};
    for (const id of IDS) (grouped[states[id].state] ??= []).push(id);
    await expect(JSON.stringify(grouped, null, 2) + '\n').toMatchFileSnapshot('../../data/production-states.json');
  });

  it('repriced tables add up: operating rows to the operating total, and the total to operating + cash + non-cash overhead', () => {
    const bad: string[] = [];
    for (const id of IDS) {
      const s = load(id);
      if (!s.costsPerAcre.totalCost) continue;
      const t = repriceStudy(s, { targetPeriod: '2026-07', interestRate: 0.0751, cropPrices: CROP_PRICES, layout: 'production' });
      const sum = (pred: (r: RepricedTable['rows'][number]) => boolean) => t.rows.filter(pred).reduce((v, r) => v + (r.cells.total?.repriced ?? 0), 0);
      const op = cell(t, 'total-operating')?.repriced ?? 0, total = cell(t, 'total')?.repriced ?? 0;
      const opRows = sum(r => ['operation', 'interest'].includes(r.kind));
      const parts = ['total-operating', 'total-cash-oh', 'total-noncash'].reduce((v, k) => v + (cell(t, k)?.repriced ?? 0), 0);
      if (Math.abs(opRows - op) > 1 && opRows > 0) bad.push(`${id}: operating rows ${Math.round(opRows)} vs total ${Math.round(op)}`);
      if (Math.abs(parts - total) > 1) bad.push(`${id}: parts ${Math.round(parts)} vs total ${Math.round(total)}`);
      if (!Number.isFinite(total)) bad.push(`${id}: total is not a number`);
    }
    expect(bad).toEqual([]);
  });
});
