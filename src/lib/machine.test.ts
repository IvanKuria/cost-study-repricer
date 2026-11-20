import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { ParsedStudy } from '../data/studySchema';
import { MACHINE_NOTE, isLaborKey, laborKey, machineKey, repriceStudy } from './reprice';
import type { RepricedTable } from './types';
import { DEFAULT_MAPPING } from '../data/mapping';

// Machine time: fuel, lube and repairs are costs per machine hour (ASABE), so they scale with an operation's machine
// hours; operator labor hours are machine hours x the study's labor factor where the row's labor is machine labor.

const load = (id: string) => JSON.parse(readFileSync(`data/studies/parsed/${id}.json`, 'utf8')) as ParsedStudy;
const IDS = readdirSync('data/studies/parsed').filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
const prod = (s: ParsedStudy, overrides: Record<string, number> = {}) => repriceStudy(s, { layout: 'production', overrides });
const opIndex = (id: string) => Number(id.replace('op-', ''));
const timed = (t: RepricedTable) => t.rows.filter(r => r.machine);

describe('machine hours', () => {
  const studies = IDS.map(load).filter(s => s.costsPerAcre.operations.length);
  const tables = new Map(studies.map(s => [s.source.id, prod(s)]));

  it('is offered only on operations with printed machine time, never on hand-labor time', () => {
    let offered = 0;
    for (const s of studies) for (const r of timed(tables.get(s.source.id)!)) {
      offered++;
      expect(r.machine!.original).toBeGreaterThan(0);
      expect(r.machine!.original).toBe(r.timeHrs);
      expect(r.labor?.kind, `${s.source.id} ${r.id}`).not.toBe('general');
      expect(r.machine!.edited).toBe(false);
    }
    expect(offered).toBeGreaterThan(1000);
    for (const s of studies) for (const r of tables.get(s.source.id)!.rows)
      if (r.kind === 'operation' && !(r.timeHrs && r.timeHrs > 0)) expect(r.machine).toBeUndefined();
  });

  it('unchanged hours leave every study\'s table unchanged', () => {
    for (const s of studies) {
      const t = tables.get(s.source.id)!;
      const same = Object.fromEntries(timed(t).map(r => [machineKey(opIndex(r.id)), r.machine!.original]));
      expect(prod(s, same), s.source.id).toEqual(t);
    }
  });

  it('doubling an operation\'s hours doubles its repriced fuel, lube and repairs and its machine labor hours', () => {
    let checked = 0, withLabor = 0;
    for (const s of studies) {
      const t = tables.get(s.source.id)!;
      if (!timed(t).length) continue;
      // Rows are independent of one another, so every operation's hours are doubled in one pass.
      const e = prod(s, Object.fromEntries(timed(t).map(r => [machineKey(opIndex(r.id)), r.machine!.original * 2])));
      for (const r of timed(t)) {
        const r2 = e.rows.find(x => x.id === r.id)!;
        expect(r2.machine).toEqual({ ...r.machine, current: r.machine!.original * 2, edited: true });
        const flr = r.cells.fuelLubeRepairs;
        if (flr.original) {
          expect(r2.cells.fuelLubeRepairs.repriced, `${s.source.id} ${r.id}`).toBeCloseTo(flr.repriced! * 2, 8);
          expect(r2.cells.fuelLubeRepairs.hoursScale).toBeCloseTo(2, 12);
          expect(r2.cells.fuelLubeRepairs.factor).toBe(flr.factor); // the price change is unchanged; only the quantity moved
          checked++;
        }
        if (r.labor?.kind === 'machine') {
          expect(r2.labor!.hours!.current).toBeCloseTo(r.labor.hours!.original * 2, 10);
          expect(r2.labor!.hours!.edited).toBe(false);
          expect(r2.cells.labor.repriced).toBeCloseTo(r2.labor!.hours!.current * r2.labor!.wage!.current, 8);
          withLabor++;
        } else expect(r2.cells.labor).toEqual(r.cells.labor);
        // the row total follows its cells; materials and custom do not move
        expect(r2.cells.materials).toEqual(r.cells.materials);
        expect(r2.cells.custom).toEqual(r.cells.custom);
        const total = (x: typeof r) => ['labor', 'fuelLubeRepairs', 'materials', 'custom'].reduce((a, k) => a + (x.cells[k].repriced ?? 0), 0);
        const orig = ['labor', 'fuelLubeRepairs', 'materials', 'custom'].reduce((a, k) => a + (r.cells[k].original ?? 0), 0);
        if (orig) expect(r2.cells.total.repriced).toBeCloseTo(r.cells.total.original! * total(r2) / orig, 6);
        expect(e.notes).toContain(MACHINE_NOTE);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(withLabor).toBeGreaterThan(500);
  });

  it('totals follow a machine hours edit', () => {
    const s = load('almonds-2019almondssjvnorth');
    const t = prod(s);
    const r = timed(t).find(x => x.cells.fuelLubeRepairs.original && x.labor?.kind === 'machine')!;
    const e = prod(s, { [machineKey(opIndex(r.id))]: r.machine!.original * 3 });
    const d = (tb: RepricedTable, id: string) => tb.rows.find(x => x.id === id)!.cells.total.repriced!;
    const rowDelta = d(e, r.id) - d(t, r.id);
    expect(rowDelta).toBeGreaterThan(0);
    expect(d(e, `st-${r.section.toLowerCase()}`) - d(t, `st-${r.section.toLowerCase()}`)).toBeCloseTo(rowDelta, 6);
    expect(d(e, 'total') - d(t, 'total')).toBeGreaterThan(rowDelta - 1e-9); // operating interest grows with it
  });

  it('typed labor hours win over hours derived from machine time; a typed fuel, lube and repairs figure wins too', () => {
    const s = load('almonds-2024-almondssjvsouth-final-draft-8-3-25');
    const r = timed(prod(s)).find(x => x.cells.fuelLubeRepairs.original && x.labor?.kind === 'machine')!;
    const i = opIndex(r.id);
    const e = prod(s, { [machineKey(i)]: r.machine!.original * 2, [laborKey(i)]: 0.25, [`${r.id}:fuelLubeRepairs`]: 7 });
    const r2 = e.rows.find(x => x.id === r.id)!;
    expect(r2.labor!.hours!.current).toBe(0.25);
    expect(r2.labor!.hours!.edited).toBe(true);
    expect(r2.cells.labor.repriced).toBeCloseTo(0.25 * r2.labor!.wage!.current, 8);
    expect(r2.cells.fuelLubeRepairs.repriced).toBe(7);
    expect(r2.cells.fuelLubeRepairs.hoursScale).toBeUndefined();
  });

  it('machine hours keys ride with the labor keys', () => {
    expect(machineKey(3)).toBe('op-3:machineHours');
    expect(isLaborKey('op-3:machineHours')).toBe(true);
    expect(isLaborKey('op-3:machineHourz')).toBe(false);
  });
});

describe('table key and wording', () => {
  it('defines every production column, Fuel, Lube & Repairs as machine cost only, with the study\'s sentences', () => {
    const t = prod(load('almonds-2019almondssjvnorth'));
    expect(t.columnKey!.map(e => e.column)).toEqual(['Time (Hrs/A)', 'Labor Cost', 'Fuel, Lube & Repairs', 'Material Cost', 'Custom/Rent', 'Total Cost']);
    const flr = t.columnKey!.find(e => e.column === 'Fuel, Lube & Repairs')!;
    expect(flr.text).toMatch(/machine operating cost only/i);
    expect(flr.text).toMatch(/Labor/);
    const labor = t.columnKey!.find(e => e.column === 'Labor Cost')!;
    expect(labor.text).toMatch(/machine time x 1\.2/);
    expect(labor.source).toEqual({ page: 9, quote: expect.stringMatching(/20 percent higher than the equipment time/) });
  });

  it('defines the establishment table\'s years and rows', () => {
    const t = repriceStudy(load('almonds-2024-almondssjvsouth-final-draft-8-3-25'), { layout: 'establishment', overrides: {} });
    expect(t.layout).toBe('establishment');
    expect(t.columnKey!.map(e => e.column)).toEqual(['Year columns', 'Operation rows', 'Income', 'Net and accumulated rows']);
    expect(t.columnKey![0].text).toMatch(/1st through 5th/);
    expect(t.columnKey![3].source?.page).toBe(12);
  });

  it('source notes name sources only: no first person, no one\'s instructions', () => {
    for (const m of DEFAULT_MAPPING) {
      expect(m.note).not.toMatch(/\b(his|ours|our|we|professor|worksheet|instruction|owner)\b/i);
      expect(m.note).toMatch(/USDA NASS|BLS|Federal Reserve|index/);
    }
  });
});
