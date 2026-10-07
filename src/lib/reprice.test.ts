import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { repriceStudy, referencePeriod, DEFAULT_SETTINGS, fallbackCount, usesFallback } from './reprice';
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

describe('gross returns', () => {
  const study = load(ALMOND);
  study.establishment = null;
  const row = (t: ReturnType<typeof repriceStudy>, id: string) => t.rows.find(r => r.id === id)!.cells.total;

  it('are not indexed, and a lender override replaces them and moves the net returns', () => {
    const base = repriceStudy(study);
    const printed = study.costsPerAcre.grossReturns!.value;
    expect(row(base, 'gross').repriced).toBe(printed);
    expect(row(base, 'gross').note).toMatch(/not indexed/);
    const t = repriceStudy(study, { overrides: { 'gross:total': printed + 500 } });
    expect(row(t, 'gross').overridden).toBe(true);
    expect(row(t, 'gross').repriced).toBe(printed + 500);
    expect(row(t, 'net-total').repriced).toBeCloseTo((row(base, 'net-total').repriced ?? 0) + 500, 6);
    expect(row(t, 'net-operating').repriced).toBeCloseTo((row(base, 'net-operating').repriced ?? 0) + 500, 6);
  });

  it('keep a row when the study prints none, and a lender value computes the net returns', () => {
    const none = { ...study, costsPerAcre: { ...study.costsPerAcre, grossReturns: null } } as ParsedStudy;
    const empty = repriceStudy(none);
    expect(row(empty, 'gross').original).toBeNull();
    expect(row(empty, 'gross').repriced).toBeNull();
    expect(row(empty, 'gross').note).toMatch(/prints no per-acre gross returns/);
    expect(row(empty, 'net-total').repriced).toBeNull();
    const t = repriceStudy(none, { overrides: { 'gross:total': 12000 } });
    const op = row(t, 'total-operating').repriced!, total = row(t, 'total').repriced!;
    expect(row(t, 'gross').repriced).toBe(12000);
    expect(row(t, 'net-operating').repriced).toBeCloseTo(12000 - op, 6);
    expect(row(t, 'net-total').repriced).toBeCloseTo(12000 - total, 6);
    expect(row(t, 'net-total').original).toBeNull();
  });
});

describe('CPI fallback rows', () => {
  it('counts priced rows whose label matched no specific index', () => {
    const study = load(ALMOND);
    study.establishment = null;
    study.establishmentSummary = undefined; // isolate the fallback count from the establishment tiers
    const t = repriceStudy(study);
    const flagged = t.rows.filter(usesFallback);
    expect(t.summary.pricedRows).toBe(t.rows.filter(r => (r.kind === 'operation' || r.kind === 'overheadItem') && Object.values(r.cells).some(c => !!c.original && c.seriesId)).length);
    expect(t.summary.fallbackRows).toBe(flagged.length);
    for (const r of flagged) expect(Object.values(r.cells).some(c => c.fallback && c.seriesId === 'bls.cpi' && c.category === 'otherMaterials')).toBe(true);
    expect(fallbackCount(t.rows)).toEqual({ pricedRows: t.summary.pricedRows, fallbackRows: t.summary.fallbackRows });
  });
  it('a row with an unmatched materials label is flagged; overriding it clears the flag', () => {
    const study = load(ALMOND);
    study.establishment = null;
    const op = { ...study.costsPerAcre.operations[0], name: 'Zzz unmatched item', materials: 100, totalCost: (study.costsPerAcre.operations[0].totalCost ?? 0) + 100 };
    const edited = { ...study, costsPerAcre: { ...study.costsPerAcre, operations: [op, ...study.costsPerAcre.operations.slice(1)] } } as ParsedStudy;
    const t = repriceStudy(edited);
    expect(usesFallback(t.rows.find(r => r.id === 'op-0')!)).toBe(true);
    const o = repriceStudy(edited, { factorOverrides: { 'op-0:materials': 1 } });
    expect(usesFallback(o.rows.find(r => r.id === 'op-0')!)).toBe(false);
    expect(o.summary.fallbackRows).toBe(t.summary.fallbackRows - 1);
  });
});

describe('establishment cost tiers', () => {
  const base = load(ALMOND);
  base.establishment = null;
  base.establishmentSummary = undefined; // each test sets the summary it needs
  const printedNc = base.costsPerAcre.nonCashOverheadTotal!;
  const withSummary = (s: Partial<NonNullable<ParsedStudy['establishmentSummary']>>): ParsedStudy => ({ ...base, establishmentSummary: { perennial: true, status: 'none', total: null, annualCharge: null, reason: null, ...s } });
  const cpi = seriesById('bls.cpi')!;
  const row = (t: ReturnType<typeof repriceStudy>, id: string) => t.rows.find(r => r.id === id);
  const cpiFactor = (t: ReturnType<typeof repriceStudy>) => lookup(cpi, t.targetPeriod)!.value / lookup(cpi, '2024-06')!.value;

  it('a missing establishmentSummary behaves as status none on an annual crop', () => {
    const t = repriceStudy(base);
    expect(t.establishmentNote).toBeNull();
    expect(t.rows.some(r => r.section === 'Establishment')).toBe(false);
    expect(row(t, 'nc-0')!.cells.total.original).toBe(printedNc.value);
    expect(row(t, 'nc-0')!.cells.total.category).toBe('nonCashOverhead');
    expect(row(t, 'nc-establishment')).toBeUndefined();
    expect(repriceStudy(withSummary({ perennial: false })).establishmentNote).toBeNull();
  });

  it('splits the yearly charge out of the printed non-cash total, reprices it by CPI, and the totals still reconcile', () => {
    const plain = repriceStudy(base);
    const study = withSummary({ status: 'total', annualCharge: { value: 500, page: 9, quote: 'Establishment cost 500' } });
    const t = repriceStudy(study);
    const machinery = row(t, 'nc-0')!.cells.total, charge = row(t, 'nc-establishment')!.cells.total;
    expect(machinery.original).toBe(printedNc.value - 500);
    expect(machinery.category).toBe('nonCashOverhead');
    expect(charge.original).toBe(500);
    expect(charge.category).toBe('establishmentCpi');
    expect(charge.seriesId).toBe('bls.cpi');
    expect(charge.factor).toBeCloseTo(cpiFactor(t), 10);
    expect(charge.repriced).toBeCloseTo(500 * cpiFactor(t), 8);
    expect(row(t, 'nc-establishment')!.page).toBe(9);
    const nc = row(t, 'total-noncash')!.cells.total;
    expect(nc.original).toBe(printedNc.value);
    expect(nc.repriced).toBeCloseTo((machinery.repriced ?? 0) + (charge.repriced ?? 0), 8);
    const total = row(t, 'total')!.cells.total;
    expect(total.original).toBe(row(plain, 'total')!.cells.total.original);
    expect(Math.round(total.original!)).toBe(base.costsPerAcre.totalCost!.value);
    expect(total.repriced).toBeCloseTo((row(t, 'total-operating')!.cells.total.repriced ?? 0) + (row(t, 'total-cash-oh')!.cells.total.repriced ?? 0) + (nc.repriced ?? 0), 8);
    expect(row(t, 'net-total')!.cells.total.original).toBe(row(plain, 'net-total')!.cells.total.original);
    expect(row(t, 'net-total')!.cells.total.repriced).toBeCloseTo(base.costsPerAcre.grossReturns!.value - total.repriced!, 8);
    expect(t.notes!.join(' ')).toMatch(/yearly establishment charge of \$500/);
  });

  it('gives an itemized non-cash establishment line the CPI category', () => {
    const items = [{ description: 'Equipment', value: 1000, page: 9, quote: 'Equipment 1000' }, { description: 'Orchard establishment', value: 900, page: 9, quote: 'Establishment 900' }];
    const study = { ...base, costsPerAcre: { ...base.costsPerAcre, nonCashOverheadItems: items } } as ParsedStudy;
    const t = repriceStudy(study);
    expect(row(t, 'nc-0')!.cells.total.category).toBe('nonCashOverhead');
    expect(row(t, 'nc-1')!.cells.total.category).toBe('establishmentCpi');
    expect(row(t, 'nc-1')!.cells.total.seriesId).toBe('bls.cpi');
    expect(row(t, 'total-noncash')!.cells.total.original).toBe(1900);
  });

  it('tier 2 shows the printed establishment total repriced by CPI, cited, editable, and outside the yearly totals', () => {
    const plain = repriceStudy(base);
    const study = withSummary({ status: 'total', total: { value: 12000, page: 7, quote: 'Total establishment cost 12,000', source: 'investment' } });
    const t = repriceStudy(study);
    const est = row(t, 'establishment-total')!;
    expect(est.cells.total.original).toBe(12000);
    expect(est.cells.total.seriesId).toBe('bls.cpi');
    expect(est.cells.total.category).toBe('establishmentCpi');
    expect(est.cells.total.repriced).toBeCloseTo(12000 * cpiFactor(t), 8);
    expect(est.page).toBe(7);
    expect(est.sourceNote).toMatch(/investment table, page 7/);
    expect(est.sourceNote).toMatch(/not added to the yearly total cost/);
    expect(t.establishmentNote).toMatch(/one-time investment/);
    expect(t.notes!.join(' ')).toMatch(/CPI/);
    expect(row(t, 'total')!.cells.total.repriced).toBeCloseTo(row(plain, 'total')!.cells.total.repriced!, 8);
    expect(t.summary).toEqual(plain.summary);
    const edited = repriceStudy(study, { overrides: { 'establishment-total:total': 15000 } });
    expect(row(edited, 'establishment-total')!.cells.total.repriced).toBe(15000);
    expect(row(edited, 'establishment-total')!.cells.total.overridden).toBe(true);
    expect(row(edited, 'total')!.cells.total.repriced).toBeCloseTo(row(plain, 'total')!.cells.total.repriced!, 8);
    const factored = repriceStudy(study, { factorOverrides: { 'establishment-total:total': 1.5 } });
    expect(row(factored, 'establishment-total')!.cells.total.repriced).toBeCloseTo(18000, 8);
    for (const [source, words] of [['table', 'establishment table'], ['production', 'production table'], ['prose', 'study text']] as const) {
      expect(row(repriceStudy(withSummary({ status: 'total', total: { value: 1, page: 2, quote: '', source } })), 'establishment-total')!.sourceNote).toMatch(words);
    }
  });

  it('tier 3 flags a perennial study with no establishment cost, and says nothing for annual crops', () => {
    const t = repriceStudy(withSummary({ perennial: true, reason: 'no establishment section found' }));
    expect(t.establishmentNote).toBe('This study prints no establishment cost we could find; establishment is not included.');
    expect(t.notes!.join(' ')).toMatch(/no establishment section found/);
    expect(t.rows.some(r => r.section === 'Establishment')).toBe(false);
    expect(repriceStudy(withSummary({ perennial: false })).establishmentNote).toBeNull();
  });

  it('tier 1 keeps the establishment table behavior and adds the total\'s source line', () => {
    const study = { ...load('almonds-2024-almondssjvsouth-final-draft-8-3-25'), establishmentSummary: undefined };
    const plain = repriceStudy(study);
    expect(plain.layout).toBe('establishment');
    const t = repriceStudy({ ...study, establishmentSummary: { perennial: true, status: 'table', total: { value: 9000, page: 6, quote: '', source: 'table' }, annualCharge: null, reason: null } });
    expect(t.rows).toEqual(plain.rows);
    expect(t.summary).toEqual(plain.summary);
    expect(t.establishmentNote).toMatch(/establishment table, page 6/);
    expect(plain.establishmentNote).toBeNull();
  });
});

describe('studies whose operation rows cannot be read', () => {
  it('reprice the printed operating total as one CPI fallback row, so totals still match the study', () => {
    const study = load('onions-2023onions-final');
    expect(study.costsPerAcre.operations.length).toBe(0);
    const t = repriceStudy(study);
    const row = t.rows.find(r => r.id === 'op-printed')!;
    expect(row.cells.total.original).toBe(study.costsPerAcre.operatingTotal!.value);
    expect(row.cells.total.seriesId).toBe('bls.cpi');
    expect(row.cells.total.fallback).toBe(true);
    expect(t.rows.find(r => r.id === 'total')!.cells.total.original).toBeCloseTo(study.costsPerAcre.totalCost!.value, 0);
  });
});
