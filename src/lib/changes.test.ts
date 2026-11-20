import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repriceStudy } from './reprice';
import { SERIES } from './series';
import { studyPicks } from './studies';
import { studyContentsOf } from './studyContentsOf';
import contents from './studyContents.json';
import { changeForCell, changeSentence, changeValue, userChanges, type EditState } from './exportChanges';
import { buildPdf } from './exportPdf';
import { buildWorkbook } from './exportXlsx';
import type { ParsedStudy } from '@/data/studySchema';
import south from '../../data/studies/parsed/almonds-2024-almondssjvsouth-final-draft-8-3-25.json';

const study = south as unknown as ParsedStudy;
const target = '2026-06';
const none: EditState = { overrides: {}, factorOverrides: {}, returns: {}, price: null, studyPrice: null, rate: null, rateDefault: 0.075, crRate: null, crRateDefault: null, acres: 1 };

describe('your changes', () => {
  it('lists nothing for an unedited study', () => {
    const table = repriceStudy(study, { layout: 'production', targetPeriod: target }, SERIES);
    expect(userChanges(table, study, none)).toEqual([]);
  });

  it('lists a typed cost item, a factor, a return price and the interest rate, with the study figure before each', () => {
    const base = repriceStudy(study, { layout: 'production', targetPeriod: target }, SERIES);
    const ops = base.rows.filter(r => r.kind === 'operation' && (r.cells.materials?.original ?? 0) > 0 && (r.cells.labor?.original ?? 0) > 0);
    const [a, b] = ops;
    const edits: EditState = { ...none, overrides: { [`${a.id}:materials`]: 123 }, factorOverrides: { [`${b.id}:labor`]: 1.5 }, returns: { 'ret-0:price': 2.5 }, rate: 0.09 };
    const table = repriceStudy(study, { layout: 'production', targetPeriod: target, overrides: { ...edits.overrides, ...edits.returns }, factorOverrides: edits.factorOverrides, interestRate: 0.09 }, SERIES);
    const list = userChanges(table, study, edits);
    expect(list.map(c => c.kind)).toEqual(['interest rate', 'cost', 'factor', 'price']);
    const cost = list.find(c => c.kind === 'cost')!;
    expect(cost).toMatchObject({ row: a.label, column: 'Materials', from: a.cells.materials.original, to: 123, unit: 'money' });
    const factor = list.find(c => c.kind === 'factor')!;
    expect(factor.from).toBeCloseTo(b.cells.labor.factor!, 6);
    expect(changeValue(factor.to, factor.unit)).toBe('1.500');
    expect(list.find(c => c.kind === 'price')!.from).toBe(study.assumptions.returns[0].price);
    // Edited cells find the change that set them, for the export flags.
    const row = table.rows.find(r => r.id === a.id)!;
    expect(row.cells.materials.overridden).toBe(true);
    expect(changeForCell(list, table, row, 'materials')).toBe(cost);
    expect(changeSentence(cost)).toMatch(/^Your cost: \$123 \(study \$/);
  });

  it('lists labor and machine hours from the stored edits, where the engine folds them into dollars', () => {
    const base = repriceStudy(study, { layout: 'production', targetPeriod: target }, SERIES);
    const op = base.rows.find(r => r.labor?.hours && r.machine)!;
    expect(op).toBeDefined();
    const returns = { [`${op.id}:laborHours`]: 2, [`${op.id}:machineHours`]: 1.25 };
    const table = repriceStudy(study, { layout: 'production', targetPeriod: target, overrides: returns }, SERIES);
    const list = userChanges(table, study, { ...none, returns });
    expect(list.map(c => c.kind).sort()).toEqual(['labor hours', 'machine hours']);
    expect(list.find(c => c.kind === 'machine hours')!.from).toBe(op.machine!.original);
  });

  it('lists establishment year edits as Year N', () => {
    const base = repriceStudy(study, { layout: 'establishment', targetPeriod: target }, SERIES);
    const op = base.rows.find(r => r.kind === 'operation' && Object.values(r.cells).some(c => (c.original ?? 0) > 0))!;
    const col = base.columns.find(c => (op.cells[c.key]?.original ?? 0) > 0)!;
    const overrides = { [`${op.id}:${col.key}`]: 999 };
    const table = repriceStudy(study, { layout: 'establishment', targetPeriod: target, overrides }, SERIES);
    const [c] = userChanges(table, study, { ...none, overrides });
    expect(c.column).toMatch(/^Year \d+$/);
    expect(c.from).toBe(op.cells[col.key].original);
  });

  it('builds both exports with a Your changes section and sheet', async () => {
    const base = repriceStudy(study, { layout: 'production', targetPeriod: target }, SERIES);
    const op = base.rows.find(r => r.kind === 'operation' && (r.cells.labor?.original ?? 0) > 0)!;
    const overrides = { [`${op.id}:labor`]: 50 };
    const table = repriceStudy(study, { layout: 'production', targetPeriod: target, overrides }, SERIES);
    const changes = userChanges(table, study, { ...none, overrides });
    const meta = { study: null, series: SERIES, interestRate: null, interestSource: '', acres: 1, mappingNotes: [], changes };
    const pdf = await buildPdf(table, meta);
    expect(pdf.byteLength).toBeGreaterThan(5000);
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildWorkbook(table, meta)).buffer as ArrayBuffer);
    const sheet = book.getWorksheet('Your changes')!;
    expect(sheet).toBeDefined();
    expect(sheet.getRow(3).getCell(1).value).toBe(op.label.replace(/\s+/g, ' ').trim());
    expect(sheet.getRow(3).getCell(6).value).toBe(50);
    // Money cells carry a currency format on the table sheet.
    const t = book.getWorksheet('Table')!;
    const formats = new Set<string>();
    t.eachRow(r => r.eachCell(c => { if (c.numFmt) formats.add(c.numFmt); }));
    expect([...formats].some(f => f.includes('"$"'))).toBe(true);
  });
});

describe('study contents', () => {
  it('the manifest matches the parsed studies (run npx tsx scripts/studyContents.ts after syncing)', () => {
    const dir = join(__dirname, '../../data/studies/parsed');
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const id = f.replace(/\.json$/, '');
      expect((contents as Record<string, unknown>)[id], id).toEqual(studyContentsOf(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
    }
  });

  it('labels every pick with what it holds and offers establishment-only studies', () => {
    const picks = studyPicks();
    expect(picks.every(p => p.hasEstablishment || p.hasProduction)).toBe(true);
    expect(picks.find(p => p.id === 'almonds-2024-almondssjvsouth-final-draft-8-3-25')?.contents).toBe('both');
    expect(picks.some(p => p.contents === 'establishment')).toBe(true);
    expect(picks.some(p => p.contents === 'production')).toBe(true);
  });

  it('reprices each establishment-only study in its establishment layout', () => {
    const dir = join(__dirname, '../../data/studies/parsed');
    for (const p of studyPicks().filter(p => p.contents === 'establishment')) {
      const s = JSON.parse(readFileSync(join(dir, `${p.id}.json`), 'utf8')) as ParsedStudy;
      const t = repriceStudy(s, { layout: 'establishment', targetPeriod: target }, SERIES);
      expect(t.layout, p.id).toBe('establishment');
      expect(t.rows.length, p.id).toBeGreaterThan(0);
    }
  });
});
