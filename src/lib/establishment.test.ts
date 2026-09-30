import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { repriceStudy } from './reprice';
import { SERIES } from './series';
import { peakCash } from './exportShared';
import type { RepricedTable } from './types';

const load = (id: string) => JSON.parse(readFileSync(`data/studies/parsed/${id}.json`, 'utf8')) as ParsedStudy;
const almond = load('almonds-2024-almondssjvsouth-final-draft-8-3-25');
const cell = (table: RepricedTable, label: string, col = 'y1') => table.rows.find(r => r.label === label)!.cells[col];
const samePeriod = { targetPeriod: '2024-06' };
const labels = { op: 'TOTAL OPERATING COSTS/ACRE', cash: 'TOTAL CASH COSTS/ACRE', net: 'NET CASH COSTS/ACRE FOR THE YEAR', acc: 'ACCUMULATED NET CASH COSTS/ACRE', total: 'TOTAL COST/ACRE FOR THE YEAR', accTotal: 'TOTAL ACCUMULATED NET COST/ACRE' };

describe('real establishment tables', () => {
  it('uses the general index when a category series is absent, without inventing costs for empty source cells', () => {
    const t = repriceStudy(almond, { targetPeriod: '2026-07' }, SERIES.filter(s => s.id !== 'nass.fertilizer'));
    const row = t.rows.find(r => r.label === 'Fertilize: CAN-17 & KTS (2x)')!;
    expect(row.cells.y1.original).toBe(32);
    expect(row.cells.y1.seriesId).toBe('bls.cpi');
    expect(row.cells.y1.repriced).toBeCloseTo(32 * row.cells.y1.indexTo! / row.cells.y1.indexFrom!, 7);
    expect(row.cells.y1.note).toContain('nass.fertilizer unavailable, bls.cpi used');
    expect(row.cells.y3.original).toBeNull();
    expect(row.cells.y3.repriced).toBeNull();
  });
  it('renders the parser contract, including every source row, year and yield column', () => {
    const t = repriceStudy(almond, samePeriod);
    expect(t.layout).toBe('establishment');
    expect(t.title).toBe(almond.establishment!.table!.title);
    expect(t.columns.map(c => c.label)).toEqual(['1st', '2nd', '3rd', '4th', '5th']);
    expect(t.rows.map(r => r.label)).toEqual(almond.establishment!.table!.rows.map(r => r.label));
    expect(t.yieldRow?.values).toEqual([null, null, 600, 1200, 2400]);
    expect(peakCash(t)).toEqual({ value: 21454, column: '5th' });
    expect(t.summary.totalPerAcreOriginal).toBe(9349); // annual cost, not accumulated net cost
    expect(t.summary.cashPerAcreRepriced).toBe(5516);
  });

  it.each([
    ['almonds-2024-almondssjvsouth-final-draft-8-3-25', '2024-06'],
    ['grapes-wine-2021-grapewinelodi-22522', '2021-06'],
    ['walnuts-23walnutssacval-final-3-26-24', '2023-06'],
  ])('preserves every printed value at unchanged prices and interest: %s', (id, period) => {
    const t = repriceStudy(load(id), { targetPeriod: period });
    for (const row of t.rows) for (const c of Object.values(row.cells)) {
      if (c.original === null) expect(c.repriced, row.label).toBeNull();
      else expect(c.repriced, row.label).toBeCloseTo(c.original, 7);
    }
  });

  it('factor edits flow through interest and accumulated costs just like the equivalent cost edit', () => {
    const base = repriceStudy(almond, samePeriod);
    const row = base.rows.find(r => r.label === 'Tree Removal')!;
    const key = `${row.id}:y1`;
    const factored = repriceStudy(almond, { ...samePeriod, factorOverrides: { [key]: 1.25 }, summaryColumn: 'y1' });
    const direct = repriceStudy(almond, { ...samePeriod, overrides: { [key]: row.cells.y1.original! * 1.25 }, summaryColumn: 'y1' });
    for (const label of Object.values(labels)) for (const col of base.columns) expect(cell(factored, label, col.key).repriced).toBe(cell(direct, label, col.key).repriced);
    expect(factored.summary.totalPerAcreRepriced).toBe(Math.round(cell(factored, labels.total).repriced!));
  });
  it('a first-year edit flows once into annual cash, interest and every later accumulated column', () => {
    const base = repriceStudy(almond, samePeriod);
    const op = base.rows.find(r => r.label === 'Tree Removal')!;
    const edited = repriceStudy(almond, { ...samePeriod, overrides: { [`${op.id}:y1`]: 2600 } });
    const interest = base.rows.find(r => r.kind === 'interest')!;
    const extraInterest = cell(edited, interest.label).repriced! - cell(base, interest.label).repriced!;
    const delta = 1000 + extraInterest;
    for (const label of [labels.op, labels.cash, labels.net, labels.total]) {
      expect(cell(edited, label).repriced! - cell(base, label).repriced!).toBeCloseTo(delta, 7);
      expect(cell(edited, label, 'y2').repriced).toBe(cell(base, label, 'y2').repriced);
    }
    for (const c of base.columns) for (const label of [labels.acc, labels.accTotal]) {
      expect(cell(edited, label, c.key).repriced! - cell(base, label, c.key).repriced!).toBeCloseTo(delta, 7);
    }
    expect(cell(edited, op.label).original).toBe(1600);
  });

  it('keeps both printed income rows synchronized and subtracts revenue from cash need', () => {
    const base = repriceStudy(almond, samePeriod);
    const t = repriceStudy(almond, { ...samePeriod, overrides: { 'income:y3': 1960 } });
    for (const r of t.rows.filter(r => r.kind === 'returns')) expect(r.cells.y3.repriced).toBe(1960);
    expect(cell(t, labels.net, 'y3').repriced).toBe(1697);
    for (const c of ['y3', 'y4', 'y5']) expect(cell(t, labels.acc, c).repriced).toBe(cell(base, labels.acc, c).repriced! - 1000);
    expect(cell(t, labels.total, 'y3').repriced).toBe(cell(base, labels.total, 'y3').repriced);
  });

  it('uses price times each printed yield and supports a zero sale price', () => {
    const t = repriceStudy(almond, { ...samePeriod, pricePerUnit: 2 });
    const income = t.rows.find(r => r.kind === 'returns')!;
    expect(income.cells.y3.repriced).toBe(1200);
    expect(income.cells.y5.repriced).toBe(4800);
    expect(t.yieldRow?.label).toContain('$2.00');
    expect(repriceStudy(almond, { ...samePeriod, pricePerUnit: 0 }).rows.find(r => r.kind === 'returns')!.cells.y3.repriced).toBe(0);
  });

  it('scales interest by the printed rate without applying a price index', () => {
    const base = repriceStudy(almond, samePeriod);
    const half = repriceStudy(almond, { ...samePeriod, interestRate: 0.045 });
    const a = base.rows.find(r => r.kind === 'interest')!, b = half.rows.find(r => r.kind === 'interest')!;
    expect(b.displayLabel).toContain('4.50%');
    expect(b.label).toContain('9.00%');
    for (const col of base.columns) {
      expect(b.cells[col.key].repriced).toBe(a.cells[col.key].repriced! / 2);
      expect(b.cells[col.key].seriesId).toBeNull();
    }
  });

  it('still exposes the production table and its printed heading', () => {
    const t = repriceStudy(almond, { ...samePeriod, layout: 'production' });
    expect(t.layout).toBe('production');
    expect(t.title).toBe(almond.costsPerAcre.title);
    expect(t.columns.some(c => c.key === 'labor')).toBe(true);
  });

  it('keeps orange income out of overhead and carries income changes into accumulated cash costs', () => {
    const s = load('oranges-2021orangessjvsouth');
    const base = repriceStudy(s, { targetPeriod: '2021-06' });
    const t = repriceStudy(s, { targetPeriod: '2021-06', overrides: { 'income:y5': 5343 } });
    expect(t.rows.filter(r => r.kind === 'returns')).toHaveLength(2);
    expect(cell(t, 'TOTAL CASH COSTS', 'y5').repriced).toBe(4290);
    expect(cell(t, 'TOTAL ACCUMULATED NET CASH COSTS', 'y5').repriced).toBe(cell(base, 'TOTAL ACCUMULATED NET CASH COSTS', 'y5').repriced! - 1000);
  });

  it('all parsed establishment tables produce finite cells without dropping source rows', () => {
    for (const file of readdirSync('data/studies/parsed')) {
      const s = load(file.replace('.json', ''));
      if (!s.establishment?.table) continue;
      const t = repriceStudy(s, { targetPeriod: '2026-07', interestRate: 0.0751 });
      expect(t.rows.length, file).toBe(s.establishment.table.rows.length);
      const unchanged = repriceStudy(s, { targetPeriod: `${s.source.year}-06` });
      for (const row of unchanged.rows) for (const c of Object.values(row.cells)) expect(c.repriced ?? 0, `${file}: ${row.label}`).toBeCloseTo(c.original ?? 0, 6);
      for (const r of t.rows) for (const c of Object.values(r.cells)) {
        expect(c.repriced === null || Number.isFinite(c.repriced), `${file}: ${r.label}`).toBe(true);
        if ((s.source.year ?? 0) >= 2010 && ['operation', 'overheadItem'].includes(r.kind) && c.original != null) {
          expect(c.seriesId, `${file}: ${r.label} must have category or general-index coverage`).toBeTruthy();
          expect(c.repriced).not.toBeNull();
        }
      }
    }
  });
});
