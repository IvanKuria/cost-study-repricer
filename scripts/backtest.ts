/**
 * Back-test: for each commodity with two parsed studies at least five years apart in the same region,
 * reprice the older study to the newer study's reference period and compare per category.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { ParsedStudy } from '../src/data/studySchema';
import { classifyStudy, emptyTotals } from '../src/lib/classify';
import { repriceStudy, referencePeriod, DEFAULT_SETTINGS } from '../src/lib/reprice';
import type { Category } from '../src/lib/types';

const dir = 'data/studies/parsed';
const studies: ParsedStudy[] = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
const usable = studies.filter(s => s.source.language === 'en' && s.costsPerAcre.operations.length > 0 && s.costsPerAcre.totalCost && s.source.year);
const regionKey = (s: ParsedStudy) => (s.source.region ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').filter(w => w.length > 3 && !['valley', 'county', 'counties', 'coast', 'north', 'south', 'central'].includes(w)).sort().join(' ');
const CATS: Category[] = ['labor', 'pesticides', 'fertilizer', 'water', 'pollination', 'custom', 'otherMaterials', 'fuelLubeRepairs', 'operatingInterest', 'cashOverhead', 'nonCashOverhead'];

interface Pair { commodity: string; region: string; oldId: string; newId: string; oldYear: number; newYear: number; errors: Partial<Record<Category | 'total', number>>; }
const pairs: Pair[] = [];
const byKey = new Map<string, ParsedStudy[]>();
for (const s of usable) { const k = `${s.source.commodity}|${regionKey(s)}`; const l = byKey.get(k) ?? []; l.push(s); byKey.set(k, l); }
for (const [k, list] of byKey) {
  list.sort((a, b) => (a.source.year ?? 0) - (b.source.year ?? 0));
  const newest = list.at(-1)!;
  for (const older of list) {
    if ((newest.source.year ?? 0) - (older.source.year ?? 0) < 5) continue;
    const target = referencePeriod(newest, DEFAULT_SETTINGS).period;
    const rate = (newest.assumptions.operatingInterestRatePct?.value ?? null);
    const t = repriceStudy(older, { targetPeriod: target, interestRate: rate != null ? rate / 100 : null });
    // Repriced per-category totals from the repriced table.
    const rep = emptyTotals();
    for (const r of t.rows) {
      if (!['operation', 'overheadItem', 'interest'].includes(r.kind)) continue;
      for (const [col, c] of Object.entries(r.cells)) { if (col === 'total' && Object.keys(r.cells).length > 1) continue; if (c.category && c.repriced != null) rep[c.category] += c.repriced; }
    }
    const actual = classifyStudy(newest).totals;
    const errors: Pair['errors'] = {};
    for (const c of CATS) if (actual[c] > 0) errors[c] = (rep[c] - actual[c]) / actual[c];
    const repTotal = t.summary.totalPerAcreRepriced ?? 0, actTotal = newest.costsPerAcre.totalCost!.value;
    errors.total = (repTotal - actTotal) / actTotal;
    pairs.push({ commodity: older.source.commodity, region: k.split('|')[1], oldId: older.source.id, newId: newest.source.id, oldYear: older.source.year!, newYear: newest.source.year!, errors });
  }
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const medians: Record<string, { medianAbs: number; n: number }> = {};
for (const c of [...CATS, 'total'] as const) { const xs = pairs.map(p => p.errors[c]).filter((x): x is number => x != null && Number.isFinite(x)); medians[c] = { medianAbs: median(xs.map(Math.abs)), n: xs.length }; }
console.log(`${pairs.length} pairs\n`);
console.log('commodity'.padEnd(14), 'years'.padEnd(10), 'total'.padStart(7), ...CATS.map(c => c.slice(0, 7).padStart(8)));
for (const p of pairs.sort((a, b) => a.commodity.localeCompare(b.commodity) || a.oldYear - b.oldYear)) console.log(p.commodity.slice(0, 14).padEnd(14), `${p.oldYear}-${p.newYear}`.padEnd(10), pct(p.errors.total), ...CATS.map(c => pct(p.errors[c])));
console.log('\nmedian absolute error');
for (const [c, m] of Object.entries(medians)) console.log(c.padEnd(18), m.n ? `${(m.medianAbs * 100).toFixed(1)}%` : '-', `(n=${m.n})`);
writeFileSync('data/backtest.json', JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), pairs, medians }, null, 1));
function pct(x: number | undefined) { return x == null || !Number.isFinite(x) ? '-'.padStart(8) : `${(x * 100).toFixed(0)}%`.padStart(8); }
