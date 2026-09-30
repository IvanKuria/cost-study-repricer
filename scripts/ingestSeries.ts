/**
 * Builds src/data/series.json from the professor's files (USDA Quick Stats exports, BLS CPI, Kansas
 * City Fed operating loan rate) plus a few Quick Stats series pulled live when NASS_KEY is set in the
 * environment. Nothing is interpolated: a month that is not in a source is not in the output.
 */
import ExcelJS from 'exceljs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Series } from '../src/lib/types';

const DL = process.env.SERIES_DIR ?? '/Users/ivankuria/Downloads';
const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const key = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const finish = (s: Omit<Series, 'lastPeriod'>): Series => ({ ...s, lastPeriod: Object.keys(s.values).sort().at(-1) ?? '' });

function cell(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') { const o = v as { result?: unknown; text?: string; richText?: { text: string }[] }; return String(o.result ?? o.text ?? o.richText?.map(t => t.text).join('') ?? ''); }
  return String(v);
}

async function sheetRows(file: string, sheetName?: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
  if (!ws) throw new Error(`no sheet ${sheetName} in ${file}`);
  const rows: string[][] = [];
  ws.eachRow((row) => { const vals: string[] = []; for (let c = 1; c <= ws.columnCount; c++) vals.push(cell(row.getCell(c).value)); rows.push(vals); });
  return rows;
}

/** Quick Stats export (xlsx or csv): columns Year, Period, Data Item, Value. */
function quickStatsToValues(rows: string[][], dataItemMustInclude: string): { values: Record<string, number>; name: string; periods: Set<string> } {
  const header = rows[0].map(h => h.trim());
  const iy = header.indexOf('Year'), ip = header.indexOf('Period'), id = header.indexOf('Data Item'), iv = header.indexOf('Value');
  if ([iy, ip, id, iv].some(i => i < 0)) throw new Error(`unexpected Quick Stats columns: ${header.join(',')}`);
  const values: Record<string, number> = {}; let name = ''; const periods = new Set<string>();
  for (const r of rows.slice(1)) {
    const item = r[id] ?? '';
    if (!item.includes(dataItemMustInclude)) continue;
    const m = MONTHS[(r[ip] ?? '').toUpperCase()]; const y = Number(r[iy]); const v = Number(String(r[iv]).replace(/,/g, ''));
    if (!m || !y || !Number.isFinite(v)) continue;
    values[key(y, m)] = v; name = item; periods.add(r[ip].toUpperCase());
  }
  return { values, name, periods };
}

function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out.filter(r => r.some(c => c !== ''));
}

async function fetchNass(id: string, commodity: string, shortDescIncludes: string, name: string): Promise<Series | null> {
  const k = process.env.NASS_KEY;
  if (!k) { console.warn(`  skip ${id}: NASS_KEY not set`); return null; }
  const url = `https://quickstats.nass.usda.gov/api/api_GET/?key=${k}&sector_desc=ECONOMICS&group_desc=PRICES%20PAID&commodity_desc=${encodeURIComponent(commodity)}&agg_level_desc=NATIONAL&freq_desc=MONTHLY&format=JSON`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 120000);
      const res = await fetch(url, { signal: ctrl.signal }); clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { data?: { year: string; reference_period_desc: string; short_desc: string; Value: string }[] };
      const values: Record<string, number> = {};
      for (const r of json.data ?? []) {
        if (!r.short_desc.includes(shortDescIncludes)) continue;
        const m = MONTHS[r.reference_period_desc.toUpperCase()]; const v = Number(r.Value.replace(/,/g, ''));
        if (m && Number.isFinite(v)) values[key(Number(r.year), m)] = v;
      }
      if (Object.keys(values).length === 0) { console.warn(`  ${id}: no monthly rows matching "${shortDescIncludes}"`); return null; }
      return finish({ id, name, source: 'USDA NASS Quick Stats, Agricultural Prices, prices paid index (pulled live)', url: url.replace(/key=[^&]+/, 'key=REDACTED'), unit: 'index, 2011 = 100', frequency: 'monthly', values });
    } catch (e) {
      console.warn(`  ${id}: attempt ${attempt} failed: ${(e as Error).message}`);
    }
  }
  return null;
}

async function main() {
  const out: Series[] = [];
  const qs = (file: string) => resolve(DL, file);

  // Fertilizer: CSV export.
  {
    const rows = parseCsv(readFileSync(qs('Price index- Fertilizer.csv'), 'utf8'));
    const { values, name } = quickStatsToValues(rows, 'INDEX FOR PRICE PAID, 2011');
    out.push(finish({ id: 'nass.fertilizer', name, source: 'USDA NASS Quick Stats, Agricultural Prices (professor\'s export)', url: 'https://quickstats.nass.usda.gov/', unit: 'index, 2011 = 100', frequency: 'monthly', values }));
  }
  for (const [id, file, freq] of [['nass.fuels', 'Price index- Fuel.xlsx', 'monthly'], ['nass.labor', 'Price index- Labor.xlsx', 'monthly'], ['nass.chemicals', 'Price index- Chemicals.xlsx', 'quarterly']] as const) {
    const rows = await sheetRows(qs(file));
    const { values, name, periods } = quickStatsToValues(rows, 'INDEX FOR PRICE PAID, 2011');
    const frequency = periods.size <= 4 ? 'quarterly' : freq;
    out.push(finish({ id, name, source: 'USDA NASS Quick Stats, Agricultural Prices (professor\'s export)', url: 'https://quickstats.nass.usda.gov/', unit: 'index, 2011 = 100', frequency, values }));
  }
  // CPI, all urban consumers, seasonally adjusted (CUSR0000SA0).
  {
    const rows = await sheetRows(qs('Inputs data.xlsx'), 'CPI- all urban consumers');
    const values: Record<string, number> = {};
    for (const r of rows.slice(1)) { const y = Number(r[2]), m = Number(r[3]), v = Number(r[4]); if (r[0] === 'CUSR0000SA0' && y && m && Number.isFinite(v)) values[key(y, m)] = v; }
    out.push(finish({ id: 'bls.cpi', name: 'CPI-U, all items, U.S. city average, seasonally adjusted (CUSR0000SA0)', source: 'U.S. Bureau of Labor Statistics via the professor\'s Inputs data workbook', url: 'https://data.bls.gov/timeseries/CUSR0000SA0', unit: 'index, 1982-84 = 100', frequency: 'monthly', values }));
  }
  // Kansas City Fed agricultural operating loan rate, quarterly, stored at the quarter-end month.
  {
    const rows = await sheetRows(qs('Inputs data.xlsx'), '15- agr interest');
    const values: Record<string, number> = {};
    for (const r of rows.slice(1)) { const d = new Date(r[0]); const v = Number(r[1]); if (!isNaN(d.getTime()) && Number.isFinite(v)) values[key(d.getUTCFullYear(), d.getUTCMonth() + 1)] = v; }
    out.push(finish({ id: 'kcfed.operatingRate', name: 'Agricultural interest rate on operating loans, Tenth District, quarterly average', source: 'Federal Reserve Bank of Kansas City, Agricultural Finance Databook, via the professor\'s Inputs data workbook', url: 'https://www.kansascityfed.org/agriculture/agfinance-updates/', unit: 'fraction per year', frequency: 'quarterly', values }));
  }
  // Live Quick Stats pulls.
  const live: [string, string, string, string][] = [
    ['nass.machinery', 'MACHINERY TOTALS', 'INDEX FOR PRICE PAID, 2011', 'MACHINERY TOTALS - INDEX FOR PRICE PAID, 2011'],
    ['nass.repairs', 'REPAIRS', 'INDEX FOR PRICE PAID, 2011', 'REPAIRS - INDEX FOR PRICE PAID, 2011'],
    ['nass.agServices', 'AG SERVICES & RENT', 'INDEX FOR PRICE PAID, 2011', 'AG SERVICES & RENT - INDEX FOR PRICE PAID, 2011'],
    ['nass.seeds', 'SEEDS & PLANTS TOTALS', 'INDEX FOR PRICE PAID, 2011', 'SEEDS & PLANTS TOTALS - INDEX FOR PRICE PAID, 2011'],
  ];
  for (const [id, commodity, inc, name] of live) {
    console.log(`fetching ${id} ...`);
    let s = await fetchNass(id, commodity, inc, name);
    if (!s && id === 'nass.repairs') { console.log('  trying SUPPLIES & REPAIRS'); s = await fetchNass(id, 'SUPPLIES & REPAIRS', inc, 'SUPPLIES & REPAIRS - INDEX FOR PRICE PAID, 2011'); }
    if (s) out.push(s);
  }
  const target = resolve('src/data/series.json');
  // Keep previously pulled live series when this run could not fetch them, so a missing key never erases data.
  if (existsSync(target)) {
    const prev = JSON.parse(readFileSync(target, 'utf8')) as Series[];
    for (const p of prev) if (!out.some(s => s.id === p.id)) { console.warn(`  keeping previous ${p.id} (not refreshed this run)`); out.push(p); }
  }
  writeFileSync(target, JSON.stringify(out, null, 1));
  for (const s of out) console.log(`${s.id.padEnd(22)} ${s.frequency.padEnd(9)} ${Object.keys(s.values).length} periods, ${Object.keys(s.values).sort()[0]} .. ${s.lastPeriod}`);
}
main().catch(e => { console.error(e); process.exit(1); });
