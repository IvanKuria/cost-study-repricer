import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { DEFAULT_SETTINGS, referencePeriod, repriceStudy } from './reprice';
import type { RepricedTable } from './types';
import { CROP_PRICES } from './cropPrices';

// Guards against the establishment charge silently falling back to the CPI. Every perennial study must land in a
// named bucket, the buckets are snapshotted so any move shows in review, and the recalculation must reproduce each
// study's own printed charge when nothing is repriced.

const load = (id: string) => JSON.parse(readFileSync(`data/studies/parsed/${id}.json`, 'utf8')) as ParsedStudy;
const IDS = readdirSync('data/studies/parsed').filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
const TODAY = { targetPeriod: '2026-07', interestRate: 0.0751, cropPrices: CROP_PRICES };

/** Studies allowed to keep the CPI-scaled printed charge, each with the reason. Adding one needs a reason a reviewer accepts. */
const CPI_ALLOWED: Record<string, string> = {
  'boysenberries-boysenberriesvn02': 'study error: the printed charge is about 1/15 of its own inputs',
  'pasture-pastureep-sv-2015': 'the printed charge implies a 4.75% rate the study never states',
  'lychee-lycheescc02': 'the printed charge implies a 6.5% rate the study never states',
  'pasture-20pasturesnfhestabtillnotill': 'production cost table not parsed, so no row carries the charge',
  'bermudagrass-hay-bermhay04': 'one-page format; production cost table not parsed',
  'bermudagrass-seed-bermseed04': 'one-page format; production cost table not parsed',
  'kleingrass-hay-kleingrass04': 'one-page format; production cost table not parsed',
  'guava-guava-sc07': 'production cost tables not parsed (split text)',
};

/** Studies whose own tables disagree on the charge, so the reproduce and cross-table checks skip them. */
const STUDY_DISCREPANCIES: Record<string, string> = {
  'figs-figcalimyrnasjv05': 'text, Table 1 and the investment table give $3,825 and $238; the production table alone prints $3,864 and $248',
};

const recalculatedRows = (t: RepricedTable) => t.rows.filter(r => Object.values(r.cells).some(c => c.recalculated && /establish/i.test(r.label) && !/share/i.test(r.label)));

type Bucket = 'annual' | 'recalculated' | 'no yearly charge' | 'no establishment cost' | 'cpi';
function bucketOf(s: ParsedStudy): Bucket {
  const es = s.establishmentSummary;
  if (!es?.perennial) return 'annual';
  const prod = repriceStudy(s, { ...TODAY, layout: 'production' });
  if (prod.rows.find(r => r.id === 'nc-establishment')?.cells.total?.recalculated) return 'recalculated';
  if (s.establishment?.table && recalculatedRows(repriceStudy(s, TODAY)).length) return 'recalculated';
  if (es.noYearlyCharge) return 'no yearly charge';
  if (es.status === 'none') return 'no establishment cost';
  return 'cpi';
}

describe('establishment charge coverage', () => {
  const buckets = Object.fromEntries(IDS.map(id => [id, bucketOf(load(id))]));

  it('every study on the CPI fallback has a stated reason', () => {
    const cpi = IDS.filter(id => buckets[id] === 'cpi');
    expect(cpi.filter(id => !CPI_ALLOWED[id]), 'new CPI fallbacks: fix the parse or add a reason to CPI_ALLOWED').toEqual([]);
    expect(Object.keys(CPI_ALLOWED).filter(id => buckets[id] !== 'cpi'), 'these now recalculate; remove them from CPI_ALLOWED').toEqual([]);
  });

  it('studies that charge no yearly establishment cost cite why', () => {
    for (const id of IDS.filter(id => buckets[id] === 'no yearly charge')) expect(load(id).establishmentSummary!.reason, id).toBeTruthy();
  });

  it('bucket list matches the reviewed snapshot (update with `npx vitest -u` after checking the diff)', async () => {
    const grouped: Record<string, string[]> = {};
    for (const id of IDS) (grouped[buckets[id]] ??= []).push(id);
    await expect(JSON.stringify(grouped, null, 2) + '\n').toMatchFileSnapshot('../../data/establishment-buckets.json');
  });

  it('with nothing repriced, every recalculated charge reproduces the study\'s printed charge', () => {
    const misses: string[] = [];
    for (const id of IDS.filter(id => buckets[id] === 'recalculated' && !STUDY_DISCREPANCIES[id])) {
      const s = load(id);
      const printed = s.establishmentSummary!.annualCharge?.value;
      if (printed == null) continue;
      // The study's own month, rate and prices: every factor is 1, so the basis is the study's figure.
      const same = { targetPeriod: referencePeriod(s, DEFAULT_SETTINGS).period };
      const prod = repriceStudy(s, { ...same, layout: 'production' }).rows.find(r => r.id === 'nc-establishment')?.cells.total;
      const est = s.establishment?.table ? recalculatedRows(repriceStudy(s, same)).flatMap(r => Object.values(r.cells).filter(c => c.recalculated)) : [];
      for (const c of [prod, ...est].filter(c => c?.recalculated)) {
        if (Math.abs(c!.repriced! - printed) > Math.max(3, printed * 0.02)) misses.push(`${id}: ${Math.round(c!.repriced!)} vs printed ${printed}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it('both tables carry the same yearly charge after the amortized year', () => {
    const misses: string[] = [];
    for (const id of IDS.filter(id => buckets[id] === 'recalculated' && !STUDY_DISCREPANCIES[id])) {
      const s = load(id);
      const prod = repriceStudy(s, { ...TODAY, layout: 'production' }).rows.find(r => r.id === 'nc-establishment')?.cells.total;
      if (!prod?.recalculated || !s.establishment?.table) continue;
      const printed = s.establishmentSummary!.annualCharge?.value, computed = s.establishmentSummary!.capitalRecovery?.computed;
      for (const c of recalculatedRows(repriceStudy(s, TODAY)).flatMap(r => Object.values(r.cells).filter(c => c.recalculated))) {
        // The table scales the printed (rounded) charge, so allow the study's own rounding.
        const slack = printed && computed ? Math.abs(printed / computed - 1) * prod.repriced! + 1 : 1;
        if (Math.abs(c.repriced! - prod.repriced!) > slack) misses.push(`${id}: table ${Math.round(c.repriced!)} vs production ${Math.round(prod.repriced!)}`);
      }
    }
    expect(misses).toEqual([]);
  });
});

/** Hand-checked against the PDFs: one study per layout. Each figure is the repriced basis x CRF(7.51%, years). */
describe('golden studies, repriced to July 2026 at 7.51%', () => {
  const charge = (id: string) => repriceStudy(load(id), { ...TODAY, layout: 'production' }).rows.find(r => r.id === 'nc-establishment')!;
  it.each([
    ['almonds-2024sacvalleyalmonds7-5-24-final-draft', 'year 3, accumulated net cash cost', 22],
    ['avocados-avocadoconventionalsdr2011', 'year 6, accumulated net cost', 30],
    ['alfalfa-16alfalfasjv300acfinal-41916', 'year 1, total cash cost', 3],
    ['peppermint-oil-peppermintim2011', 'less $1,500 returns', 4],
    ['walnuts-walnutsv2012', 'year', 31],
  ])('%s', (id, words, years) => {
    const r = charge(id);
    expect(r.cells.total.recalculated, id).toBe(true);
    expect(r.sourceNote).toContain(words);
    expect(r.sourceNote).toContain(`CRF(7.51%, interest rate in use, ${years} years)`);
  });
  it('almonds 2024 Sacramento Valley: $15,714 x CRF(7.51%, 22) = $1,481 in both tables', () => {
    expect(charge('almonds-2024sacvalleyalmonds7-5-24-final-draft').cells.total.repriced).toBeCloseTo(1481.25, 0);
    const est = repriceStudy(load('almonds-2024sacvalleyalmonds7-5-24-final-draft'), TODAY);
    expect(est.rows.find(r => /^Establishment Costs/.test(r.label))!.cells.y4.repriced).toBeCloseTo(1481, 0);
  });
});
