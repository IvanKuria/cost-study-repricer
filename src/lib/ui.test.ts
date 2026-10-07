import { describe, expect, it } from 'vitest';
import { repriceStudy } from './reprice';
import { SERIES } from './series';
import { studyPicks } from './studies';
import { fallbackSentence, hasOverrides, peakCash, repricingSentence } from './exportShared';
import { buildPdf } from './exportPdf';
import { buildWorkbook } from './exportXlsx';
import type { ParsedStudy } from '@/data/studySchema';
import type { RepricedCell, RepricedTable } from './types';
import strawberries from '../../data/studies/parsed/strawberries-2024orgstrawberries-final-may2024.json';

const study = strawberries as unknown as ParsedStudy;
const target = '2026-06';

describe('the lender screen over the real engine', () => {
  it('an override on one line changes the total per acre', () => {
    const base = repriceStudy(study, { targetPeriod: target }, SERIES);
    const op = base.rows.find(r => r.kind === 'operation' && (r.cells.total?.repriced ?? 0) > 0)!;
    const before = base.summary.totalPerAcreRepriced!;
    const edited = repriceStudy(study, { targetPeriod: target, overrides: { [op.id]: (op.cells.total.repriced ?? 0) + 1000 } }, SERIES);
    expect(hasOverrides(edited)).toBe(true);
    // The engine also recomputes operating interest on the larger cash outlay, so the total moves by a little more than the edit.
    const delta = edited.summary.totalPerAcreRepriced! - before;
    expect(delta).toBeGreaterThanOrEqual(1000);
    expect(delta).toBeLessThan(1100);
  });

  it('builds the PDF and workbook for a production table', async () => {
    const table = repriceStudy(study, { targetPeriod: target }, SERIES);
    const pick = studyPicks().find(p => p.id === study.source.id) ?? null;
    const meta = { study: pick, series: SERIES, interestRate: 0.0751, interestSource: 'Kansas City Fed operating loan rate', acres: 10, mappingNotes: [] };
    expect(repricingSentence(table, meta)).toMatch(/Repriced from the 2024 study/);
    const pdf = await buildPdf(table, meta);
    expect(pdf.byteLength).toBeGreaterThan(5000);
    const xlsx = await buildWorkbook(table, meta);
    expect(xlsx.byteLength).toBeGreaterThan(3000);
  });

  it('builds both exports and finds the peak cash need for an establishment layout', async () => {
    const cell = (v: number | null, f = 1.2): RepricedCell => ({ original: v, category: 'labor', seriesId: 'nass.labor', indexFrom: 100, indexTo: 120, factor: f, repriced: v === null ? null : v * f, overridden: false });
    const cols = [{ key: 'y1', label: '1st' }, { key: 'y2', label: '2nd' }, { key: 'y3', label: '3rd' }];
    const table: RepricedTable = {
      studyId: 'x', title: 'COSTS PER ACRE TO ESTABLISH AN ALMOND ORCHARD', layout: 'establishment', columns: cols,
      referencePeriod: '2024-06', targetPeriod: target,
      rows: [
        { id: 'h', label: 'Cultural:', kind: 'heading', section: 'Cultural', timeHrs: null, cells: {}, page: null, quote: null },
        { id: 'o1', label: 'Plant Trees', kind: 'operation', section: 'Cultural', timeHrs: null, cells: { y1: cell(3000), y2: cell(0), y3: cell(0) }, page: 14, quote: '' },
        { id: 't', label: 'Total cultural costs', kind: 'subtotal', section: 'Cultural', timeHrs: null, cells: { y1: cell(3000), y2: cell(0), y3: cell(0) }, page: null, quote: null },
        { id: 'a', label: 'Accumulated net cash costs/acre', kind: 'total', section: 'Totals', timeHrs: null, cells: { y1: cell(10653), y2: cell(12416), y3: cell(14894) }, page: null, quote: null },
      ],
      summary: { totalPerAcreOriginal: 14894, totalPerAcreRepriced: 14894 * 1.2, cashPerAcreRepriced: 14894 * 1.2, coverage: [{ category: 'labor', share: 1, seriesId: 'nass.labor' }], cpiShare: 0, pricedRows: 1, fallbackRows: 0 },
    };
    expect(peakCash(table)).toEqual({ value: 14894 * 1.2, column: '3rd' });
    const meta = { study: null, series: SERIES, interestRate: null, interestSource: 'Kansas City Fed operating loan rate', acres: 1, mappingNotes: [] };
    expect((await buildPdf(table, meta)).byteLength).toBeGreaterThan(3000);
    expect((await buildWorkbook(table, meta)).byteLength).toBeGreaterThan(3000);
  });
});

it('PDF sources appendix is optional and both versions retain a clickable link', async () => {
  const table = repriceStudy(study, { targetPeriod: target });
  const meta = { study: null, series: SERIES, interestRate: null, interestSource: '', acres: 1, mappingNotes: [], sourcesUrl: 'https://example.test/repricer/?section=sources' };
  const compact = new TextDecoder().decode(await buildPdf(table, meta));
  const full = new TextDecoder().decode(await buildPdf(table, meta, { includeDetails: true }));
  expect(compact).toContain('/Subtype /Link');
  expect(compact).toContain(meta.sourcesUrl);
  expect(full).toContain(meta.sourcesUrl);
  expect(full.length).toBeGreaterThan(compact.length);
  expect(compact).not.toContain('How each line was repriced');
});

it('states how many priced rows use the CPI fallback, and the workbook and detailed PDF carry it', async () => {
  const table = repriceStudy(study, { targetPeriod: target });
  const { pricedRows, fallbackRows } = table.summary;
  expect(pricedRows).toBeGreaterThan(0);
  const sentence = fallbackSentence(table);
  expect(sentence).toMatch(fallbackRows ? new RegExp(`^${fallbackRows} of ${pricedRows} priced rows use the CPI fallback`) : /^None of the/);
  expect(sentence).not.toMatch(/\u2014/);
  const meta = { study: null, series: SERIES, interestRate: null, interestSource: '', acres: 1, mappingNotes: [] };
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await buildWorkbook(table, meta)).buffer as ArrayBuffer);
  const texts: string[] = [];
  book.getWorksheet('Sources')!.eachRow(r => texts.push(String(r.getCell(1).value)));
  expect(texts).toContain(sentence);
});

describe('establishment in exports', () => {
  it('carries the tier 2 row and the establishment note into the workbook and PDF', async () => {
    const withTotal = { ...study, establishmentSummary: { perennial: true, status: 'total', total: { value: 12000, page: 7, quote: 'Total 12,000', source: 'investment' }, annualCharge: null, reason: null } } as ParsedStudy;
    const table = repriceStudy(withTotal, { targetPeriod: target }, SERIES);
    const meta = { study: null, series: SERIES, interestRate: null, interestSource: '', acres: 10, mappingNotes: [{ label: 'Establishment cost (CPI)', series: 'CPI', note: 'his rule' }] };
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildWorkbook(table, meta)).buffer as ArrayBuffer);
    const text = (name: string) => { const out: string[] = []; book.getWorksheet(name)!.eachRow(r => out.push(String(r.getCell(1).value ?? ''))); return out.join('\n'); };
    expect(text('Table')).toMatch(/Establishment cost per acre, accumulated/);
    expect(text('Table')).toMatch(/one-time investment/);
    expect(text('Sources')).toMatch(/Establishment cost \(CPI\)/);
    const none = repriceStudy({ ...study, establishmentSummary: { perennial: true, status: 'none', total: null, annualCharge: null, reason: null } } as ParsedStudy, { targetPeriod: target }, SERIES);
    expect((await buildPdf(none, meta)).byteLength).toBeGreaterThan(5000);
    const b2 = new ExcelJS.Workbook();
    await b2.xlsx.load((await buildWorkbook(none, meta)).buffer as ArrayBuffer);
    const rows: string[] = []; b2.getWorksheet('Table')!.eachRow(r => rows.push(String(r.getCell(1).value ?? '')));
    expect(rows).toContain('This study prints no establishment cost we could find; establishment is not included.');
  });
});
