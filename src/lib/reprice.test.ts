import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { repriceStudy, referencePeriod, DEFAULT_SETTINGS, NOT_REPRODUCED_NOTE, fallbackCount, usesFallback, mainReturnIndex } from './reprice';
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
    // A study that prints neither gross returns nor return lines.
    const none = { ...study, assumptions: { ...study.assumptions, returns: [] }, costsPerAcre: { ...study.costsPerAcre, grossReturns: null } } as ParsedStudy;
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

describe('recalculated yearly establishment charge', () => {
  const AVOCADO = 'avocados-2020avocadohighdensitysandiegocounty';
  const avocado = load(AVOCADO);
  const contract = {
    basisYear: { index: 2, label: '3rd' },
    capitalRecovery: { ratePct: { value: 5.5, page: 18, quote: 'interest rate 5.5%' }, years: { value: 30, page: 23, quote: 'Establishment Costs 568,180 30' }, computed: 1955, reproduces: true },
    investmentCharges: { insurance: 252 / 20, taxes: 2841 / 20, acres: 20, insuranceRatePct: null, taxRatePct: null, page: 23, quote: 'Establishment Costs 568,180 30 0 39,094 252 2,841 0 42,186' },
  };
  const tier1 = (extra: object = {}): ParsedStudy => ({ ...avocado, establishmentSummary: { ...avocado.establishmentSummary!, ...contract, ...extra } });
  const prod = { layout: 'production' as const };
  const study$ = { ...prod, targetPeriod: '2020-06' };
  const row = (t: ReturnType<typeof repriceStudy>, id: string) => t.rows.find(r => r.id === id)!;
  const crf = (i: number, n: number) => i * (1 + i) ** n / ((1 + i) ** n - 1);
  const basisOf = (s: ParsedStudy, settings = {}) => {
    const est = repriceStudy(s, { ...settings, layout: 'establishment' });
    return est.rows.find(r => r.label === 'ACCUMULATED NET CASH COSTS/ACRE')!.cells.y3;
  };
  const lineId = (t: ReturnType<typeof repriceStudy>, label: string) => t.rows.find(r => r.label === label)!.id;

  it('tier 1 in study dollars: every recalculated row matches the printed figure and the totals are unchanged', () => {
    const plain = repriceStudy(avocado, study$);
    const t = repriceStudy(tier1(), study$);
    expect(basisOf(tier1(), study$).repriced).toBeCloseTo(28409, 6);
    const charge = row(t, 'nc-establishment').cells.total;
    expect(charge.original).toBe(1955);
    expect(charge.recalculated).toBe(true);
    expect(Math.abs(charge.repriced! - 1955)).toBeLessThan(1);
    expect(charge.repriced).toBeCloseTo(28409 * crf(0.055, 30), 8);
    const ins = row(t, `${lineId(t, 'Property Insurance, other investments')}-establishment`).cells.total;
    const tax = row(t, `${lineId(t, 'Property Taxes, other investments')}-establishment`).cells.total;
    expect(ins.original).toBeCloseTo(12.6, 8); expect(ins.repriced).toBeCloseTo(12.6, 8);
    expect(tax.original).toBeCloseTo(142.05, 8); expect(tax.repriced).toBeCloseTo(142.05, 8);
    for (const id of ['total-operating', 'total-cash-oh', 'total-cash', 'total-noncash', 'total']) {
      expect(row(t, id).cells.total.original, id).toBeCloseTo(row(plain, id).cells.total.original!, 8);
      expect(Math.abs(row(t, id).cells.total.repriced! - row(plain, id).cells.total.repriced!), id).toBeLessThan(1);
    }
    expect(t.summary.totalPerAcreOriginal).toBe(plain.summary.totalPerAcreOriginal);
  });

  it('tier 1 repriced: basis is the repriced accumulated net cash cost at the amortization year, times the CRF', () => {
    const t = repriceStudy(tier1(), prod);
    const basis = basisOf(tier1()).repriced!;
    expect(basis).not.toBeCloseTo(28409, 0);
    const r = row(t, 'nc-establishment');
    expect(r.cells.total.repriced).toBeCloseTo(basis * crf(0.055, 30), 8);
    const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
    expect(r.sourceNote).toBe(`Recalculated: ${money(basis)} repriced establishment cost (year 3) x CRF(5.5%, 30 years) = ${money(basis * crf(0.055, 30))}.`);
    expect(r.cells.total.note).toBe(r.sourceNote);
    expect(t.notes!.some(n => n.includes(r.sourceNote!))).toBe(true);
    // Income is not indexed, but a lender's income edit moves the basis.
    const edit = { overrides: { 'income:y3': 0 } };
    const priced = repriceStudy(tier1(), { ...prod, ...edit });
    expect(row(priced, 'nc-establishment').cells.total.repriced).toBeCloseTo(basisOf(tier1(), edit).repriced! * crf(0.055, 30), 8);
    expect(row(priced, 'nc-establishment').cells.total.repriced).not.toBeCloseTo(r.cells.total.repriced!, 0);
  });

  it('insurance and taxes split into a recalculated establishment share and the CPI-repriced remainder, and reconcile', () => {
    const t = repriceStudy(tier1(), prod);
    const basis = basisOf(tier1());
    const scale = basis.repriced! / basis.original!;
    const cpiF = row(t, lineId(t, 'Office Expense')).cells.total.factor!;
    for (const [label, printed, share] of [['Property Insurance', 37, 12.6], ['Property Taxes', 413, 142.05]] as const) {
      const rest = row(t, lineId(t, `${label}, other investments`));
      const est = row(t, `${rest.id}-establishment`);
      expect(rest.cells.total.original! + est.cells.total.original!).toBeCloseTo(printed, 8);
      expect(rest.cells.total.repriced).toBeCloseTo((printed - share) * cpiF, 8);
      expect(est.cells.total.repriced).toBeCloseTo(share * scale, 8);
      expect(est.page).toBe(23); expect(rest.page).not.toBeNull();
      expect(est.sourceNote).toMatch(/^Recalculated: \$\d+ study (insurance|property tax) on establishment x \(\$[\d,]+ repriced establishment cost \(year 3\) \/ \$28,409 in the study\) = \$\d+\.$/);
    }
    const items = t.rows.filter(r => r.section === 'Cash overhead' && r.kind === 'overheadItem');
    expect(row(t, 'total-cash-oh').cells.total.repriced).toBeCloseTo(items.reduce((s, r) => s + r.cells.total.repriced!, 0), 8);
    expect(row(t, 'total-cash-oh').cells.total.original).toBeCloseTo(row(repriceStudy(avocado, prod), 'total-cash-oh').cells.total.original!, 8);
    // With a printed rate that reproduces the study amount, the rate times the average investment is used.
    const rated = repriceStudy(tier1({ investmentCharges: { ...contract.investmentCharges, taxRatePct: 1 } }), prod);
    const taxEst = row(rated, `${lineId(rated, 'Property Taxes, other investments')}-establishment`);
    expect(taxEst.cells.total.repriced).toBeCloseTo(0.01 * basis.repriced! / 2, 8);
    expect(taxEst.sourceNote).toMatch(/^Recalculated: 1% property tax rate x \$[\d,]+ repriced establishment cost \(year 3\) \/ 2 average investment = \$\d+\.$/);
  });

  it('a lender capital recovery rate replaces the study rate in the CRF only', () => {
    const base = repriceStudy(tier1(), prod);
    const t = repriceStudy(tier1(), { ...prod, capitalRecoveryRate: 0.08 });
    const basis = basisOf(tier1()).repriced!;
    expect(row(t, 'nc-establishment').cells.total.repriced).toBeCloseTo(basis * crf(0.08, 30), 8);
    expect(row(t, 'nc-establishment').sourceNote).toMatch(/CRF\(8%, lender rate, 30 years\)/);
    expect(row(t, 'total-cash-oh').cells.total.repriced).toBeCloseTo(row(base, 'total-cash-oh').cells.total.repriced!, 8);
    expect(row(t, 'interest').cells.total.repriced).toBeCloseTo(row(base, 'interest').cells.total.repriced!, 8);
  });

  it('falls back to the CPI-indexed charge, with a reason, when the study charge does not reproduce', () => {
    const t = repriceStudy(tier1({ capitalRecovery: { ...contract.capitalRecovery, reproduces: false } }), prod);
    const charge = row(t, 'nc-establishment').cells.total;
    expect(charge.recalculated).toBeUndefined();
    expect(charge.seriesId).toBe('bls.cpi');
    expect(t.rows.some(r => /establishment share/.test(r.label))).toBe(false);
    expect(t.notes).toContain(NOT_REPRODUCED_NOTE);
    expect(NOT_REPRODUCED_NOTE).toMatch(/could not be reproduced from its stated rate and years, so it is adjusted by the CPI instead/);
    // Missing contract fields behave exactly as before.
    const old = repriceStudy({ ...avocado, establishmentSummary: avocado.establishmentSummary && { ...avocado.establishmentSummary, basisYear: undefined, capitalRecovery: undefined, investmentCharges: undefined } }, prod);
    expect(row(old, 'nc-establishment').cells.total.seriesId).toBe('bls.cpi');
    expect(old.notes).not.toContain(NOT_REPRODUCED_NOTE);
  });

  it('tier 2: the basis is the CPI-repriced establishment total, including a lender edit', () => {
    const almond = load(ALMOND);
    const s: ParsedStudy = { ...almond, establishment: null, establishmentSummary: {
      perennial: true, status: 'total', reason: null, total: { value: 12000, page: 7, quote: 'Total establishment cost 12,000', source: 'investment' },
      annualCharge: { value: Math.round(12000 * crf(0.05, 25)), page: 9, quote: 'Establishment cost 851' },
      capitalRecovery: { ratePct: { value: 5, page: 9, quote: '5%' }, years: { value: 25, page: 9, quote: '25 years' }, computed: 851, reproduces: true },
    } };
    const same = repriceStudy(s, { targetPeriod: '2024-06' });
    expect(Math.abs(row(same, 'nc-establishment').cells.total.repriced! - 851)).toBeLessThan(1);
    expect(row(same, 'total').cells.total.original).toBe(repriceStudy({ ...s, establishmentSummary: { ...s.establishmentSummary!, capitalRecovery: null } }, { targetPeriod: '2024-06' }).rows.find(r => r.id === 'total')!.cells.total.original);
    const t = repriceStudy(s);
    expect(row(t, 'nc-establishment').cells.total.repriced).toBeCloseTo(row(t, 'establishment-total').cells.total.repriced! * crf(0.05, 25), 8);
    expect(row(t, 'nc-establishment').sourceNote).toMatch(/repriced establishment cost \(printed total\) x CRF\(5%, 25 years\)/);
    const edited = repriceStudy(s, { overrides: { 'establishment-total:total': 15000 } });
    expect(row(edited, 'nc-establishment').cells.total.repriced).toBeCloseTo(15000 * crf(0.05, 25), 8);
    // No property insurance line and no unitemized remainder: the shares are only noted.
    const noLine: ParsedStudy = { ...s, costsPerAcre: { ...s.costsPerAcre, cashOverheadItems: s.costsPerAcre.cashOverheadItems.filter(i => !/property insurance/i.test(i.description)), cashOverheadTotal: null },
      establishmentSummary: { ...s.establishmentSummary!, investmentCharges: { insurance: 10, taxes: 60, acres: 100, insuranceRatePct: null, taxRatePct: null, page: 9, quote: 'Establishment 1,200,000' } } };
    const n = repriceStudy(noLine);
    expect(n.rows.some(r => /Property insurance on establishment/.test(r.label))).toBe(false);
    expect(n.notes!.join(' ')).toMatch(/insurance on the establishment investment \(\$10 per acre\), page 9, could not be matched/);
    expect(n.rows.find(r => r.label === 'Property Taxes, other investments')!.cells.total.original).toBe(230);
  });
});

describe('crop specific return lines', () => {
  const cell = (t: ReturnType<typeof repriceStudy>, id: string) => t.rows.find(r => r.id === id)!.cells.total;
  const prod = { layout: 'production' as const, targetPeriod: '2026-06' };

  it('every study with return lines reconciles: in study dollars the lines sum to the printed gross returns', () => {
    let checked = 0;
    for (const file of readdirSync('data/studies/parsed')) {
      const s = load(file.replace('.json', ''));
      const lines = s.assumptions.returns ?? [];
      if (!lines.length) continue;
      const t = repriceStudy(s, prod);
      const rows = t.rows.filter(r => r.returnLine);
      expect(rows.map(r => r.label), file).toEqual(lines.map(l => l.name));
      rows.forEach((r, i) => {
        expect(r.id).toBe(`ret-${i}`);
        expect(r.cells.total.original, file).toBe(lines[i].value);
        expect(r.cells.total.repriced, `${file}: unedited lines keep their printed value`).toBe(lines[i].value);
        expect(r.page).toBe(lines[i].page);
        expect(r.quote).toBe(lines[i].quote);
      });
      const printed = s.costsPerAcre.grossReturns!.value;
      const sum = rows.reduce((a, r) => a + r.cells.total.original!, 0);
      expect(Math.abs(sum - printed), file).toBeLessThanOrEqual(Math.max(2, printed * 0.01));
      expect(cell(t, 'gross').original, file).toBe(printed);
      expect(cell(t, 'gross').repriced, file).toBe(printed);
      checked++;
    }
    expect(checked).toBe(196);
  });

  it('a price edit moves the line, the gross returns and both nets by quantity x the price change', () => {
    const s = load(ALMOND);
    s.establishment = null; // Without the establishment table the shared price cannot move the establishment charge.
    s.establishmentSummary = undefined;
    const base = repriceStudy(s, prod);
    const line = s.assumptions.returns[0];
    const t = repriceStudy(s, { ...prod, overrides: { 'ret-0:price': line.price + 0.5 } });
    const delta = line.quantity * 0.5;
    expect(cell(t, 'ret-0').repriced).toBeCloseTo(line.quantity * (line.price + 0.5), 8);
    expect(cell(t, 'ret-0').overridden).toBe(true);
    expect(cell(t, 'ret-0').original).toBe(line.value);
    for (const id of ['gross', 'net-operating', 'net-total']) expect(cell(t, id).repriced! - cell(base, id).repriced!, id).toBeCloseTo(delta, 6);
    expect(cell(t, 'total-operating').repriced).toBe(cell(base, 'total-operating').repriced);
    const row = t.rows.find(r => r.id === 'ret-0')!;
    expect(row.returnLine!.price).toEqual({ original: line.price, current: line.price + 0.5, edited: true });
    // Typing the value directly replaces quantity x price.
    const typed = repriceStudy(s, { ...prod, overrides: { 'ret-0:total': 5000 } });
    expect(cell(typed, 'ret-0').repriced).toBe(5000);
    expect(cell(typed, 'gross').repriced).toBe(cell(base, 'gross').repriced! + 5000 - line.value);
  });

  it('a multi-product study edits its lines independently (cotton lint and seed)', () => {
    const s = load('cotton-cotton2012pima');
    const [lint, seed] = s.assumptions.returns;
    const base = repriceStudy(s, prod);
    const t = repriceStudy(s, { ...prod, overrides: { 'ret-0:price': 1.5, 'ret-1:quantity': 4 } });
    expect(cell(t, 'ret-0').repriced).toBeCloseTo(lint.quantity * 1.5, 8);
    expect(cell(t, 'ret-1').repriced).toBeCloseTo(4 * seed.price, 8);
    const delta = lint.quantity * 1.5 - lint.value + 4 * seed.price - seed.value;
    expect(cell(t, 'gross').repriced! - cell(base, 'gross').repriced!).toBeCloseTo(delta, 6);
    const onlySeed = repriceStudy(s, { ...prod, overrides: { 'ret-1:price': 50 } });
    expect(cell(onlySeed, 'ret-0').repriced).toBe(lint.value);
    expect(cell(onlySeed, 'ret-0').overridden).toBe(false);
    expect(cell(onlySeed, 'ret-1').repriced).toBeCloseTo(seed.quantity * 50, 8);
  });

  it('a line whose printed value differs from quantity x price keeps the printed value, with a note, until edited', () => {
    const s = load('avocados-2020avocadohighdensitysandiegocounty');
    const line = s.assumptions.returns[0];
    expect(Math.abs(line.quantity * line.price - line.value)).toBeGreaterThan(1);
    const base = repriceStudy(s, prod);
    const row = base.rows.find(r => r.id === 'ret-0')!;
    expect(row.cells.total.repriced).toBe(line.value);
    expect(row.returnLine!.mismatch).toBeCloseTo(line.quantity * line.price - line.value, 6);
    expect(row.sourceNote).toMatch(/printed value is kept/);
    const t = repriceStudy(s, { ...prod, overrides: { 'ret-0:price': line.price } });
    expect(cell(t, 'ret-0').repriced).toBeCloseTo(line.quantity * line.price, 6);
  });

  it('the main crop price is shared with the establishment years, and moves the recalculated establishment charge', () => {
    const s = load(ALMOND);
    expect(mainReturnIndex(s)).toBe(0);
    const price = s.assumptions.returns[0].price + 1;
    const estBase = repriceStudy(s, { targetPeriod: '2026-06' });
    const income = (t: ReturnType<typeof repriceStudy>) => t.rows.find(r => r.kind === 'returns')!;
    const yields = s.establishment!.table!.yieldRow!.values;
    // A production price edit reaches the establishment years' income ...
    const estEdited = repriceStudy(s, { targetPeriod: '2026-06', overrides: { 'ret-0:price': price } });
    const k = yields.findIndex(v => v != null && v > 0);
    expect(income(estEdited).cells[`y${k + 1}`].repriced).toBeCloseTo(yields[k]! * price, 6);
    expect(estEdited.notes!.some(n => /Shared sale price/.test(n))).toBe(true);
    const acc = (t: ReturnType<typeof repriceStudy>) => t.rows.find(r => r.kind === 'total' && /ACCUMULATED NET CASH/i.test(r.label))!.cells.y3.repriced!;
    const extraIncome = yields.slice(0, 3).reduce<number>((a, v, i) => a + (v ?? 0) * price - (income(estBase).cells[`y${i + 1}`].repriced ?? 0), 0);
    expect(acc(estBase) - acc(estEdited)).toBeCloseTo(extraIncome, 6);
    // ... and the establishment sale price reaches the production line (one shared price).
    const prodByEst = repriceStudy(s, { ...prod, pricePerUnit: price });
    expect(cell(prodByEst, 'ret-0').repriced).toBeCloseTo(s.assumptions.returns[0].quantity * price, 6);
    // The capital recovery basis (accumulated net cash cost) falls by the extra income, and the yearly charge with it.
    const pBase = repriceStudy(s, prod), pEdited = repriceStudy(s, { ...prod, overrides: { 'ret-0:price': price } });
    const charge = (t: ReturnType<typeof repriceStudy>) => cell(t, 'nc-establishment');
    expect(charge(pEdited).note).toContain(`$${Math.round(acc(estEdited)).toLocaleString('en-US')} repriced establishment cost (year 3)`);
    expect(charge(pBase).repriced! - charge(pEdited).repriced!).toBeGreaterThan(0);
    expect(charge(pEdited).repriced! / charge(pBase).repriced!).toBeCloseTo(acc(estEdited) / acc(estBase), 6);
    expect(pEdited.notes!.some(n => /Shared sale price/.test(n))).toBe(true);
  });

  it('a gross returns override from an older link still replaces the subtotal of a study with lines', () => {
    const s = load(ALMOND);
    s.establishment = null;
    s.establishmentSummary = undefined;
    const base = repriceStudy(s, prod);
    const t = repriceStudy(s, { ...prod, overrides: { 'gross:total': 9000, 'ret-0:price': 3 } });
    expect(cell(t, 'gross').repriced).toBe(9000);
    expect(cell(t, 'gross').overridden).toBe(true);
    expect(cell(t, 'gross').note).toMatch(/replaces the sum of the return lines/);
    expect(cell(t, 'net-total').repriced).toBeCloseTo(cell(base, 'net-total').repriced! + 9000 - cell(base, 'gross').repriced!, 6);
  });

  it('studies without return lines keep the single editable gross row as before', () => {
    const s = load('almonds-2019almondssjvnorth');
    expect(s.assumptions.returns ?? []).toHaveLength(0);
    const t = repriceStudy(s, prod);
    expect(t.rows.some(r => r.returnLine || r.id === 'h-returns')).toBe(false);
    const gross = t.rows.find(r => r.id === 'gross')!;
    expect(gross.kind).toBe('returns');
    expect(gross.cells.total.repriced).toBe(s.costsPerAcre.grossReturns!.value);
    expect(gross.cells.total.note).toBe('Returns are not indexed. Type a value to update.');
    const edited = repriceStudy(s, { ...prod, overrides: { 'gross:total': 7000 } });
    expect(cell(edited, 'gross').repriced).toBe(7000);
    expect(cell(edited, 'net-total').repriced).toBeCloseTo(cell(t, 'net-total').repriced! + 7000 - s.costsPerAcre.grossReturns!.value, 6);
    const none = load('spinach-2015-organicspinach-finaldraftjan29');
    const empty = repriceStudy(none, prod);
    expect(empty.rows.find(r => r.id === 'gross')!.kind).toBe('returns');
    expect(cell(empty, 'gross').original).toBeNull();
  });
});

describe('shared sale price only links lines counted in the establishment yield unit', () => {
  it('links pomegranate boxes to "28 Pound Boxes" and keeps olive oil gallons apart from a yield in tons', () => {
    expect(mainReturnIndex(load('pomegranates-pomegranatevs2010'))).toBe(0);
    expect(mainReturnIndex(load('olive-oil-2016oliveoilsacvalley-highdensityfinaldraft7'))).toBe(-1);
  });
});
