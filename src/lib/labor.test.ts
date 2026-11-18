import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { DEFAULT_SETTINGS, laborKey, referencePeriod, repriceStudy } from './reprice';
import { hasOverrides } from './exportShared';
import type { RepricedTable } from './types';

// Labor hours and wages: where hours x wage reproduce the printed labor the lender edits them, and the labor cost, the
// operation total, operating interest and every total below follow. Elsewhere nothing changes and no wrong hours show.

const load = (id: string) => JSON.parse(readFileSync(`data/studies/parsed/${id}.json`, 'utf8')) as ParsedStudy;
const IDS = readdirSync('data/studies/parsed').filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
const prod = (s: ParsedStudy, overrides: Record<string, number> = {}, atStudy = false) =>
  repriceStudy(s, { layout: 'production', overrides, ...(atStudy ? { targetPeriod: referencePeriod(s, DEFAULT_SETTINGS).period } : {}) });
const rep = (t: RepricedTable, id: string) => t.rows.find(r => r.id === id)?.cells.total?.repriced ?? 0;
const fits = (a: number, b: number) => Math.abs(a - b) <= 0.5 + 0.01 * Math.max(a, b);

describe('labor hours and wages', () => {
  const studies = IDS.map(load).filter(s => s.costsPerAcre.operations.length);
  const tables = new Map(studies.map(s => [s.source.id, prod(s)]));

  it('without edits, no labor cell is changed and the labor detail matches the printed labor', () => {
    for (const s of studies) {
      const t = tables.get(s.source.id)!;
      for (const r of t.rows.filter(r => r.kind === 'operation')) {
        expect(r.cells.labor?.overridden ?? false, `${s.source.id} ${r.id}`).toBe(false);
        if (!r.labor) continue;
        expect(r.labor.dollars.edited).toBe(false);
        expect(r.labor.dollars.current).toBeCloseTo(r.cells.labor.repriced!, 6);
        if (r.labor.hours) expect(r.labor.hours.current).toBe(r.labor.hours.original);
      }
      expect(hasOverrides(t), s.source.id).toBe(false);
      expect(t.notes?.some(n => n.startsWith('Labor:')) ?? false).toBe(false);
    }
  });

  it('at unchanged hours, hours x the study wage reproduce the printed labor of every operation offered for hours editing', () => {
    let derivable = 0, ops = 0, dollarsOnly = 0;
    const why: Record<string, number> = {}, how: Record<string, number> = {};
    for (const s of studies) {
      const t = tables.get(s.source.id)!;
      if (!t.labor) { const k = !s.assumptions.laborMachineRate ? 'no wage parsed' : !s.costsPerAcre.operations.some(o => (o.timeHrsPerAcre ?? 0) > 0 && (o.labor ?? 0) > 0) ? 'no operation with time and labor' : 'hours x wage do not reproduce the labor'; why[k] = (why[k] ?? 0) + 1; continue; }
      derivable++; how[t.labor.how] = (how[t.labor.how] ?? 0) + 1;
      expect(t.labor.matched).toBeGreaterThanOrEqual(3);
      expect(t.labor.matched / t.labor.timed).toBeGreaterThanOrEqual(0.5);
      for (const r of t.rows.filter(r => r.kind === 'operation' && r.labor)) {
        const printed = s.costsPerAcre.operations[Number(r.id.slice(3))].labor!;
        if (r.labor!.kind === 'dollars') { dollarsOnly++; expect(r.labor!.hours).toBeNull(); continue; }
        ops++;
        expect(fits(r.labor!.hours!.original * r.labor!.wage!.study, printed), `${s.source.id} ${r.label}`).toBe(true);
      }
      // Typing the study's own hours at the study's month gives the printed labor back within rounding.
      const first = t.rows.find(r => r.labor?.hours);
      if (first) {
        const at = prod(s, { [laborKey(Number(first.id.slice(3)))]: first.labor!.hours!.original }, true);
        const cell = at.rows.find(r => r.id === first.id)!.cells.labor;
        expect(fits(cell.repriced!, cell.original!), `${s.source.id} ${first.label}`).toBe(true);
      }
    }
    console.log(`labor: ${derivable} of ${studies.length} studies with operations have verified wages; ${ops} operations editable by hours, ${dollarsOnly} by labor dollars only in those studies; wages ${JSON.stringify(how)}; not derivable: ${JSON.stringify(why)}`);
    expect(derivable).toBeGreaterThan(100);
  });

  it('editing hours on one operation moves its labor, its total, the operating total, interest and the total cost consistently', () => {
    const s = load('strawberries-strawberrycentralcoastfinaldraft-121321');
    const base = prod(s);
    const row = base.rows.find(r => r.labor?.kind === 'machine')!;
    const h = row.labor!.hours!.original;
    const t = prod(s, { [laborKey(Number(row.id.slice(3)))]: h * 3 });
    const edited = t.rows.find(r => r.id === row.id)!;
    expect(edited.labor!.hours).toEqual({ original: h, current: h * 3, edited: true });
    expect(edited.cells.labor.repriced).toBeCloseTo(h * 3 * row.labor!.wage!.indexed, 6);
    expect(edited.cells.labor.overridden).toBe(true);
    const dLabor = edited.cells.labor.repriced! - row.cells.labor.repriced!;
    const dOp = edited.cells.total.repriced! - row.cells.total.repriced!;
    expect(dLabor).toBeGreaterThan(0);
    // the row total is anchored on the printed total, so it moves by the labor change x printed total / printed cells
    const o = s.costsPerAcre.operations[Number(row.id.slice(3))];
    const cellsSum = (o.labor ?? 0) + (o.fuel ?? 0) + (o.lubeRepairs ?? 0) + (o.materials ?? 0) + (o.customRent ?? 0);
    expect(dOp).toBeCloseTo(dLabor * o.totalCost! / cellsSum, 6);
    const dInterest = rep(t, 'interest') - rep(base, 'interest');
    expect(dInterest).toBeGreaterThan(0);
    expect(rep(t, 'total-operating') - rep(base, 'total-operating')).toBeCloseTo(dOp + dInterest, 6);
    expect(t.rows.find(r => r.id === 'total-operating')!.cells.labor.repriced! - base.rows.find(r => r.id === 'total-operating')!.cells.labor.repriced!).toBeCloseTo(dLabor, 6);
    expect(rep(t, 'total-cash-oh')).toBeCloseTo(rep(base, 'total-cash-oh'), 6);
    expect(rep(t, 'total') - rep(base, 'total')).toBeCloseTo(dOp + dInterest, 6);
    expect(rep(base, 'net-total') - rep(t, 'net-total')).toBeCloseTo(dOp + dInterest, 6);
    expect(hasOverrides(t)).toBe(true);
    expect(t.notes?.some(n => n.startsWith('Labor:'))).toBe(true);
    // the other rows are untouched
    for (const r of base.rows.filter(r => r.kind === 'operation' && r.id !== row.id)) expect(t.rows.find(x => x.id === r.id)!.cells.total.repriced).toBe(r.cells.total.repriced);
  });

  it('a typed machine wage reprices every machine operation at its hours, and leaves labor-dollar rows alone', () => {
    const s = load('almonds-2024-almondssjvsouth-final-draft-8-3-25');
    const base = prod(s);
    expect(base.labor?.how).toBe('inferred overhead');
    const t = prod(s, { 'wage:machine': 40 });
    expect(t.labor!.machine).toMatchObject({ current: 40, edited: true });
    for (const r of t.rows.filter(r => r.labor)) {
      const b = base.rows.find(x => x.id === r.id)!;
      if (r.labor!.kind === 'machine') expect(r.cells.labor.repriced).toBeCloseTo(r.labor!.hours!.original * 40, 6);
      else expect(r.cells.labor.repriced).toBe(b.cells.labor.repriced);
    }
  });

  it('a study whose wages do not reproduce its labor offers no hours, only labor dollars', () => {
    const s = load('potatoes-23potatochipperklamath-final');
    const t = prod(s);
    expect(t.labor).toBeNull();
    const rows = t.rows.filter(r => r.labor);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.labor!.kind === 'dollars' && r.labor!.hours === null && r.labor!.wage === null)).toBe(true);
    // an hours key is ignored there; a labor-dollar edit works
    const r0 = rows[0], i = Number(r0.id.slice(3));
    expect(prod(s, { [laborKey(i)]: 9 }).rows.find(r => r.id === r0.id)!.cells.labor.repriced).toBe(r0.cells.labor.repriced);
    const d = prod(s, { [`${r0.id}:labor`]: 100 }).rows.find(r => r.id === r0.id)!;
    expect(d.labor!.dollars).toMatchObject({ current: 100, edited: true });
  });
});
