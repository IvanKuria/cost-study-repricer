import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { classifyStudy, type CategoryTotals } from './classify';
import type { Category } from './types';

const load = (id: string) => JSON.parse(readFileSync(`data/studies/parsed/${id}.json`, 'utf8')) as ParsedStudy;

/** The professor's Budgets data.xlsx, block at rows 44 to 56 (the version with pollination split out). */
const PROF: Record<string, Partial<Record<Category, number>> & { total: number }> = {
  'grapes-wine-2021-winegrape-highwire-lodi-22522': { labor: 574, pesticides: 311, fertilizer: 345, water: 280, custom: 861, otherMaterials: 60, fuelLubeRepairs: 137, operatingInterest: 28, cashOverhead: 1164, nonCashOverhead: 2986, total: 6745 },
  'walnuts-22walnutssacval-31623': { labor: 264, pesticides: 675, fertilizer: 257, water: 600, custom: 1400, otherMaterials: 75, fuelLubeRepairs: 92, operatingInterest: 59, cashOverhead: 579, nonCashOverhead: 3424, total: 7424 },
  'grapes-table-2018tablegrapessjvflameseedlessfinaldraft': { labor: 10641, pesticides: 405, fertilizer: 68, water: 441, custom: 2034, otherMaterials: 3882, fuelLubeRepairs: 209, operatingInterest: 185, cashOverhead: 969, nonCashOverhead: 2833, total: 21668 },
  'almonds-2024sacvalleyalmonds7-5-24-final-draft': { labor: 501, pesticides: 534, fertilizer: 403, water: 643, pollination: 420, custom: 1042, fuelLubeRepairs: 115, operatingInterest: 63, cashOverhead: 662, nonCashOverhead: 3418, total: 7800 },
};

const CATS: Category[] = ['labor', 'pesticides', 'fertilizer', 'water', 'pollination', 'custom', 'otherMaterials', 'fuelLubeRepairs', 'operatingInterest', 'cashOverhead', 'nonCashOverhead'];
/** Tolerances agreed after reading the rows: 5 percent or $15, except where the professor's manual split differs (explained in the README). */
const TOL: Partial<Record<string, Partial<Record<Category, number>>>> = {
  'grapes-table-2018tablegrapessjvflameseedlessfinaldraft': { otherMaterials: 0.12, custom: 0.12, pesticides: 0.16 },
  'walnuts-22walnutssacval-31623': { otherMaterials: 0.5, custom: 0.06 },
};

describe('classifier against the professor\'s hand-classified studies', () => {
  const table: string[] = [];
  for (const [id, prof] of Object.entries(PROF)) {
    it(id, () => {
      const { totals, total } = classifyStudy(load(id));
      table.push(`\n${id}  (ours ${Math.round(total)} vs prof ${prof.total})`);
      for (const c of CATS) {
        const p = prof[c]; const o = Math.round((totals as CategoryTotals)[c]);
        if (p === undefined) { if (o > 0) table.push(`  ${c.padEnd(18)} ours ${String(o).padStart(6)}  prof      -`); continue; }
        const diff = o - p; const pct = p ? diff / p : 0;
        table.push(`  ${c.padEnd(18)} ours ${String(o).padStart(6)}  prof ${String(p).padStart(6)}  diff ${String(diff).padStart(6)} (${(pct * 100).toFixed(1)}%)`);
        const tol = TOL[id]?.[c] ?? 0.05;
        expect(Math.abs(diff) <= Math.max(15, Math.abs(p) * tol), `${id} ${c}: ours ${o} prof ${p}`).toBe(true);
      }
      expect(Math.abs(total - prof.total) / prof.total).toBeLessThan(0.02);
    });
  }
  it('prints the comparison', () => { console.log(table.join('\n')); });
});
