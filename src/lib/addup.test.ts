import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { DEFAULT_SETTINGS, referencePeriod, repriceStudy } from './reprice';
import type { RepricedRow, RepricedTable } from './types';
import { CROP_PRICES } from './cropPrices';

// Every total is the repriced sum of what it totals: a section's items add to its subtotal, and the higher totals follow
// their parts (operating + cash overhead = cash, cash + non-cash = total). Checked wherever the study's own printed parts
// add up to its printed total, so a total the study itself mis-adds is not held to its parts.

const load = (id: string) => JSON.parse(readFileSync(`data/studies/parsed/${id}.json`, 'utf8')) as ParsedStudy;
const IDS = readdirSync('data/studies/parsed').filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
const TODAY = { targetPeriod: '2026-07', interestRate: 0.0751, cropPrices: CROP_PRICES };

/** Studies whose printed parts don't add up to a total in a way the walk cannot tell from a parse error (cite page). */
const ADDUP_EXCEPTIONS: Record<string, string> = {};

const sum = (rs: RepricedRow[], k: string, f: 'original' | 'repriced') => rs.reduce((s, r) => s + (r.cells[k]?.[f] ?? 0), 0);

/** Each total against its parts, where the printed parts add up to the printed total. */
export function addupMisses(t: RepricedTable): string[] {
  const out: string[] = [];
  const check = (what: string, total: RepricedRow, parts: RepricedRow[]) => {
    for (const c of t.columns) {
      const o = total.cells[c.key]?.original;
      if (o == null || !parts.length || Math.abs(sum(parts, c.key, 'original') - o) > 2) continue;
      const rep = total.cells[c.key]?.repriced ?? 0, items = sum(parts, c.key, 'repriced');
      if (Math.abs(items - rep) > Math.max(3, Math.abs(rep) * 0.01)) out.push(`${t.studyId} ${t.layout} ${what} ${total.label} ${c.label}: parts ${Math.round(items)} vs total ${Math.round(rep)} (printed ${o})`);
    }
  };
  // Section walk: the items since the last heading, at each subtotal or total.
  let items: RepricedRow[] = [];
  for (const r of t.rows) {
    if (r.kind === 'heading') items = [];
    else if (r.kind === 'operation' || r.kind === 'overheadItem') items.push(r);
    else if (r.kind === 'subtotal' || r.kind === 'total') { check('items', r, items); items = []; }
  }
  // Higher totals.
  const last = (key: RepricedRow['totalKey'] | string, before: number) => t.rows.slice(0, before).findLast(r => (t.layout === 'production' ? r.id : r.totalKey) === key);
  t.rows.forEach((r, i) => {
    const key = t.layout === 'production' ? r.id : r.totalKey;
    // The part totals, and any lines printed after them (a study with no cash overhead total: 2000 peaches).
    const parts = (ks: string[]) => {
      const found = ks.map(k => last(k, i)).filter((x): x is RepricedRow => !!x);
      const from = Math.max(-1, ...found.map(x => t.rows.indexOf(x)));
      return [...found, ...(from < 0 ? [] : t.rows.slice(from + 1, i).filter(x => x.kind === 'operation' || x.kind === 'overheadItem' || x.kind === 'interest'))];
    };
    if (key === 'cash' || key === 'total-cash') check('cash', r, parts(t.layout === 'production' ? ['total-operating', 'total-cash-oh'] : ['operating', 'cashOh']));
    if (key === 'total') check('total', r, parts(t.layout === 'production' ? ['total-cash', 'total-noncash'] : ['cash', 'noncash']));
  });
  return out;
}

describe('every total adds up to its parts', () => {
  const run = (set: (s: ParsedStudy) => object) => IDS.flatMap(id => {
    if (ADDUP_EXCEPTIONS[id]) return [];
    const s = load(id);
    return (['production', 'establishment'] as const).flatMap(layout => layout === 'establishment' && !s.establishment?.table ? [] : addupMisses(repriceStudy(s, { ...set(s), layout } as never)));
  });
  it('repriced to July 2026', () => { const m = run(() => TODAY); expect(m, m.join('\n')).toEqual([]); });
  it('at the study\'s own month', () => { const m = run(s => ({ targetPeriod: referencePeriod(s, DEFAULT_SETTINGS).period })); expect(m, m.join('\n')).toEqual([]); });
  it('every exception is a study', () => expect(Object.keys(ADDUP_EXCEPTIONS).filter(id => !IDS.includes(id))).toEqual([]));
  it('no total or yield line is ever an item, in either layout', () => {
    const LINE = /^TOTAL\b|\bTOTAL(?:ES)?:?$|\bYIELD\b|\b(?:TONS|POUNDS|LBS?\.?|CARTONS|BOXES|BINS)\s+PER\s+ACRE\b|\bLIBRAS\s+POR\s+ACRE\b|\(in\s*Cartons?\)/i;
    const bad = IDS.flatMap(id => {
      const s = load(id);
      return (['production', 'establishment'] as const).flatMap(layout => layout === 'establishment' && !s.establishment?.table ? [] : repriceStudy(s, { ...TODAY, layout } as never).rows
        .filter(r => (r.kind === 'operation' || r.kind === 'overheadItem') && LINE.test(r.label)).map(r => `${id} ${layout}: ${r.label}`));
    });
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
