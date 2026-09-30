import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { repriceStudy, referencePeriod, DEFAULT_SETTINGS } from './reprice';
import { SERIES, latestPeriod, lookup, seriesById } from './series';

const load = (id: string) => JSON.parse(readFileSync(`data/studies/parsed/${id}.json`, 'utf8')) as ParsedStudy;
const ALMOND = 'almonds-2024sacvalleyalmonds7-5-24-final-draft';

describe('series', () => {
  it('loads the professor\'s series with 2011 = 100 bases and the CPI', () => {
    for (const id of ['nass.fertilizer', 'nass.fuels', 'nass.labor', 'nass.chemicals', 'bls.cpi', 'kcfed.operatingRate']) expect(seriesById(id), id).toBeTruthy();
    expect(seriesById('nass.fertilizer')!.values['2011-06']).toBeGreaterThan(80);
  });
  it('uses the nearest earlier period when a month is missing', () => {
    const rate = seriesById('kcfed.operatingRate')!; // quarterly, stored at quarter-end months
    const l = lookup(rate, '2025-11'); expect(l).toBeTruthy(); expect(l!.exact).toBe(false); expect(l!.period).toBe('2025-09');
    expect(lookup(rate, '2000-01')).toBeNull();
  });
});

describe('repricing', () => {
  const study = load(ALMOND);
  study.establishment = null; // These tests exercise the production table.
  it('applies an exact factor, updates component totals, accepts zero and restores the automatic index', () => {
    const base = repriceStudy(study);
    const row = base.rows.find(r => r.label.startsWith('Fertigate: UAN32'))!;
    const key = `${row.id}:materials`;
    for (const factor of [1.234567, 0]) {
      const edited = repriceStudy(study, { factorOverrides: { [key]: factor } });
      const current = edited.rows.find(r => r.id === row.id)!;
      expect(current.cells.materials.repriced).toBeCloseTo(row.cells.materials.original! * factor, 8);
      expect(current.cells.materials.factorOverridden).toBe(true);
      expect(current.cells.total.repriced).toBeCloseTo(['labor', 'materials', 'custom', 'fuelLubeRepairs'].reduce((sum, k) => sum + (current.cells[k].repriced ?? 0), 0), 8);
      expect(current.cells.total.factor).toBeCloseTo(current.cells.total.repriced! / current.cells.total.original!, 8);
    }
    const reset = repriceStudy(study, { factorOverrides: {} });
    expect(reset.rows.find(r => r.id === row.id)!.cells.materials.repriced).toBe(row.cells.materials.repriced);
    for (const factor of [-1, NaN, Infinity]) expect(repriceStudy(study, { factorOverrides: { [key]: factor } }).rows.find(r => r.id === row.id)!.cells.materials.repriced).toBe(row.cells.materials.repriced);
  });
  it('reference period is June of the study year', () => {
    expect(referencePeriod(study, DEFAULT_SETTINGS).period).toBe('2024-06');
  });
  it('applies original x index(target) / index(reference) on a fertilizer cell', () => {
    const t = repriceStudy(study);
    const fert = seriesById('nass.fertilizer')!;
    const row = t.rows.find(r => r.label.startsWith('Fertigate: UAN32'))!;
    const c = row.cells.materials;
    expect(c.seriesId).toBe('nass.fertilizer');
    const from = lookup(fert, '2024-06')!.value, to = lookup(fert, t.targetPeriod)!.value;
    expect(c.factor).toBeCloseTo(to / from, 6);
    expect(c.repriced).toBeCloseTo((c.original as number) * to / from, 6);
    expect(t.targetPeriod).toBe(latestPeriod(SERIES));
  });
  it('totals reconcile: operation rows sum to the operating total, and the grand total is operating + cash + non-cash', () => {
    const t = repriceStudy(study);
    const ops = t.rows.filter(r => r.kind === 'operation');
    const interest = t.rows.find(r => r.id === 'interest');
    const op = t.rows.find(r => r.id === 'total-operating')!;
    const sumOrig = ops.reduce((s, r) => s + (r.cells.total.original ?? 0), 0) + (interest?.cells.total.original ?? 0);
    expect(op.cells.total.original).toBeCloseTo(sumOrig, 6);
    expect(Math.round(op.cells.total.original as number)).toBe(study.costsPerAcre.operatingTotal!.value);
    const sumRep = ops.reduce((s, r) => s + (r.cells.total.repriced ?? 0), 0) + (interest?.cells.total.repriced ?? 0);
    expect(op.cells.total.repriced).toBeCloseTo(sumRep, 6);
    const total = t.rows.find(r => r.id === 'total')!;
    expect(Math.round(total.cells.total.original as number)).toBe(study.costsPerAcre.totalCost!.value);
    const cash = t.rows.find(r => r.id === 'total-cash-oh')!, nc = t.rows.find(r => r.id === 'total-noncash')!;
    expect(total.cells.total.repriced).toBeCloseTo((op.cells.total.repriced ?? 0) + (cash.cells.total.repriced ?? 0) + (nc.cells.total.repriced ?? 0), 6);
    expect(t.summary.totalPerAcreOriginal).toBe(7800);
  });
  it('an override replaces a line and propagates to the totals', () => {
    const base = repriceStudy(study);
    const row = base.rows.find(r => r.label.startsWith('Irrigate'))!;
    const before = base.rows.find(r => r.id === 'total')!.cells.total.repriced as number;
    const t = repriceStudy(study, { overrides: { [row.id]: 1000 } });
    const r2 = t.rows.find(r => r.id === row.id)!;
    expect(r2.cells.total.overridden).toBe(true); expect(r2.cells.total.repriced).toBe(1000);
    const after = t.rows.find(r => r.id === 'total')!.cells.total.repriced as number;
    // Interest on operating capital follows the operating total, so the grand total moves by the override plus that interest.
    const dInterest = (t.rows.find(r => r.id === 'interest')!.cells.total.repriced as number) - (base.rows.find(r => r.id === 'interest')!.cells.total.repriced as number);
    expect(after - before).toBeCloseTo(1000 - (row.cells.total.repriced as number) + dInterest, 6);
  });
  it('recomputes interest on operating capital at the lender\'s rate from the monthly table', () => {
    const a = repriceStudy(study, { interestRate: 0.0751 }).rows.find(r => r.id === 'interest')!;
    const b = repriceStudy(study, { interestRate: 0.02 }).rows.find(r => r.id === 'interest')!;
    expect(a.cells.total.repriced).toBeGreaterThan(b.cells.total.repriced as number);
    expect(a.quote).toMatch(/monthly table/);
  });
  it('coverage shares sum to about one and name the CPI share', () => {
    const t = repriceStudy(study);
    const sum = t.summary.coverage.reduce((s, c) => s + c.share, 0);
    expect(sum).toBeGreaterThan(0.99); expect(sum).toBeLessThan(1.01);
    expect(t.summary.cpiShare).toBeGreaterThan(0); expect(t.summary.cpiShare).toBeLessThan(1);
  });
});

it('keeps the separate fuel and repair sources behind combined adjustment factors', () => {
  const study = load(ALMOND);
  const table = repriceStudy(study, { layout: 'production' });
  const cell = table.rows.find(r => r.cells.fuelLubeRepairs?.parts?.filter(p => (p.original ?? 0) > 0).length === 2)!.cells.fuelLubeRepairs;
  expect(cell.parts!.reduce((sum, p) => sum + (p.original ?? 0), 0)).toBeCloseTo(cell.original!, 8);
  expect(cell.parts!.reduce((sum, p) => sum + (p.repriced ?? 0), 0)).toBeCloseTo(cell.repriced!, 8);
  for (const part of cell.parts!) {
    expect(part.seriesId).toBeTruthy();
    expect(part.repriced).toBeCloseTo(part.original! * part.indexTo! / part.indexFrom!, 8);
  }
});
