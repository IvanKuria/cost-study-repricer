import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { DEFAULT_SETTINGS, referencePeriod, repriceStudy } from './reprice';
import { summaryFigures } from './summary';
import type { RepricedTable } from './types';
import { CROP_PRICES } from './cropPrices';

// The establishment table's net rows are computed from its income and cost totals, so after repricing each still equals
// income less cost, and the summary's net equals its gross less its cost. At the study's own month they reproduce the
// study, except where the study's own figures disagree; those carry a note saying so and are listed here.

const load = (id: string) => JSON.parse(readFileSync(`data/studies/parsed/${id}.json`, 'utf8')) as ParsedStudy;
const IDS = readdirSync('data/studies/parsed').filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
const TODAY = { targetPeriod: '2026-07', interestRate: 0.0751, cropPrices: CROP_PRICES };
const own = (s: ParsedStudy) => ({ targetPeriod: referencePeriod(s, DEFAULT_SETTINGS).period });
const EST = IDS.filter(id => load(id).establishment?.table);

/** Studies whose printed establishment net rows disagree with their own costs and income, checked against the PDF (page,
 *  figures). Their rows show the computed figure and the table says why. Adding one needs a reason a reviewer accepts. */
const NET_DISCREPANCIES: Record<string, string> = {
  'almonds-16almondsacvalfinaldraft81216': 'p14 prints the 1st and 2nd year NET CASH COSTS and TOTAL NET COST blank; those years cost $3,204 and $877 cash, $3,952 and $1,629 in all, with no income',
  'blackberries-blackberrycc2013': 'p12 PROFIT/ACRE ABOVE CASH COSTS prints 15,906 in the last year; income 56,000 less cash costs 40,165 is 15,835',
  'boysenberries-boysenberriesvn02': 'p11 NET CASH COSTS prints 9,445 in the 2nd year, the cash cost before its 9,621 income, and the total section prints the 176 cash profit as INCOME, so TOTAL NET COST 9,685; 9,861 less 9,621 is 240',
  'christmas-trees-christmastreesn2005': 'p29 TOTAL NET COST/ACRE FOR THE YEAR and its accumulated row print no 1st year; that year costs 3,742 with no income',
  'citrus-blood-orange-bloodorangevs02': 'p13 PROFIT ABOVE CASH COSTS is blank in the 4th year (1,888 less 1,784 is 104) and prints 219 in the 5th; 6,176 less 3,454 is 2,722, as its accumulated net cash cost (3,895 to 1,173) has it',
  'citrus-minneola-minneolovs02': 'p13 cash section income is $8 a carton (204 and 305 cartons: 1,632, 2,440); the text (p7, "$13 per carton") and the p14 total section use $13 (2,652, 3,965)',
  'citrus-pummelos-pummelosjv02': 'p13 total section prints 3rd-year income 665; 95 cartons at the $10.00 the text and the p12 cash section use is 950',
  'grapes-table-2018tablegrapessjvautumnkingfinaldraft': 'p15 prints the 3rd year cash shortfall (11,771 less 10,200 income, 1,571) as PROFIT/ACRE ABOVE CASH COSTS and 0 net cash cost; its accumulated net cash cost adds it as a cost (15,562 to 17,133)',
  'grapes-wine-2021-grapewinelodi-22522': 'p16 TOTAL COST/ACRE prints 7,107 in the 2nd year, but cash 5,978 plus non-cash 1,158 is the 7,136 its TOTAL NET COST prints; the total row keeps its printed figure, so the net row follows it',
  'pecans-pecansjv2005': 'p12 non-cash section leaves INCOME/ACRE FROM PRODUCTION blank, so TOTAL NET COST equals total cost (1,538, 1,722); p11 prints income of 96 and 360 those years',
  'walnuts-18walnutssacval-final-draft-11518': 'p14 prints the 7th year 252 (total cost 5,252 less income 5,000) as NET PROFIT/ACRE ABOVE TOTAL COST, and its accumulated net cost falls by it (21,823 to 21,571); it is a net cost',
};

const MISS_NOTE = /the printed figure is not|prints another income/;

/** Each net row cell against its income less its cost total, read from the same repriced table. */
function netMisses(t: RepricedTable): string[] {
  const out: string[] = [];
  t.rows.forEach((r, i) => {
    if (!r.net) return;
    const before = t.rows.slice(0, i);
    for (const c of t.columns) {
      const at = (x: typeof r | undefined) => x?.cells[c.key]?.repriced ?? null;
      const last = (k: string) => before.findLast(x => x.totalKey === k);
      const cost = r.net.basis === 'total' && !last('total') ? (last('cash') || last('noncash') ? (at(last('cash')) ?? 0) + (at(last('noncash')) ?? 0) : null) : at(last(r.net.basis));
      const income = t.rows.find(x => x.kind === 'returns' && at(x) != null);
      const x = (r.net.profit ? -1 : 1) * ((cost ?? 0) - (at(income) ?? 0)), v = at(r);
      if (v == null) {
        // Blank: the other side of a clamped year, a year the paired row shows, or a year with no figures.
        const mate = t.rows.some(m => m !== r && m.net && m.section === r.section && m.net.profit !== r.net!.profit && at(m) != null);
        if (!(r.net.clamped && x <= 0.5) && !mate && !(cost == null && !income)) out.push(`${t.studyId} ${r.label} ${c.label}: blank, expected ${Math.round(x)}`);
      } else if (Math.abs(v - (r.net.clamped ? Math.max(0, x) : x)) > 0.5) out.push(`${t.studyId} ${r.label} ${c.label}: ${Math.round(v)}, expected ${Math.round(x)}`);
    }
  });
  return out;
}

describe('establishment net rows', () => {
  it('after repricing, every net row is its income less its cost total in each year', () => {
    const m = EST.flatMap(id => netMisses(repriceStudy(load(id), { ...TODAY, layout: "establishment" }))); expect(m, m.join("\n")).toEqual([]);
  });

  it('at the study\'s own month, every net row is its income less its cost total in each year', () => {
    expect(EST.flatMap(id => netMisses(repriceStudy(load(id), { ...own(load(id)), layout: 'establishment' })))).toEqual([]);
  });

  it('at the study\'s own month, the net rows reproduce the printed figures, unless the study is listed and its table says why', () => {
    const misses: string[] = [];
    for (const id of EST) {
      const t = repriceStudy(load(id), { ...own(load(id)), layout: 'establishment' });
      const noted = (t.notes ?? []).some(n => MISS_NOTE.test(n));
      if (NET_DISCREPANCIES[id]) { if (!noted) misses.push(`${id}: listed, but its table carries no discrepancy note`); continue; }
      for (const r of t.rows.filter(r => r.net)) for (const c of t.columns) {
        const { original: o, repriced: v } = r.cells[c.key] ?? {};
        if ((o ?? 0) === 0 && (v ?? 0) === 0) continue;
        if (o == null || v == null || Math.abs(o - v) > 2) misses.push(`${id} ${r.label} ${c.label}: printed ${o}, computed ${v == null ? v : Math.round(v)}`);
      }
      if (noted) misses.push(`${id}: notes a discrepancy but is not listed in NET_DISCREPANCIES`);
    }
    expect(misses, misses.join('\n')).toEqual([]);
  });

  it('every listed discrepancy is still an establishment study', () => {
    expect(Object.keys(NET_DISCREPANCIES).filter(id => !EST.includes(id))).toEqual([]);
  });
});

describe('summary figures', () => {
  // Net is gross less cost within $1, and present whenever both are. The study values (original) are the printed figures,
  // so a listed study's may not add up.
  const misses = (id: string, set: object, layout: 'production' | 'establishment') => {
    const t = repriceStudy(load(id), { ...set, layout } as never), f = summaryFigures(t), out: string[] = [];
    for (const k of ['repriced', 'original'] as const) {
      if (k === 'original' && NET_DISCREPANCIES[id]) continue;
      const n = f.net[k], g = f.gross[k], c = f.cost[k];
      if (n != null && (c == null || Math.abs(n - ((g ?? 0) - c)) > 1)) out.push(`${id} ${layout} ${k}: net ${n} != ${g} - ${c}`);
      if (n == null && g != null && c != null) out.push(`${id} ${layout} ${k}: no net with gross ${g} and cost ${c}`);
    }
    return out;
  };
  it.each([['own month', null], ['July 2026', TODAY]] as const)('net = gross - cost, both layouts, at the %s', (_, set) => {
    const all = IDS.flatMap(id => (['production', 'establishment'] as const).flatMap(l => l === 'establishment' && !EST.includes(id) ? [] : misses(id, set ?? own(load(id)), l)));
    expect(all, all.join('\n')).toEqual([]);
  });
});
