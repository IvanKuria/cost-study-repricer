/**
 * Builds src/data/cropPrices.json: USDA NASS California prices received, marketing-year averages, for every series
 * named in src/data/cropPriceMapping.ts. Two sources, same numbers:
 *   CROP_PRICES_TSV=<file>  a tab-separated extract of the Quick Stats bulk crops file (https://www.nass.usda.gov/datasets/)
 *                           with columns SOURCE_DESC, COMMODITY_DESC, UNIT_DESC, SHORT_DESC, YEAR, VALUE
 *   NASS_KEY=<key>          the Quick Stats API, one request per series
 * Withheld or missing values ((D), (NA), (S), (X), (Z)) and prices at or below zero are left out, never filled.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CropPrice } from '../src/lib/types';
import { CROP_PRICE_SERIES } from '../src/data/cropPriceMapping';

const SOURCE = 'USDA NASS Quick Stats, prices received, California, marketing-year average';
const QS = 'https://quickstats.nass.usda.gov/';
const number = (v: string) => { const n = Number(String(v).replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 ? n : null; };
const unitOf = (shortDesc: string) => shortDesc.split('MEASURED IN ')[1] ?? '';

function fromTsv(file: string): CropPrice[] {
  const [head, ...rows] = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => l.split('\t'));
  const col = (name: string) => { const i = head.indexOf(name); if (i < 0) throw new Error(`${file}: no ${name} column`); return i; };
  const [src, com, desc, yr, val] = ['SOURCE_DESC', 'COMMODITY_DESC', 'SHORT_DESC', 'YEAR', 'VALUE'].map(col);
  const wanted = new Set(CROP_PRICE_SERIES);
  const out = new Map<string, CropPrice>();
  for (const r of rows) {
    if (r[src] !== 'SURVEY' || !wanted.has(r[desc])) continue;
    const v = number(r[val]); if (v == null) continue;
    const s = out.get(r[desc]) ?? { id: r[desc], commodity: r[com], unit: unitOf(r[desc]), source: SOURCE, url: QS, values: {} };
    s.values[r[yr]] = v; out.set(r[desc], s);
  }
  return [...out.values()];
}

async function fromApi(key: string): Promise<CropPrice[]> {
  const out: CropPrice[] = [];
  for (const id of CROP_PRICE_SERIES) {
    const url = `${QS}api/api_GET/?key=${key}&short_desc=${encodeURIComponent(id)}&state_alpha=CA&agg_level_desc=STATE&freq_desc=ANNUAL&reference_period_desc=MARKETING%20YEAR&source_desc=SURVEY&format=JSON`;
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn(`  ${id}: HTTP ${res.status}`); continue; }
      const json = await res.json() as { data?: { year: number; commodity_desc: string; Value: string; domain_desc: string }[] };
      const values: Record<string, number> = {};
      let commodity = '';
      for (const r of json.data ?? []) { if (r.domain_desc !== 'TOTAL') continue; const v = number(r.Value); if (v != null) { values[String(r.year)] = v; commodity = r.commodity_desc; } }
      out.push({ id, commodity, unit: unitOf(id), source: `${SOURCE} (pulled live)`, url: QS, values });
    } catch (e) { console.warn(`  ${id}: ${(e as Error).message}`); }
  }
  return out;
}

async function main() {
  const tsv = process.env.CROP_PRICES_TSV, key = process.env.NASS_KEY;
  if (!tsv && !key) throw new Error('Set CROP_PRICES_TSV to a Quick Stats bulk extract or NASS_KEY for the API.');
  const out = tsv ? fromTsv(tsv) : await fromApi(key!);
  const target = resolve('src/data/cropPrices.json');
  // Keep series pulled on an earlier run when this run could not refresh them.
  if (existsSync(target)) for (const p of JSON.parse(readFileSync(target, 'utf8')) as CropPrice[]) {
    if (!out.some(s => s.id === p.id) && CROP_PRICE_SERIES.includes(p.id)) { console.warn(`  keeping previous ${p.id}`); out.push(p); }
  }
  for (const id of CROP_PRICE_SERIES) if (!out.some(s => s.id === id)) console.warn(`  no published values: ${id}`);
  out.sort((a, b) => a.id.localeCompare(b.id));
  for (const s of out) s.values = Object.fromEntries(Object.entries(s.values).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(target, JSON.stringify(out, null, 1));
  for (const s of out) { const ys = Object.keys(s.values); console.log(`${s.id.padEnd(84)} ${ys.length} years, ${ys[0] ?? '-'} .. ${ys.at(-1) ?? '-'}`); }
}
main().catch(e => { console.error(e); process.exit(1); });
